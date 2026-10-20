-- Keep deadline notifications aligned with the organization's Spanish clock
-- and add covering indexes for the production paths introduced in v55.

create index if not exists production_period_snapshots_org_idx
  on public.production_period_snapshots (organization_id, closed_at desc);
create index if not exists editor_activity_events_org_idx
  on public.editor_activity_events (organization_id, created_at desc);
create index if not exists editor_activity_events_created_by_idx
  on public.editor_activity_events (created_by) where created_by is not null;
create index if not exists delivery_corrections_org_idx
  on public.delivery_corrections (organization_id, created_at desc);
create index if not exists delivery_corrections_created_by_idx
  on public.delivery_corrections (created_by) where created_by is not null;
create index if not exists delivery_item_versions_org_idx
  on public.delivery_item_versions (organization_id, submitted_at desc);
create index if not exists delivery_item_versions_submitted_by_idx
  on public.delivery_item_versions (submitted_by) where submitted_by is not null;
create index if not exists delivery_review_comments_org_idx
  on public.delivery_review_comments (organization_id, created_at desc);
create index if not exists delivery_review_comments_author_idx
  on public.delivery_review_comments (author_id) where author_id is not null;
create index if not exists delivery_submission_items_org_idx
  on public.delivery_submission_items (organization_id, created_at desc);
create index if not exists delivery_submissions_org_idx
  on public.delivery_submissions (organization_id, created_at desc);
create index if not exists delivery_submissions_reviewed_by_idx
  on public.delivery_submissions (reviewed_by) where reviewed_by is not null;
create index if not exists delivery_submissions_submitted_by_idx
  on public.delivery_submissions (submitted_by) where submitted_by is not null;
create index if not exists job_assignment_items_job_item_idx
  on public.job_assignment_items (job_item_id);
create index if not exists job_assignment_items_org_idx
  on public.job_assignment_items (organization_id);
create index if not exists job_assignments_org_idx
  on public.job_assignments (organization_id, due_on);
create index if not exists job_deliveries_job_item_idx
  on public.job_deliveries (job_item_id);
create index if not exists job_deliveries_org_idx
  on public.job_deliveries (organization_id, delivered_on desc);
create index if not exists job_items_org_idx
  on public.job_items (organization_id);
create index if not exists notifications_org_idx
  on public.notifications (organization_id, created_at desc);

drop policy if exists "editor activity read" on public.editor_activity_events;
create policy "editor activity read"
on public.editor_activity_events for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_activity_events.editor_id
      and e.user_id = (select auth.uid())
  )
);

drop policy if exists "editor activity insert" on public.editor_activity_events;
create policy "editor activity insert"
on public.editor_activity_events for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_activity_events.editor_id
        and e.user_id = (select auth.uid())
    )
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
        case when overdue
          then 'Tienes una entrega atrasada'
          else 'Tienes una entrega próxima'
        end,
        format(
          '%s · %s · fecha límite %s.',
          assignment_row.client_name,
          assignment_row.job_title,
          to_char(assignment_row.due_on, 'DD/MM/YYYY')
        ),
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
        case when overdue
          then 'Hay una entrega atrasada'
          else 'Hay una entrega próxima'
        end,
        format(
          '%s · %s · editor %s · fecha límite %s.',
          assignment_row.client_name,
          assignment_row.job_title,
          assignment_row.editor_name,
          to_char(assignment_row.due_on, 'DD/MM/YYYY')
        ),
        action
      )
      on conflict do nothing;
    end loop;
  end loop;
end;
$$;

revoke all on function public.ensure_due_job_notifications() from public, anon;
grant execute on function public.ensure_due_job_notifications() to authenticated;

