-- Reminder generation is an operational action. Keep clients from being able
-- to fan out reminders for an organization while still allowing admins and
-- editors to refresh their own notification center.
create or replace function public.ensure_due_job_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_org uuid;
  current_role public.app_role;
  assignment_row record;
  recipient record;
  overdue boolean;
  action text;
begin
  if current_user_id is null then
    return;
  end if;

  select p.organization_id, p.role into current_org, current_role
  from public.profiles p
  where p.id = current_user_id and p.active = true;
  if current_org is null or current_role not in ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) then
    return;
  end if;

  for assignment_row in
    select ja.id, ja.job_id, ja.organization_id, ja.due_on,
           c.name as client_name, j.title as job_title,
           e.name as editor_name, e.user_id as editor_user_id
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
      select p.id
      from public.profiles p
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
