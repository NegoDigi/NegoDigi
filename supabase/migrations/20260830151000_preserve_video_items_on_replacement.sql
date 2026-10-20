-- Keep the same delivery_submission_items ids when replacing a pending version.
-- This preserves the correction thread for the same logical video.
create or replace function public.replace_delivery_submission(
  target_submission uuid,
  replacement_folder_url text,
  replacement_notes text,
  replacement_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.delivery_submissions%rowtype;
  item_count integer;
begin
  select * into original
  from public.delivery_submissions
  where id = target_submission;

  if original.id is null then raise exception 'No se encontró la entrega'; end if;
  if not private.can_access_assignment(original.assignment_id) then raise exception 'No tienes acceso a esta entrega'; end if;
  if original.status not in ('pending_review', 'changes_requested') then raise exception 'Solo se puede sustituir una entrega pendiente o devuelta'; end if;

  item_count := coalesce(jsonb_array_length(coalesce(replacement_items, '[]'::jsonb)), 0);
  if coalesce(nullif(trim(replacement_folder_url), ''), '') = '' and item_count <> original.quantity then
    raise exception 'La sustitución debe contener exactamente % enlaces', original.quantity;
  end if;
  if item_count > 0 and exists (
    select 1 from jsonb_array_elements(replacement_items) item
    where coalesce(trim(item->>'url'), '') = ''
  ) then raise exception 'Cada vídeo necesita un enlace'; end if;

  update public.delivery_submissions
  set folder_url = nullif(trim(replacement_folder_url), ''),
      notes = nullif(trim(replacement_notes), ''), status = 'pending_review',
      approved_quantity = 0, review_notes = null, reviewed_by = null, reviewed_at = null,
      submitted_by = coalesce(auth.uid(), submitted_by), updated_at = now()
  where id = original.id;

  -- A folder replacement has no individual video rows.
  if item_count = 0 then
    delete from public.delivery_submission_items where submission_id = original.id;
  else
    -- Remove only rows beyond the new count; rows kept in position retain their ids.
    delete from public.delivery_submission_items i
    where i.submission_id = original.id
      and i.id not in (
        select ranked.id from (
          select id, row_number() over (order by created_at, id) as rn
          from public.delivery_submission_items
          where submission_id = original.id
        ) ranked where ranked.rn <= item_count
      );

    with incoming as (
      select row_number() over () as rn,
             coalesce(nullif(trim(item->>'label'), ''), 'Vídeo ' || row_number() over ()) as label,
             trim(item->>'url') as url
      from jsonb_array_elements(replacement_items) item
    ), existing as (
      select id, row_number() over (order by created_at, id) as rn
      from public.delivery_submission_items
      where submission_id = original.id
    )
    update public.delivery_submission_items target
    set label = incoming.label, url = incoming.url, status = 'pending_review',
        correction_notes = null, reviewed_at = null, updated_at = now()
    from existing join incoming using (rn)
    where target.id = existing.id;

    with incoming as (
      select row_number() over () as rn,
             coalesce(nullif(trim(item->>'label'), ''), 'Vídeo ' || row_number() over ()) as label,
             trim(item->>'url') as url
      from jsonb_array_elements(replacement_items) item
    ), existing_count as (
      select count(*)::integer as count from public.delivery_submission_items where submission_id = original.id
    )
    insert into public.delivery_submission_items
      (organization_id, submission_id, label, url, status, correction_notes, reviewed_at)
    select original.organization_id, original.id, incoming.label, incoming.url, 'pending_review', null, null
    from incoming, existing_count
    where incoming.rn > existing_count.count;
  end if;

  return original.id;
end;
$$;

revoke all on function public.replace_delivery_submission(uuid, text, text, jsonb) from public, anon;
grant execute on function public.replace_delivery_submission(uuid, text, text, jsonb) to authenticated;
