-- A replacement keeps the same submission id. Use the previous row status to
-- distinguish a corrected version from a first-time delivery.
create or replace function private.notify_delivery_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_name text;
  editor_name text;
  job_title text;
  service_name text;
  is_revision boolean;
begin
  if new.status <> 'pending_review'
    or (tg_op = 'UPDATE' and old.status = new.status) then
    return new;
  end if;

  select c.name, j.title, ji.service, e.name
    into client_name, job_title, service_name, editor_name
  from public.jobs j
  join public.clients c on c.id = j.client_id
  left join public.job_items ji on ji.id = new.job_item_id
  left join public.job_assignments ja on ja.id = new.assignment_id
  left join public.editors e on e.id = ja.editor_id
  where j.id = new.job_id;

  is_revision := (tg_op = 'UPDATE' and old.status = 'changes_requested');
  select is_revision or exists (
    select 1 from public.delivery_submissions previous
    where previous.assignment_id = new.assignment_id
      and previous.job_item_id is not distinct from new.job_item_id
      and previous.id <> new.id
      and previous.status = 'changes_requested'
  ) into is_revision;

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  select new.organization_id,
    p.id,
    case when is_revision
      then format('El editor %s ha enviado una versión corregida', coalesce(editor_name, 'Editor'))
      else format('El editor %s ha enviado una entrega', coalesce(editor_name, 'Editor'))
    end,
    format('%s · %s · %s · %s vídeo(s) para revisar%s.', coalesce(client_name, 'Cliente'), coalesce(editor_name, 'Editor'), coalesce(job_title, 'Trabajo'), coalesce(service_name, 'Servicio'), trim(to_char(new.quantity, 'FM999999990.##')), case when is_revision then ' · nueva versión corregida' else '' end),
    format('/operaciones?job=%s&submission=%s', new.job_id, new.id)
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    and p.active = true
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_delivery_submission() from public, anon, authenticated;
