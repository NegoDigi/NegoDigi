-- Delivery punctuality is a permanent Production fact and must use the
-- organization's Spanish calendar day rather than the database UTC day.

create or replace function private.capture_delivery_lateness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline date;
  org_timezone text;
begin
  select
    a.due_on,
    coalesce(nullif(o.timezone, ''), 'Europe/Madrid')
  into deadline, org_timezone
  from public.job_assignments a
  join public.organizations o on o.id = a.organization_id
  where a.id = new.assignment_id;

  new.was_late := deadline is not null
    and (coalesce(new.created_at, now()) at time zone org_timezone)::date > deadline;
  return new;
end;
$$;

revoke all on function private.capture_delivery_lateness() from public, anon, authenticated;

update public.delivery_submissions s
set was_late = (
  a.due_on is not null
  and (s.created_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'))::date > a.due_on
)
from public.job_assignments a
join public.organizations o on o.id = a.organization_id
where a.id = s.assignment_id
  and s.was_late is distinct from (
    a.due_on is not null
    and (s.created_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'))::date > a.due_on
  );

