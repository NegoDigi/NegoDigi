-- Finance classification and traceability for the administrator's finance workspace.
-- Historical records are preserved: existing rows remain their recorded type and
-- are never inferred as investments.
alter table public.finance_transactions
  add column if not exists notes text,
  add column if not exists entry_status text not null default 'posted',
  add column if not exists recurrence_status text,
  add column if not exists recurrence_cancelled_on date;

update public.finance_transactions
set recurrence_status = 'active'
where is_recurring = true
  and recurrence_status is null;

alter table public.finance_transactions
  drop constraint if exists finance_transactions_recurrence_check;
alter table public.finance_transactions
  drop constraint if exists finance_transactions_entry_status_check;
alter table public.finance_transactions
  drop constraint if exists finance_transactions_recurrence_status_check;

alter table public.finance_transactions
  add constraint finance_transactions_entry_status_check
  check (entry_status in ('posted', 'pending', 'void'));
alter table public.finance_transactions
  add constraint finance_transactions_recurrence_status_check
  check (recurrence_status is null or recurrence_status in ('active', 'cancelled'));
alter table public.finance_transactions
  add constraint finance_transactions_recurrence_check
  check (
    (is_recurring = false and recurrence_interval is null and next_occurrence_on is null)
    or (
      is_recurring = true
      and movement_kind = 'subscription'
      and recurrence_interval = 'monthly'
      and (
        (coalesce(recurrence_status, 'active') = 'active' and next_occurrence_on is not null)
        or (recurrence_status = 'cancelled' and next_occurrence_on is null)
      )
    )
  );

create index if not exists finance_transactions_org_client_date_idx
  on public.finance_transactions (organization_id, client_id, occurred_on)
  where client_id is not null;
create index if not exists finance_transactions_active_recurring_due_idx
  on public.finance_transactions (organization_id, next_occurrence_on)
  where is_recurring = true and coalesce(recurrence_status, 'active') = 'active';

create or replace function public.process_recurring_finance_transactions()
returns integer
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  template record;
  occurrence date;
  next_date date;
  inserted_count integer;
  generated integer := 0;
begin
  for template in
    select *
    from public.finance_transactions
    where is_recurring = true
      and coalesce(recurrence_status, 'active') = 'active'
      and next_occurrence_on is not null
      and next_occurrence_on <= current_date
      and private.has_role(organization_id, array['owner','admin']::public.app_role[])
    order by next_occurrence_on, id
  loop
    occurrence := template.next_occurrence_on;
    for i in 1..120 loop
      exit when occurrence > current_date;
      insert into public.finance_transactions (
        organization_id, transaction_type, amount, concept, category, account,
        occurred_on, client_id, editor_id, receivable_id, proof_url, source,
        source_key, movement_kind, is_recurring, recurrence_interval,
        next_occurrence_on, recurrence_parent_id, notes, entry_status,
        recurrence_status, recurrence_cancelled_on
      ) values (
        template.organization_id, template.transaction_type, template.amount,
        template.concept, template.category, template.account, occurrence,
        template.client_id, template.editor_id, null, template.proof_url,
        'subscription', 'subscription:' || template.id::text || ':' || occurrence::text,
        'subscription', false, null, null, template.id, template.notes,
        template.entry_status, null, null
      ) on conflict (organization_id, source_key) do nothing;
      get diagnostics inserted_count = row_count;
      generated := generated + inserted_count;

      next_date := make_date(
        extract(year from occurrence + interval '1 month')::integer,
        extract(month from occurrence + interval '1 month')::integer,
        least(
          extract(day from occurrence)::integer,
          extract(day from (date_trunc('month', occurrence + interval '2 months') - interval '1 day'))::integer
        )
      );
      occurrence := next_date;
    end loop;

    update public.finance_transactions
    set next_occurrence_on = occurrence
    where id = template.id
      and next_occurrence_on = template.next_occurrence_on
      and coalesce(recurrence_status, 'active') = 'active';
  end loop;
  return generated;
end;
$$;

create or replace view public.monthly_finance_summary
with (security_invoker = true)
as
select
  organization_id,
  date_trunc('month', occurred_on)::date as month,
  coalesce(sum(amount) filter (where transaction_type = 'income'), 0)::numeric(12,2) as income,
  coalesce(sum(amount) filter (where transaction_type = 'expense'), 0)::numeric(12,2) as expenses,
  (
    coalesce(sum(amount) filter (where transaction_type = 'income'), 0)
    - coalesce(sum(amount) filter (where transaction_type = 'expense'), 0)
    - coalesce(sum(amount) filter (where transaction_type = 'investment'), 0)
  )::numeric(12,2) as net,
  coalesce(sum(amount) filter (where transaction_type = 'investment'), 0)::numeric(12,2) as investments
from public.finance_transactions
where entry_status = 'posted'
group by organization_id, date_trunc('month', occurred_on);

comment on column public.finance_transactions.entry_status is 'posted, pending, or void';
comment on column public.finance_transactions.recurrence_status is 'active or cancelled for a subscription template';
