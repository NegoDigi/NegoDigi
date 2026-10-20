-- Notify every administrator when an editor sends a delivery for review.
-- The trigger uses the existing notifications table and does not create a
-- second delivery/payment record. SECURITY DEFINER is required because
-- editors are intentionally not allowed to insert notifications directly.
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
  notification_body text;
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

  select exists (
    select 1
    from public.delivery_submissions previous
    where previous.assignment_id = new.assignment_id
      and previous.job_item_id is not distinct from new.job_item_id
      and previous.id <> new.id
      and previous.status = 'changes_requested'
  ) into is_revision;

  notification_body := format(
    '%s · %s · %s · %s · %s vídeo(s) para revisar%s.',
    coalesce(client_name, 'Cliente'),
    coalesce(editor_name, 'Editor'),
    coalesce(job_title, 'Trabajo'),
    coalesce(service_name, 'Servicio'),
    trim(to_char(new.quantity, 'FM999999990.##')),
    case when is_revision then ' · nueva versión corregida' else '' end
  );

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  select new.organization_id,
         p.id,
         case when is_revision then 'Nueva versión corregida para revisar'
              else 'Nueva entrega para revisar' end,
         notification_body,
         '/operaciones'
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    and p.active = true;

  return new;
end;
$$;

revoke all on function private.notify_delivery_submission() from public, anon, authenticated;

drop trigger if exists notify_delivery_submission_review on public.delivery_submissions;
create trigger notify_delivery_submission_review
after insert or update of status on public.delivery_submissions
for each row execute function private.notify_delivery_submission();
