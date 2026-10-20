-- Notifications are short-lived operational prompts, never an archive.
-- News retains its own expiry selected by an administrator.

alter table public.team_announcements
  add column if not exists priority text not null default 'normal'
    check (priority in ('normal','important','pinned')),
  add column if not exists expires_at timestamptz,
  add column if not exists link_url text,
  add column if not exists attachment_url text,
  add column if not exists video_url text;

create index if not exists team_announcements_visible_idx
  on public.team_announcements (organization_id, status, priority, published_at desc);

create or replace function private.cleanup_expired_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count integer;
begin
  delete from public.notifications
  where created_at < now() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_expired_notifications() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'negodigi-clean-expired-notifications';

select cron.schedule(
  'negodigi-clean-expired-notifications',
  '5 * * * *',
  'select private.cleanup_expired_notifications();'
);
