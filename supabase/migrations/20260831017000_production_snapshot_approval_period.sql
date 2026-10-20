-- Monthly Production summaries must use the same period key as the permanent
-- video history: approval date for reviewed videos, real delivery date for
-- manual historical rows.
create or replace function private.roll_production_periods(reference_at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org record;
  target_start date;
  target_end date;
  period_row record;
  period_metrics jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('negodigi-production-period-rollover'));

  for org in
    select id, coalesce(nullif(timezone, ''), 'Europe/Madrid') as timezone
    from public.organizations
  loop
    target_start := date_trunc('month', reference_at at time zone org.timezone)::date;
    target_end := (target_start + interval '1 month')::date;

    update public.production_periods
    set status = 'closed',
        closed_at = coalesce(closed_at, reference_at),
        updated_at = reference_at
    where organization_id = org.id
      and period_start < target_start
      and status <> 'closed';

    insert into public.production_periods
      (organization_id, period_start, period_end, status, timezone, opened_at)
    values
      (org.id, target_start, target_end, 'active', org.timezone, reference_at)
    on conflict (organization_id, period_start)
    do update set
      period_end = excluded.period_end,
      timezone = excluded.timezone,
      status = case
        when public.production_periods.status = 'closed' then public.production_periods.status
        else 'active'
      end,
      updated_at = reference_at;

    for period_row in
      select p.*
      from public.production_periods p
      where p.organization_id = org.id and p.status = 'closed'
    loop
      with approved_deliveries as (
        select
          d.quantity,
          coalesce(d.client_unit_price, 0) as client_unit_price,
          coalesce(ai.editor_unit_cost, 0) as editor_unit_cost,
          coalesce(
            (i.reviewed_at at time zone org.timezone)::date,
            d.delivered_on
          ) as period_date
        from public.job_deliveries d
        left join public.job_assignment_items ai
          on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
        left join public.delivery_submission_items i
          on i.id = d.submission_item_id
        where d.organization_id = org.id
      )
      select jsonb_build_object(
        'approved_units', coalesce((
          select sum(d.quantity)
          from approved_deliveries d
          where d.period_date >= period_row.period_start
            and d.period_date < period_row.period_end
        ), 0),
        'client_amount', coalesce((
          select sum(d.quantity * d.client_unit_price)
          from approved_deliveries d
          where d.period_date >= period_row.period_start
            and d.period_date < period_row.period_end
        ), 0),
        'editor_amount', coalesce((
          select sum(d.quantity * d.editor_unit_cost)
          from approved_deliveries d
          where d.period_date >= period_row.period_start
            and d.period_date < period_row.period_end
        ), 0),
        'net_profit', coalesce((
          select sum(d.quantity * (d.client_unit_price - d.editor_unit_cost))
          from approved_deliveries d
          where d.period_date >= period_row.period_start
            and d.period_date < period_row.period_end
        ), 0),
        'bonus_payments', coalesce((
          select sum(b.initial_amount)
          from public.bonus_accounts b
          where b.organization_id = org.id
            and b.paid_on >= period_row.period_start
            and b.paid_on < period_row.period_end
        ), 0),
        'bonus_usage', coalesce((
          select sum(m.amount)
          from public.bonus_movements m
          where m.organization_id = org.id
            and m.movement_type = 'usage'
            and m.occurred_on >= period_row.period_start
            and m.occurred_on < period_row.period_end
        ), 0),
        'pending_payments', coalesce((
          select sum(r.amount)
          from public.receivables r
          where r.organization_id = org.id
            and coalesce(r.started_on, r.created_at::date) >= period_row.period_start
            and coalesce(r.started_on, r.created_at::date) < period_row.period_end
        ), 0),
        'late_units', coalesce((
          select sum(s.quantity)
          from public.delivery_submissions s
          where s.organization_id = org.id and s.was_late
            and (s.created_at at time zone org.timezone)::date >= period_row.period_start
            and (s.created_at at time zone org.timezone)::date < period_row.period_end
        ), 0),
        'corrections', coalesce((
          select count(*)
          from public.delivery_corrections c
          where c.organization_id = org.id
            and (c.created_at at time zone org.timezone)::date >= period_row.period_start
            and (c.created_at at time zone org.timezone)::date < period_row.period_end
        ), 0)
      ) into period_metrics;

      insert into public.production_period_snapshots
        (organization_id, period_id, metrics, closed_at)
      values
        (org.id, period_row.id, period_metrics, coalesce(period_row.closed_at, reference_at))
      on conflict (period_id)
      do update set metrics = excluded.metrics,
                    closed_at = excluded.closed_at,
                    updated_at = reference_at;
    end loop;
  end loop;
end;
$$;

revoke all on function private.roll_production_periods(timestamptz) from public, anon, authenticated;
