-- Account for new delivered work only. Historic imports stay excluded so that
-- already-paid legacy work is never turned into a false receivable.
alter table public.job_deliveries
  add column if not exists client_unit_price numeric(12,2),
  add column if not exists billable boolean not null default true;

alter table public.job_deliveries
  drop constraint if exists job_deliveries_client_unit_price_check;
alter table public.job_deliveries
  add constraint job_deliveries_client_unit_price_check
  check (client_unit_price is null or client_unit_price >= 0);

-- Existing deliveries predate automatic billing. They remain visible in the
-- history, but cannot create new bonus usage or money owed retroactively.
update public.job_deliveries
set billable = false
where created_at < now();

alter table public.receivables
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create unique index if not exists receivables_open_delivery_auto_job_idx
on public.receivables (job_id)
where source = 'delivery_auto' and status = 'open';

create or replace function private.prepare_job_delivery_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_unit_price is null then
    select coalesce(cr.client_unit_price, 0)
    into new.client_unit_price
    from public.job_assignments ja
    join public.jobs j on j.id = ja.job_id
    join public.job_items ji on ji.id = new.job_item_id and ji.job_id = j.id
    left join lateral (
      select rate.client_unit_price
      from public.client_rates rate
      where rate.client_id = j.client_id
        and rate.active
        and (case when rate.service in ('Miniatura', 'Miniaturas') then 'Miniaturas' else rate.service end)
          = (case when ji.service in ('Miniatura', 'Miniaturas') then 'Miniaturas' else ji.service end)
      order by rate.created_at desc
      limit 1
    ) cr on true
    where ja.id = new.assignment_id;
  end if;

  new.client_unit_price := coalesce(new.client_unit_price, 0);
  return new;
end;
$$;

revoke all on function private.prepare_job_delivery_price() from public, anon, authenticated;

drop trigger if exists prepare_job_delivery_price on public.job_deliveries;
create trigger prepare_job_delivery_price
before insert or update of assignment_id, job_item_id, client_unit_price on public.job_deliveries
for each row execute function private.prepare_job_delivery_price();

create or replace function private.reconcile_job_delivery_accounting(target_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid;
  target_client uuid;
  target_bonus uuid;
  delivered_value numeric(12,2) := 0;
begin
  select organization_id, client_id
  into target_org, target_client
  from public.jobs
  where id = target_job;

  if target_org is null then
    return;
  end if;

  select coalesce(sum(d.quantity * coalesce(d.client_unit_price, 0)), 0)::numeric(12,2)
  into delivered_value
  from public.job_deliveries d
  join public.job_items ji on ji.id = d.job_item_id
  where ji.job_id = target_job
    and d.billable;

  -- Remove only entries written by this automatic delivery ledger. Manual
  -- adjustments and historic bonus movements are never touched.
  delete from public.bonus_movements
  where job_id = target_job
    and movement_type = 'usage'
    and detail @> '{"source":"delivery_auto"}'::jsonb;

  select b.id
  into target_bonus
  from public.bonus_accounts b
  where b.client_id = target_client
    and b.status <> 'expired'::public.bonus_status
  order by b.paid_on desc nulls last, b.created_at desc
  limit 1;

  if target_bonus is not null then
    delete from public.receivables
    where job_id = target_job
      and source = 'delivery_auto'
      and status = 'open';

    if delivered_value > 0 then
      insert into public.bonus_movements (
        organization_id, bonus_id, job_id, movement_type, amount, description, detail, occurred_on
      ) values (
        target_org, target_bonus, target_job, 'usage', delivered_value,
        'Consumo automático por entregas de producción',
        jsonb_build_object('source', 'delivery_auto'), current_date
      );
    end if;
  else
    if delivered_value > 0 then
      insert into public.receivables (
        organization_id, client_id, job_id, amount, status, source, description, started_on
      ) values (
        target_org, target_client, target_job, delivered_value, 'open', 'delivery_auto',
        'Servicios entregados pendientes de cobro', current_date
      )
      on conflict (job_id) where source = 'delivery_auto' and status = 'open'
      do update set amount = excluded.amount, description = excluded.description, updated_at = now();
    else
      delete from public.receivables
      where job_id = target_job
        and source = 'delivery_auto'
        and status = 'open';
    end if;
  end if;
end;
$$;

revoke all on function private.reconcile_job_delivery_accounting(uuid) from public, anon, authenticated;

create or replace function private.after_job_delivery_accounting_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_assignment uuid;
  target_job uuid;
begin
  target_assignment := case when tg_op = 'DELETE' then old.assignment_id else new.assignment_id end;
  select job_id into target_job from public.job_assignments where id = target_assignment;
  if target_job is not null then
    perform private.reconcile_job_delivery_accounting(target_job);
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.after_job_delivery_accounting_change() from public, anon, authenticated;

drop trigger if exists reconcile_job_delivery_accounting on public.job_deliveries;
create trigger reconcile_job_delivery_accounting
after insert or update or delete on public.job_deliveries
for each row execute function private.after_job_delivery_accounting_change();
