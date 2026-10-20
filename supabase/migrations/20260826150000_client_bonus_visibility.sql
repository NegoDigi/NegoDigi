-- Client portals may read the internal bonus usage only through the
-- security-invoker balance view. They never receive write access.
create policy bonus_movements_client_select
on public.bonus_movements
for select to authenticated
using (
  exists (
    select 1
    from public.bonus_accounts b
    join public.clients c on c.id = b.client_id
    where b.id = bonus_movements.bonus_id
      and c.user_id = (select auth.uid())
  )
);
