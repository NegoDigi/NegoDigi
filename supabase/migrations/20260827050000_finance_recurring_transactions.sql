-- Finance movement metadata. A subscription is a recurring movement template;
-- generated occurrences are normal rows linked through recurrence_parent_id.
alter table public.finance_transactions
  add column if not exists movement_kind text not null default 'one_off',
  add column if not exists is_recurring boolean not null default false,
  add column if not exists recurrence_interval text,
  add column if not exists next_occurrence_on date,
  add column if not exists recurrence_parent_id uuid references public.finance_transactions(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'finance_transactions_movement_kind_check'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_movement_kind_check
      check (movement_kind in ('one_off', 'subscription'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'finance_transactions_recurrence_check'
      and conrelid = 'public.finance_transactions'::regclass
  ) then
    alter table public.finance_transactions
      add constraint finance_transactions_recurrence_check
      check (
        (is_recurring = false and recurrence_interval is null and next_occurrence_on is null)
        or (is_recurring = true and movement_kind = 'subscription' and recurrence_interval = 'monthly' and next_occurrence_on is not null)
      );
  end if;
end $$;

create index if not exists finance_transactions_recurring_due_idx
  on public.finance_transactions (organization_id, next_occurrence_on)
  where is_recurring = true;
create index if not exists finance_transactions_recurrence_parent_idx
  on public.finance_transactions (recurrence_parent_id);

comment on column public.finance_transactions.movement_kind is 'one_off or subscription';
comment on column public.finance_transactions.next_occurrence_on is 'Next date to generate for a monthly subscription template';

-- Run from the authenticated app on refresh. The unique source key makes the
-- operation idempotent if two browser tabs refresh at the same time.
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
      and next_occurrence_on is not null
      and next_occurrence_on <= current_date
      and private.has_role(organization_id, array['owner','admin']::public.app_role[])
    order by next_occurrence_on, id
  loop
    occurrence := template.next_occurrence_on;
    -- A bounded catch-up prevents an old template from generating unbounded rows.
    for i in 1..120 loop
      exit when occurrence > current_date;
      insert into public.finance_transactions (
        organization_id, transaction_type, amount, concept, category, account,
        occurred_on, client_id, editor_id, receivable_id, proof_url, source,
        source_key, movement_kind, is_recurring, recurrence_interval,
        next_occurrence_on, recurrence_parent_id
      ) values (
        template.organization_id, template.transaction_type, template.amount,
        template.concept, template.category, template.account, occurrence,
        template.client_id, template.editor_id, null, template.proof_url,
        'subscription', 'subscription:' || template.id::text || ':' || occurrence::text,
        'subscription', false, null, null, template.id
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
      and next_occurrence_on = template.next_occurrence_on;
  end loop;

  return generated;
end;
$$;

revoke execute on function public.process_recurring_finance_transactions() from public, anon, authenticated;
grant execute on function public.process_recurring_finance_transactions() to authenticated;

-- RLS predicates call private helper functions. USAGE is required for the
-- authenticated role to resolve the qualified function names.
grant usage on schema private to authenticated;

-- A delivered job owns its delivery rows. The former RESTRICT foreign key
-- made the three-dot delete action fail for every job with deliveries.
alter table public.job_deliveries drop constraint if exists job_deliveries_job_item_id_fkey;
alter table public.job_deliveries
  add constraint job_deliveries_job_item_id_fkey
  foreign key (job_item_id) references public.job_items(id) on delete cascade;

-- Supabase Cron invokes the same idempotent processor every night. The public
-- function is SECURITY INVOKER, so authenticated callers still remain bounded
-- by RLS while the scheduler (postgres) can process every organization.
create extension if not exists pg_cron;
do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'negodigi-process-recurring-finance';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
  perform cron.schedule(
    'negodigi-process-recurring-finance',
    '5 0 * * *',
    $cron$select public.process_recurring_finance_transactions();$cron$
  );
end $$;
