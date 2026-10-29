-- Applied production migration: disable automatic renewals for closed packs.
-- Existing pack balances remain intact; only explicit excess stays receivable.

CREATE OR REPLACE FUNCTION private.sync_expired_closed_packs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pack record;
  org_today date;
  usage_amount numeric(12,2);
  overage numeric(12,2);
  renewal numeric(12,2);
  carry_overage boolean;
  due_amount numeric(12,2);
  changed_count integer := 0;
begin
  for pack in
    select
      b.id,
      b.organization_id,
      b.client_id,
      b.name,
      b.initial_amount,
      b.declared_pending_amount,
      b.status,
      b.renewal_amount,
      b.pack_config,
      coalesce(
        nullif(b.expires_on::text, '')::date,
        nullif(b.pack_config ->> 'cycle_end', '')::date,
        nullif(b.pack_config ->> 'period_ends_on', '')::date,
        nullif(b.pack_config ->> 'end_date', '')::date
      ) as effective_end,
      coalesce(o.timezone, 'Europe/Madrid') as timezone
    from public.bonus_accounts b
    left join public.organizations o on o.id = b.organization_id
    where b.bonus_type = 'closed_pack'
      and b.status in ('active'::public.bonus_status, 'expired'::public.bonus_status)
      and coalesce(
        nullif(b.expires_on::text, '')::date,
        nullif(b.pack_config ->> 'cycle_end', '')::date,
        nullif(b.pack_config ->> 'period_ends_on', '')::date,
        nullif(b.pack_config ->> 'end_date', '')::date
      ) is not null
  loop
    org_today := (now() at time zone pack.timezone)::date;
    if pack.effective_end >= org_today then
      continue;
    end if;

    select coalesce(sum(m.amount), 0)
      into usage_amount
      from public.bonus_movements m
     where m.bonus_id = pack.id
       and m.movement_type = 'usage';

    overage := greatest(
      0,
      coalesce(pack.declared_pending_amount, 0) + usage_amount - pack.initial_amount
    );
    renewal := coalesce(
      nullif(pack.pack_config ->> 'renewal_amount', '')::numeric,
      pack.renewal_amount,
      pack.initial_amount
    );
    carry_overage := coalesce(
      pack.pack_config ->> 'excess_handling',
      'charge_separately'
    ) = 'apply_to_renewal';
    due_amount := case
      when carry_overage then greatest(0, overage - renewal)
      else overage
    end;

    update public.bonus_accounts
       set status = 'expired'::public.bonus_status,
           updated_at = now()
     where id = pack.id
       and status = 'active'::public.bonus_status;

    update public.receivables
       set status = 'cancelled'::public.receivable_status,
           description = 'Renovación para revisar manualmente; no se cobra automáticamente.',
           updated_at = now()
     where bonus_id = pack.id
       and source in ('pack_cycle', 'pack_renewal')
       and status = 'open'::public.receivable_status;

    if due_amount > 0 then
      insert into public.receivables (
        organization_id, client_id, bonus_id, amount, status, source, description, started_on
      )
      values (
        pack.organization_id,
        pack.client_id,
        pack.id,
        due_amount,
        'open'::public.receivable_status,
        'bonus_excess',
        'Exceso real por encima del saldo del pack',
        pack.effective_end
      )
      on conflict (bonus_id)
        where source = 'bonus_excess' and status = 'open'
      do update set
        amount = excluded.amount,
        description = excluded.description,
        started_on = excluded.started_on,
        updated_at = now();
    else
      update public.receivables
         set status = 'cancelled'::public.receivable_status,
             description = 'Anulado: no hay exceso de servicios por cobrar.',
             updated_at = now()
       where bonus_id = pack.id
         and source = 'bonus_excess'
         and status = 'open'::public.receivable_status;
    end if;

    changed_count := changed_count + 1;
  end loop;

  return changed_count;
end;
$function$

CREATE OR REPLACE FUNCTION private.refresh_closed_pack_receivables_cron()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return private.sync_expired_closed_packs();
end;
$function$

CREATE OR REPLACE FUNCTION public.process_closed_pack_renewals()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private'
AS $function$
begin
  return 0;
end;
$function$

CREATE OR REPLACE FUNCTION public.refresh_closed_pack_receivables()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return;
end;
$function$
