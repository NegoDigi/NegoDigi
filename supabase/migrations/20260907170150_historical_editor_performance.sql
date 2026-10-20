-- Include non-billable historical summary rows in editor comparisons.
-- They are production evidence only and never create Finance movements.
create or replace view public.editor_monthly_performance
with (security_invoker = true)
as
with correction_counts as (
  select submission_item_id, count(*)::integer as correction_count
  from public.delivery_corrections
  group by submission_item_id
), video_events as (
  select
    s.organization_id,
    a.editor_id,
    e.name as editor_name,
    to_char(coalesce(i.reviewed_at, s.created_at) at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'), 'YYYY-MM') as period_key,
    1::numeric as submitted_videos,
    case when i.status = 'approved' then 1 else 0 end::numeric as approved_videos,
    case when s.was_late then 1 else 0 end::numeric as late_videos,
    case when not s.was_late then 1 else 0 end::numeric as on_time_videos,
    coalesce(cc.correction_count, 0)::numeric as correction_count,
    coalesce(d.quantity * coalesce(fs.client_unit_price, d.client_unit_price, 0), 0)::numeric as client_amount,
    coalesce(d.quantity * coalesce(fs.editor_unit_cost, 0), 0)::numeric as editor_amount,
    coalesce(d.quantity * (coalesce(fs.client_unit_price, d.client_unit_price, 0) - coalesce(fs.editor_unit_cost, 0)), 0)::numeric as net_profit,
    greatest(0, extract(epoch from (s.created_at - (a.assigned_on::timestamp at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid')))) / 3600) as delivery_hours,
    case when i.status = 'approved' and i.reviewed_at is not null then greatest(0, extract(epoch from (i.reviewed_at - s.created_at)) / 3600) else null end as resolution_hours
  from public.delivery_submission_items i
  join public.delivery_submissions s on s.id = i.submission_id
  join public.job_assignments a on a.id = s.assignment_id
  join public.editors e on e.id = a.editor_id
  join public.organizations o on o.id = s.organization_id
  left join public.job_deliveries d on d.submission_item_id = i.id
  left join public.production_delivery_financial_snapshots fs on fs.delivery_id = d.id
  left join correction_counts cc on cc.submission_item_id = i.id
), historical_events as (
  select
    d.organization_id,
    a.editor_id,
    e.name as editor_name,
    to_char(d.delivered_on, 'YYYY-MM') as period_key,
    d.quantity::numeric as submitted_videos,
    d.quantity::numeric as approved_videos,
    case when a.due_on is not null and d.delivered_on > a.due_on then d.quantity else 0 end::numeric as late_videos,
    case when a.due_on is null or d.delivered_on <= a.due_on then d.quantity else 0 end::numeric as on_time_videos,
    0::numeric as correction_count,
    (d.quantity * coalesce(fs.client_unit_price, d.client_unit_price, 0))::numeric as client_amount,
    (d.quantity * coalesce(fs.editor_unit_cost, 0))::numeric as editor_amount,
    (d.quantity * (coalesce(fs.client_unit_price, d.client_unit_price, 0) - coalesce(fs.editor_unit_cost, 0)))::numeric as net_profit,
    greatest(0, extract(epoch from (d.delivered_on::timestamp - a.assigned_on::timestamp)) / 3600) as delivery_hours,
    0::numeric as resolution_hours
  from public.job_deliveries d
  join public.job_assignments a on a.id = d.assignment_id
  join public.editors e on e.id = a.editor_id
  left join public.production_delivery_financial_snapshots fs on fs.delivery_id = d.id
  where d.submission_item_id is null
), summary_events as (
  select
    h.organization_id,
    h.editor_id,
    e.name as editor_name,
    h.period_key,
    1::numeric as submitted_videos,
    1::numeric as approved_videos,
    0::numeric as late_videos,
    1::numeric as on_time_videos,
    0::numeric as correction_count,
    h.amount::numeric as client_amount,
    h.amount::numeric as editor_amount,
    0::numeric as net_profit,
    0::numeric as delivery_hours,
    0::numeric as resolution_hours
  from public.production_historical_work_items h
  join public.editors e on e.id = h.editor_id
), combined as (
  select * from video_events
  union all select * from historical_events
  union all select * from summary_events
)
select
  organization_id,
  editor_id,
  max(editor_name) as editor_name,
  period_key,
  coalesce(sum(submitted_videos), 0)::integer as submitted_videos,
  coalesce(sum(approved_videos), 0)::integer as approved_videos,
  coalesce(sum(late_videos), 0)::integer as late_videos,
  coalesce(sum(on_time_videos), 0)::integer as on_time_videos,
  coalesce(sum(correction_count), 0)::integer as correction_count,
  coalesce(sum(client_amount), 0)::numeric(12,2) as client_amount,
  coalesce(sum(editor_amount), 0)::numeric(12,2) as editor_amount,
  coalesce(sum(net_profit), 0)::numeric(12,2) as net_profit,
  coalesce(avg(delivery_hours), 0)::numeric(12,2) as avg_delivery_hours,
  coalesce(avg(resolution_hours), 0)::numeric(12,2) as avg_resolution_hours
from combined
group by organization_id, editor_id, period_key;

grant select on public.editor_monthly_performance to authenticated;
