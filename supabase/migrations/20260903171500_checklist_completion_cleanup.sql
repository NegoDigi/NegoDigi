-- Checklist tasks keep their own completion timestamp. It is intentionally
-- separate from updated_at, which can change for unrelated edits.
alter table public.editor_planning_blocks
  add column if not exists completed_at timestamptz;

create index if not exists editor_planning_completed_cleanup_idx
  on public.editor_planning_blocks (completed_at)
  where completed_at is not null and archived_at is null;

-- This job only removes completed checklist records after seven full days.
-- It never touches production jobs, video deliveries, corrections or history.
select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup_editor_completed_checklist_tasks';

select cron.schedule(
  'cleanup_editor_completed_checklist_tasks',
  '* * * * *',
  $$
    delete from public.editor_planning_blocks
    where status = 'completed'
      and archived_at is null
      and completed_at <= now() - interval '7 days';
  $$
);
