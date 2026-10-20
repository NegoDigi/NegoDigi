alter table public.team_announcements
  add column if not exists image_storage_path text,
  add column if not exists attachment_storage_path text,
  add column if not exists video_storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'negodigi-announcements',
  'negodigi-announcements',
  false,
  52428800,
  array['image/png','image/jpeg','image/webp','application/pdf','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "announcement assets read" on storage.objects;
create policy "announcement assets read"
on storage.objects for select to authenticated
using (
  bucket_id = 'negodigi-announcements'
  and exists (
    select 1
    from public.team_announcements announcement
    join public.profiles profile
      on profile.id = auth.uid()
      and profile.organization_id = announcement.organization_id
    where name = any(array[
      announcement.image_storage_path,
      announcement.attachment_storage_path,
      announcement.video_storage_path
    ])
      and (announcement.expires_at is null or announcement.expires_at > now())
      and (
        private.has_role(announcement.organization_id, array['owner'::public.app_role, 'admin'::public.app_role])
        or (announcement.status = 'published' and announcement.audience = 'all')
        or (announcement.status = 'published' and announcement.audience = 'editors' and profile.role = 'editor'::public.app_role)
      )
  )
);

drop policy if exists "announcement assets admin write" on storage.objects;
create policy "announcement assets admin write"
on storage.objects for all to authenticated
using (
  bucket_id = 'negodigi-announcements'
  and private.has_role((storage.foldername(name))[1]::uuid, array['owner'::public.app_role, 'admin'::public.app_role])
)
with check (
  bucket_id = 'negodigi-announcements'
  and private.has_role((storage.foldername(name))[1]::uuid, array['owner'::public.app_role, 'admin'::public.app_role])
);

create table if not exists public.organization_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title text not null check (char_length(trim(title)) > 0),
  due_on date,
  priority text not null default 'upcoming' check (priority in ('critical','today','upcoming')),
  notes text,
  sort_order integer not null default 0,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_tasks enable row level security;
drop policy if exists "organization tasks admin" on public.organization_tasks;
create policy "organization tasks admin"
on public.organization_tasks for all to authenticated
using (private.has_role(organization_id, array['owner'::public.app_role, 'admin'::public.app_role]))
with check (private.has_role(organization_id, array['owner'::public.app_role, 'admin'::public.app_role]));

create index if not exists organization_tasks_open_idx
on public.organization_tasks (organization_id, completed_at, priority, due_on, sort_order);

create or replace function private.cleanup_expired_announcements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from storage.objects
  where bucket_id = 'negodigi-announcements'
    and name in (
      select distinct asset_path
      from public.team_announcements announcement
      cross join lateral unnest(array[
        announcement.image_storage_path,
        announcement.attachment_storage_path,
        announcement.video_storage_path
      ]) as asset_path
      where announcement.expires_at is not null
        and announcement.expires_at <= now()
        and asset_path is not null
    );

  delete from public.team_announcement_reads reading
  using public.team_announcements announcement
  where reading.announcement_id = announcement.id
    and announcement.expires_at is not null
    and announcement.expires_at <= now();

  delete from public.team_announcements
  where expires_at is not null and expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_expired_announcements() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'negodigi-clean-expired-announcements';

select cron.schedule(
  'negodigi-clean-expired-announcements',
  '10 * * * *',
  'select private.cleanup_expired_announcements();'
);
