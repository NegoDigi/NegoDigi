-- Allow each authenticated user to remove only their own notifications.
-- Unread deletion is guarded in the UI with an explicit confirmation.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'notifications_own_delete'
  ) then
    create policy "notifications_own_delete"
    on public.notifications
    for delete
    to authenticated
    using (user_id = (select auth.uid()));
  end if;
end $$;
