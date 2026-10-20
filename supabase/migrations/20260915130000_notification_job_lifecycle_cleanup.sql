-- Due-date alerts must always reflect an active production job.  Notifications
-- are stored separately from jobs, so keep their lifecycle explicitly linked.

create or replace function private.clear_job_notifications(target_job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications
  where action_url like ('/operaciones?job=' || target_job_id::text || '&%');
$$;

revoke all on function private.clear_job_notifications(uuid) from public, anon, authenticated;

create or replace function private.clear_notifications_for_inactive_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.clear_job_notifications(old.id);
    return old;
  end if;

  if new.status in ('cancelled', 'delivered') then
    perform private.clear_job_notifications(new.id);
  end if;
  return new;
end;
$$;

revoke all on function private.clear_notifications_for_inactive_job() from public, anon, authenticated;

drop trigger if exists jobs_clear_notifications_when_inactive on public.jobs;
create trigger jobs_clear_notifications_when_inactive
after update of status on public.jobs
for each row execute function private.clear_notifications_for_inactive_job();

drop trigger if exists jobs_clear_notifications_on_delete on public.jobs;
create trigger jobs_clear_notifications_on_delete
after delete on public.jobs
for each row execute function private.clear_notifications_for_inactive_job();

-- Remove previously-created due-date alerts that no longer point at a live
-- pending/planned job with an active assignment. This also clears alerts from
-- older app versions where a cancelled job still had a pending assignment.
delete from public.notifications n
where n.action_url like '/operaciones?job=%&due=%'
  and not exists (
    select 1
    from public.jobs j
    where j.id::text = split_part(split_part(n.action_url, 'job=', 2), '&', 1)
      and j.organization_id = n.organization_id
      and j.status in ('pending', 'planned')
      and exists (
        select 1
        from public.job_assignments ja
        where ja.job_id = j.id
          and ja.status not in ('completed', 'cancelled')
      )
  );

create or replace function public.ensure_due_job_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_org uuid;
  actor_role public.app_role;
  actor_timezone text;
  actor_today date;
  assignment_row record;
  recipient record;
  overdue boolean;
  action text;
begin
  if actor_id is null then return; end if;

  select p.organization_id, p.role, coalesce(nullif(o.timezone, ''), 'Europe/Madrid')
    into actor_org, actor_role, actor_timezone
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  where p.id = actor_id and p.active = true;

  if actor_org is null
     or actor_role not in (
       'owner'::public.app_role,
       'admin'::public.app_role,
       'editor'::public.app_role
     ) then
    return;
  end if;

  delete from public.notifications n
  where n.organization_id = actor_org
    and n.action_url like '/operaciones?job=%&due=%'
    and not exists (
      select 1
      from public.jobs j
      where j.id::text = split_part(split_part(n.action_url, 'job=', 2), '&', 1)
        and j.organization_id = actor_org
        and j.status in ('pending', 'planned')
        and exists (
          select 1
          from public.job_assignments ja
          where ja.job_id = j.id
            and ja.status not in ('completed', 'cancelled')
        )
    );

  actor_today := (now() at time zone actor_timezone)::date;

  for assignment_row in
    select
      ja.id,
      ja.job_id,
      ja.organization_id,
      ja.due_on,
      c.name as client_name,
      j.title as job_title,
      e.name as editor_name,
      e.user_id as editor_user_id
    from public.job_assignments ja
    join public.jobs j on j.id = ja.job_id
    join public.clients c on c.id = j.client_id
    join public.editors e on e.id = ja.editor_id
    where ja.organization_id = actor_org
      and j.status in ('pending', 'planned')
      and ja.status not in ('completed', 'cancelled')
      and ja.due_on is not null
      and ja.due_on <= actor_today + 2
  loop
    overdue := assignment_row.due_on < actor_today;
    action := format(
      '/operaciones?job=%s&due=%s&type=%s',
      assignment_row.job_id,
      assignment_row.due_on,
      case when overdue then 'overdue' else 'upcoming' end
    );

    if assignment_row.editor_user_id is not null then
      insert into public.notifications
        (organization_id, user_id, title, body, action_url)
      values (
        assignment_row.organization_id,
        assignment_row.editor_user_id,
        case when overdue then 'Tienes una entrega atrasada' else 'Tienes una entrega próxima' end,
        format('%s · %s · fecha límite %s.', assignment_row.client_name, assignment_row.job_title, to_char(assignment_row.due_on, 'DD/MM/YYYY')),
        action
      )
      on conflict do nothing;
    end if;

    for recipient in
      select p.id
      from public.profiles p
      where p.organization_id = assignment_row.organization_id
        and p.active = true
        and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    loop
      insert into public.notifications
        (organization_id, user_id, title, body, action_url)
      values (
        assignment_row.organization_id,
        recipient.id,
        case when overdue then 'Hay una entrega atrasada' else 'Hay una entrega próxima' end,
        format('%s · %s · editor %s · fecha límite %s.', assignment_row.client_name, assignment_row.job_title, assignment_row.editor_name, to_char(assignment_row.due_on, 'DD/MM/YYYY')),
        action
      )
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;

revoke all on function public.ensure_due_job_notifications() from public, anon;
grant execute on function public.ensure_due_job_notifications() to authenticated;
