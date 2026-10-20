-- A closed pack is a repeating agreement, not a credit balance.  When its
-- configured cycle reaches the renewal date, Finance must show one concrete
-- receivable: the next pack plus any already-created overage.
create unique index if not exists receivables_open_pack_renewal_idx
  on public.receivables (bonus_id)
  where source = 'pack_renewal' and status = 'open';

create or replace function public.refresh_closed_pack_receivables()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack record;
  usage_amount numeric(12,2);
  overage numeric(12,2);
  renewal numeric(12,2);
begin
  for pack in
    select b.*
    from public.bonus_accounts b
    where b.bonus_type = 'closed_pack'
      and private.has_role(b.organization_id, array['owner','admin']::public.app_role[])
      and nullif(b.pack_config->>'cycle_end', '') is not null
      and (b.pack_config->>'cycle_end')::date <= current_date
  loop
    select coalesce(sum(amount), 0) into usage_amount
      from public.bonus_movements
      where bonus_id = pack.id and movement_type = 'usage';
    overage := greatest(0, coalesce(pack.declared_pending_amount, 0) + usage_amount - pack.initial_amount);
    renewal := coalesce(nullif(pack.pack_config->>'renewal_amount', '')::numeric, pack.initial_amount);
    delete from public.receivables
      where bonus_id = pack.id and source = 'bonus_excess' and status = 'open';
    insert into public.receivables (organization_id, client_id, bonus_id, amount, status, source, description, started_on)
      values (pack.organization_id, pack.client_id, pack.id, renewal + overage, 'open', 'pack_renewal',
        'Renovación de pack (' || renewal || ' €)' || case when overage > 0 then ' + exceso (' || overage || ' €)' else '' end,
        (pack.pack_config->>'cycle_end')::date)
      on conflict (bonus_id) where source = 'pack_renewal' and status = 'open'
      do update set amount = excluded.amount, description = excluded.description, updated_at = now();
  end loop;
end;
$$;

revoke all on function public.refresh_closed_pack_receivables() from public;
revoke execute on function public.refresh_closed_pack_receivables() from anon;
grant execute on function public.refresh_closed_pack_receivables() to authenticated;
