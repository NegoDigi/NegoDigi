-- Let an editor replace a pending/returned delivery in place. The delivery
-- keeps its id, assignment, job and item, so no duplicate payment or video
-- counter can be created by correcting a link.
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
  item jsonb;
  item_count integer;
begin
  select * into original
  from public.delivery_submissions
  where id = target_submission;

  if original.id is null then
    raise exception 'No se encontró la entrega';
  end if;
  if not private.can_access_assignment(original.assignment_id) then
    raise exception 'No tienes acceso a esta entrega';
  end if;
  if original.status not in ('pending_review', 'changes_requested') then
    raise exception 'Solo se puede sustituir una entrega pendiente o devuelta';
  end if;

  item_count := coalesce(jsonb_array_length(coalesce(replacement_items, '[]'::jsonb)), 0);
  if coalesce(nullif(trim(replacement_folder_url), ''), '') = ''
     and item_count <> original.quantity then
    raise exception 'La sustitución debe contener exactamente % enlaces', original.quantity;
  end if;
  if item_count > 0 then
    for item in select * from jsonb_array_elements(replacement_items)
    loop
      if coalesce(trim(item->>'url'), '') = '' then
        raise exception 'Cada vídeo necesita un enlace';
      end if;
    end loop;
  end if;

  update public.delivery_submissions
  set folder_url = nullif(trim(replacement_folder_url), ''),
      notes = nullif(trim(replacement_notes), ''),
      status = 'pending_review',
      approved_quantity = 0,
      review_notes = null,
      reviewed_by = null,
      reviewed_at = null,
      submitted_by = coalesce(auth.uid(), submitted_by),
      updated_at = now()
  where id = original.id;

  delete from public.delivery_submission_items where submission_id = original.id;
  if item_count > 0 then
    insert into public.delivery_submission_items
      (organization_id, submission_id, label, url, status, correction_notes, reviewed_at)
    select original.organization_id,
           original.id,
           coalesce(nullif(trim(item->>'label'), ''), 'Vídeo ' || row_number() over ()),
           trim(item->>'url'),
           'pending_review',
           null,
           null
    from jsonb_array_elements(replacement_items) item;
  end if;

  return original.id;
end;
$$;

revoke all on function public.replace_delivery_submission(uuid, text, text, jsonb) from public, anon;
grant execute on function public.replace_delivery_submission(uuid, text, text, jsonb) to authenticated;
