-- Notify other administrators when an assignment reaches completed status.
create or replace function private.notify_completed_job_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  client_name text;
  job_title text;
  recipient record;
begin
  if new.status <> 'completed' or old.status is not distinct from new.status then
    return new;
  end if;

  select e.user_id, c.name, j.title
    into target_user, client_name, job_title
  from public.jobs j
  join public.clients c on c.id = j.client_id
  join public.editors e on e.id = new.editor_id
  where j.id = new.job_id;

  if target_user is not null then
    insert into public.notifications (organization_id, user_id, title, body, action_url)
    values (
      new.organization_id,
      target_user,
      'Tu trabajo ha sido aprobado',
      format('%s · %s · todos los vídeos de esta asignación están aprobados.', coalesce(client_name, 'Cliente'), coalesce(job_title, 'Trabajo')),
      format('/operaciones?job=%s&type=job-approved', new.job_id)
    ) on conflict do nothing;
  end if;

  for recipient in
    select p.id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.active = true
      and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
      and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    insert into public.notifications (organization_id, user_id, title, body, action_url)
    values (
      new.organization_id,
      recipient.id,
      format('El trabajo de %s ha sido aprobado', coalesce(client_name, 'Cliente')),
      format('%s · %s · asignación completada por el editor.', coalesce(client_name, 'Cliente'), coalesce(job_title, 'Trabajo')),
      format('/operaciones?job=%s&type=job-approved', new.job_id)
    ) on conflict do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function private.notify_completed_job_assignment() from public, anon, authenticated;
