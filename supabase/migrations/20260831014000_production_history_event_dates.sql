-- Keep manual historical imports in the month of their real delivery date,
-- and include them in editor performance without duplicating submitted videos.

create or replace view public.production_video_history
with (security_invoker = true)
as
with correction_counts as (
  select submission_item_id, count(*)::integer as correction_count
  from public.delivery_corrections
  group by submission_item_id
), version_history as (
  select
    submission_item_id,
    count(*)::integer as version_count,
    jsonb_agg(
      jsonb_build_object(
        'version', version_number,
        'url', url,
        'submitted_at', submitted_at,
        'current', is_current
      ) order by version_number
    ) as versions
  from public.delivery_item_versions
  group by submission_item_id
)
select
  d.id as delivery_id,
  d.organization_id,
  j.id as job_id,
  j.title as job_title,
  j.client_id,
  c.name as client_name,
  a.id as assignment_id,
  a.editor_id,
  e.name as editor_name,
  d.job_item_id,
  ji.service,
  d.submission_item_id as video_id,
  coalesce(i.label, 'Entrega histórica') as video_label,
  row_number() over (
    partition by j.id
    order by coalesce(i.created_at, d.delivered_on::timestamp), d.id
  )::integer as video_number,
  d.quantity,
  coalesce(d.client_unit_price, 0)::numeric(12,2) as client_unit_price,
  coalesce(ai.editor_unit_cost, 0)::numeric(12,2) as editor_unit_cost,
  (d.quantity * coalesce(d.client_unit_price, 0))::numeric(12,2) as client_total,
  (d.quantity * coalesce(ai.editor_unit_cost, 0))::numeric(12,2) as editor_total,
  (d.quantity * (coalesce(d.client_unit_price, 0) - coalesce(ai.editor_unit_cost, 0)))::numeric(12,2) as net_profit,
  a.assigned_on,
  case when j.status = 'planned' then j.assigned_on else null end as planned_on,
  a.due_on,
  coalesce(
    s.created_at,
    d.delivered_on::timestamp at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid')
  ) as delivered_at,
  coalesce(
    i.reviewed_at,
    d.delivered_on::timestamp at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid')
  ) as approved_at,
  coalesce(cc.correction_count, 0) as correction_count,
  coalesce(vh.version_count, case when i.id is null then 0 else 1 end) as version_count,
  coalesce(vh.versions, '[]'::jsonb) as versions,
  coalesce(s.was_late, a.due_on is not null and d.delivered_on > a.due_on) as was_late,
  'approved'::text as status,
  to_char(
    coalesce(
      i.reviewed_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'),
      d.delivered_on::timestamp
    ),
    'YYYY-MM'
  ) as period_key,
  d.billable
from public.job_deliveries d
join public.job_assignments a on a.id = d.assignment_id
join public.jobs j on j.id = a.job_id
join public.organizations o on o.id = d.organization_id
join public.clients c on c.id = j.client_id
join public.editors e on e.id = a.editor_id
join public.job_items ji on ji.id = d.job_item_id
left join public.job_assignment_items ai
  on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
left join public.delivery_submission_items i on i.id = d.submission_item_id
left join public.delivery_submissions s on s.id = i.submission_id
left join correction_counts cc on cc.submission_item_id = i.id
left join version_history vh on vh.submission_item_id = i.id;

grant select on public.production_video_history to authenticated;

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
    to_char(
      coalesce(i.reviewed_at, s.created_at)
        at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'),
      'YYYY-MM'
    ) as period_key,
    1::numeric as submitted_videos,
    case when i.status = 'approved' then 1 else 0 end::numeric as approved_videos,
    case when s.was_late then 1 else 0 end::numeric as late_videos,
    case when not s.was_late then 1 else 0 end::numeric as on_time_videos,
    coalesce(cc.correction_count, 0)::numeric as correction_count,
    coalesce(d.quantity * coalesce(d.client_unit_price, 0), 0)::numeric as client_amount,
    coalesce(d.quantity * coalesce(ai.editor_unit_cost, 0), 0)::numeric as editor_amount,
    coalesce(d.quantity * (coalesce(d.client_unit_price, 0) - coalesce(ai.editor_unit_cost, 0)), 0)::numeric as net_profit,
    greatest(
      0,
      extract(epoch from (
        s.created_at - (a.assigned_on::timestamp at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'))
      )) / 3600
    ) as delivery_hours,
    case when i.status = 'approved' and i.reviewed_at is not null then
      greatest(0, extract(epoch from (i.reviewed_at - s.created_at)) / 3600)
    else null end as resolution_hours
  from public.delivery_submission_items i
  join public.delivery_submissions s on s.id = i.submission_id
  join public.job_assignments a on a.id = s.assignment_id
  join public.editors e on e.id = a.editor_id
  join public.organizations o on o.id = s.organization_id
  left join public.job_assignment_items ai
    on ai.assignment_id = a.id and ai.job_item_id = s.job_item_id
  left join public.job_deliveries d on d.submission_item_id = i.id
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
    (d.quantity * coalesce(d.client_unit_price, 0))::numeric as client_amount,
    (d.quantity * coalesce(ai.editor_unit_cost, 0))::numeric as editor_amount,
    (d.quantity * (coalesce(d.client_unit_price, 0) - coalesce(ai.editor_unit_cost, 0)))::numeric as net_profit,
    greatest(0, extract(epoch from (d.delivered_on::timestamp - a.assigned_on::timestamp)) / 3600) as delivery_hours,
    0::numeric as resolution_hours
  from public.job_deliveries d
  join public.job_assignments a on a.id = d.assignment_id
  join public.editors e on e.id = a.editor_id
  left join public.job_assignment_items ai
    on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
  where d.submission_item_id is null
), combined as (
  select * from video_events
  union all
  select * from historical_events
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

