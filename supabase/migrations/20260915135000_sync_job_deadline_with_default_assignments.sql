-- A job deadline is the default deadline for its assignments. When Dirección
-- changes that shared date, keep assignments that were using the old shared
-- date in sync, while preserving any deliberately different editor deadline.
create or replace function private.sync_default_assignment_deadlines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.due_on is not distinct from new.due_on then
    return new;
  end if;

  update public.job_assignments
  set due_on = new.due_on
  where job_id = new.id
    and status not in ('completed', 'cancelled')
    and due_on is not distinct from old.due_on;

  -- The notification action URL contains the old deadline. Remove it now so
  -- it cannot survive a date edit; the normal reminder generator creates a
  -- fresh alert only if the new deadline is near enough.
  perform private.clear_job_notifications(new.id);
  return new;
end;
$$;

revoke all on function private.sync_default_assignment_deadlines() from public, anon, authenticated;

drop trigger if exists jobs_sync_default_assignment_deadlines on public.jobs;
create trigger jobs_sync_default_assignment_deadlines
after update of due_on on public.jobs
for each row execute function private.sync_default_assignment_deadlines();
