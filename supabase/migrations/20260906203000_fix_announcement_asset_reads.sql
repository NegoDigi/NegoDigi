-- Private announcement media must be readable by the audience that can see its post.
-- This enables signed URLs for editors without exposing bucket listings or other files.
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
    where storage.objects.name = any(array[
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
