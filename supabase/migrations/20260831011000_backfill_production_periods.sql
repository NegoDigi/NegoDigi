-- Include imported historic delivery months in the monthly navigator. The
-- period rows are metadata only; original deliveries and accounting stay put.
with organization_bounds as (
  select
    o.id as organization_id,
    coalesce(nullif(o.timezone, ''), 'Europe/Madrid') as timezone,
    least(
      coalesce((select min(j.created_at)::date from public.jobs j where j.organization_id = o.id), current_date),
      coalesce((select min(d.delivered_on) from public.job_deliveries d where d.organization_id = o.id), current_date),
      coalesce((select min(s.created_at)::date from public.delivery_submissions s where s.organization_id = o.id), current_date)
    ) as first_date,
    date_trunc('month', now() at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'))::date as current_period
  from public.organizations o
), periods as (
  select
    b.organization_id,
    b.timezone,
    month_start::date as period_start,
    (month_start + interval '1 month')::date as period_end,
    b.current_period
  from organization_bounds b
  cross join lateral generate_series(
    date_trunc('month', b.first_date)::timestamp,
    b.current_period::timestamp,
    interval '1 month'
  ) month_start
)
insert into public.production_periods
  (organization_id, period_start, period_end, status, timezone, closed_at)
select
  organization_id,
  period_start,
  period_end,
  case when period_start < current_period then 'closed' else 'active' end,
  timezone,
  case when period_start < current_period then now() else null end
from periods
on conflict (organization_id, period_start) do nothing;

select private.roll_production_periods(now());

