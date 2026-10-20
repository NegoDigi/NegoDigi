-- Durable notification events for the existing notifications table.
-- No new tables are introduced: database triggers keep notifications tied to
-- the same job, assignment, submission and video that caused the event.

create unique index if not exists notifications_user_action_unique
  on public.notifications (user_id, action_url)
  where action_url is not null;

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
  left join public.editors e on e.id = ja.editor_id;

  is_revision := (tg_op = 'UPDATE' and old.status = 'changes_requested');
  select is_revision or exists (
    select 1
    from public.delivery_submissions previous
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
         format('%s · %s · %s · %s vídeo(s) para revisar%s.',
           coalesce(client_name, 'Cliente'),
           coalesce(editor_name, 'Editor'),
           coalesce(job_title, 'Trabajo'),
           coalesce(service_name, 'Servicio'),
           trim(to_char(new.quantity, 'FM999999990.##')),
           case when is_revision then ' · nueva versión corregida' else '' end
         ),
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

drop trigger if exists notify_delivery_submission_review on public.delivery_submissions;
create trigger notify_delivery_submission_review
after insert or update of status on public.delivery_submissions
for each row execute function private.notify_delivery_submission();

create or replace function private.notify_delivery_item_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  client_name text;
  editor_name text;
  job_title text;
  service_name text;
begin
  if new.status not in ('approved', 'changes_requested')
    or old.status is not distinct from new.status then
    return new;
  end if;

  select e.user_id, c.name, e.name, j.title, ji.service
    into target_user, client_name, editor_name, job_title, service_name
  from public.delivery_submissions ds
  join public.jobs j on j.id = ds.job_id
  join public.clients c on c.id = j.client_id
  left join public.job_items ji on ji.id = ds.job_item_id
  join public.job_assignments ja on ja.id = ds.assignment_id
  join public.editors e on e.id = ja.editor_id
  where ds.id = new.submission_id;

  if target_user is null then
    return new;
  end if;

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  values (
    new.organization_id,
    target_user,
    case when new.status = 'approved'
      then 'Tu trabajo ha sido aprobado'
      else 'El administrador ha solicitado cambios'
    end,
    format('%s · %s · %s · %s (%s).',
      coalesce(client_name, 'Cliente'),
      coalesce(editor_name, 'Editor'),
      coalesce(job_title, 'Trabajo'),
      coalesce(new.label, 'Vídeo'),
      case when new.status = 'approved' then 'aprobado' else 'correcciones pendientes' end
    ),
    format('/operaciones?job=%s&submission=%s&video=%s', ds.job_id, new.submission_id, new.id)
  )
  from public.delivery_submissions ds
  where ds.id = new.submission_id
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_delivery_item_review() from public, anon, authenticated;

drop trigger if exists notify_delivery_item_review on public.delivery_submission_items;
create trigger notify_delivery_item_review
after update of status on public.delivery_submission_items
for each row execute function private.notify_delivery_item_review();

create or replace function private.notify_delivery_submission_review_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  client_name text;
  editor_name text;
  job_title text;
begin
  if new.status not in ('approved', 'changes_requested')
    or old.status is not distinct from new.status
    or exists (select 1 from public.delivery_submission_items dsi where dsi.submission_id = new.id) then
    return new;
  end if;

  select e.user_id, c.name, e.name, j.title
    into target_user, client_name, editor_name, job_title
  from public.jobs j
  join public.clients c on c.id = j.client_id
  join public.job_assignments ja on ja.id = new.assignment_id
  join public.editors e on e.id = ja.editor_id
  where j.id = new.job_id;

  if target_user is null then
    return new;
  end if;

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  values (
    new.organization_id,
    target_user,
    case when new.status = 'approved'
      then 'Tu trabajo ha sido aprobado'
      else 'El administrador ha solicitado cambios'
    end,
    format('%s · %s · %s · entrega (%s).',
      coalesce(client_name, 'Cliente'),
      coalesce(editor_name, 'Editor'),
      coalesce(job_title, 'Trabajo'),
      case when new.status = 'approved' then 'aprobada' else 'correcciones pendientes' end
    ),
    format('/operaciones?job=%s&submission=%s', new.job_id, new.id)
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_delivery_submission_review_outcome() from public, anon, authenticated;

drop trigger if exists notify_delivery_submission_review_outcome on public.delivery_submissions;
create trigger notify_delivery_submission_review_outcome
after update of status on public.delivery_submissions
for each row execute function private.notify_delivery_submission_review_outcome();

create or replace function private.notify_new_job_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  client_name text;
  editor_name text;
  job_title text;
begin
  select e.user_id, c.name, e.name, j.title
    into target_user, client_name, editor_name, job_title
  from public.jobs j
  join public.clients c on c.id = j.client_id
  join public.editors e on e.id = new.editor_id
  where j.id = new.job_id;

  if target_user is null then
    return new;
  end if;

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  values (
    new.organization_id,
    target_user,
    'Se te ha asignado un nuevo trabajo',
    format('%s · %s · asignado el %s · entrega %s.',
      coalesce(client_name, 'Cliente'),
      coalesce(job_title, 'Trabajo'),
      coalesce(to_char(new.assigned_on, 'DD/MM/YYYY'), 'sin fecha'),
      coalesce(to_char(new.due_on, 'DD/MM/YYYY'), 'sin fecha')
    ),
    format('/operaciones?job=%s', new.job_id)
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_new_job_assignment() from public, anon, authenticated;

drop trigger if exists notify_new_job_assignment on public.job_assignments;
create trigger notify_new_job_assignment
after insert on public.job_assignments
for each row execute function private.notify_new_job_assignment();

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
    )
    on conflict do nothing;
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

drop trigger if exists notify_completed_job_assignment on public.job_assignments;
create trigger notify_completed_job_assignment
after update of status on public.job_assignments
for each row execute function private.notify_completed_job_assignment();

create or replace function public.ensure_due_job_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_org uuid;
  assignment_row record;
  recipient record;
  overdue boolean;
  action text;
begin
  if current_user_id is null then
    return;
  end if;

  select p.organization_id into current_org
  from public.profiles p
  where p.id = current_user_id and p.active = true;
  if current_org is null then
    return;
  end if;

  for assignment_row in
    select ja.id, ja.job_id, ja.organization_id, ja.due_on, c.name as client_name,
           j.title as job_title, e.name as editor_name, e.user_id as editor_user_id
    from public.job_assignments ja
    join public.jobs j on j.id = ja.job_id
    join public.clients c on c.id = j.client_id
    join public.editors e on e.id = ja.editor_id
    where ja.organization_id = current_org
      and ja.status not in ('completed', 'cancelled')
      and ja.due_on is not null
      and ja.due_on <= current_date + 2
  loop
    overdue := assignment_row.due_on < current_date;
    action := format('/operaciones?job=%s&due=%s&type=%s', assignment_row.job_id, assignment_row.due_on, case when overdue then 'overdue' else 'upcoming' end);

    if assignment_row.editor_user_id is not null then
      insert into public.notifications (organization_id, user_id, title, body, action_url)
      values (
        assignment_row.organization_id,
        assignment_row.editor_user_id,
        case when overdue then 'Tienes una entrega atrasada' else 'Tienes una entrega próxima' end,
        format('%s · %s · fecha límite %s.', assignment_row.client_name, assignment_row.job_title, to_char(assignment_row.due_on, 'DD/MM/YYYY')),
        action
      ) on conflict do nothing;
    end if;

    for recipient in
      select p.id from public.profiles p
      where p.organization_id = assignment_row.organization_id
        and p.active = true
        and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    loop
      insert into public.notifications (organization_id, user_id, title, body, action_url)
      values (
        assignment_row.organization_id,
        recipient.id,
        case when overdue then 'Hay una entrega atrasada' else 'Hay una entrega próxima' end,
        format('%s · %s · editor %s · fecha límite %s.', assignment_row.client_name, assignment_row.job_title, assignment_row.editor_name, to_char(assignment_row.due_on, 'DD/MM/YYYY')),
        action
      ) on conflict do nothing;
    end loop;
  end loop;
end;
$$;

revoke all on function public.ensure_due_job_notifications() from public, anon;
grant execute on function public.ensure_due_job_notifications() to authenticated;
