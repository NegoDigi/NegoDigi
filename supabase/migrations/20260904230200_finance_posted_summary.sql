-- Only posted movements contribute to the reconciled monthly finance summary.
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
