-- Final Production registry guarantees: stable video identity, atomic partial
-- submissions, immutable delivery prices and explicit planned/assigned dates.

alter table public.jobs
  add column if not exists planned_on date;

update public.jobs
set planned_on = assigned_on
where status = 'planned'
  and planned_on is null;

alter table public.delivery_submission_items
  add column if not exists job_id uuid references public.jobs(id) on delete cascade,
  add column if not exists video_number integer;

with numbered as (
  select
    i.id,
    s.job_id,
    row_number() over (
      partition by s.job_id
      order by i.created_at, i.id
    )::integer as video_number
  from public.delivery_submission_items i
  join public.delivery_submissions s on s.id = i.submission_id
)
update public.delivery_submission_items i
set job_id = numbered.job_id,
    video_number = numbered.video_number
from numbered
where numbered.id = i.id
  and (i.job_id is null or i.video_number is null);

alter table public.delivery_submission_items
  alter column job_id set not null,
  alter column video_number set not null,
  add constraint delivery_submission_items_video_number_positive
    check (video_number > 0);

create unique index if not exists delivery_submission_items_job_video_unique
  on public.delivery_submission_items (job_id, video_number);

create or replace function private.prepare_delivery_video_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_job uuid;
begin
  select s.job_id into parent_job
  from public.delivery_submissions s
  where s.id = new.submission_id;

  if parent_job is null then
    raise exception 'No se encontró el pedido de esta entrega';
  end if;

  new.job_id := parent_job;

  -- Serialise numbering per order. The unique index is the final safeguard.
  perform 1 from public.jobs j where j.id = parent_job for update;
  if new.video_number is null then
    select coalesce(max(i.video_number), 0) + 1
      into new.video_number
    from public.delivery_submission_items i
    where i.job_id = parent_job;
  end if;

  if coalesce(trim(new.label), '') = ''
     or new.label ~ '^Vídeo [0-9]+$' then
    new.label := format('Vídeo %s', new.video_number);
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_items_prepare_identity on public.delivery_submission_items;
create trigger delivery_items_prepare_identity
before insert or update of submission_id, video_number, label
on public.delivery_submission_items
for each row execute function private.prepare_delivery_video_identity();

create table if not exists public.production_delivery_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_id uuid not null unique references public.job_deliveries(id) on delete cascade,
  client_unit_price numeric(12,2) not null default 0,
  editor_unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.production_delivery_financial_snapshots enable row level security;

drop policy if exists "production delivery snapshots read" on public.production_delivery_financial_snapshots;
create policy "production delivery snapshots read"
on public.production_delivery_financial_snapshots for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1
    from public.job_deliveries d
    where d.id = production_delivery_financial_snapshots.delivery_id
      and private.can_access_assignment(d.assignment_id)
  )
);

revoke all on public.production_delivery_financial_snapshots from anon;
grant select on public.production_delivery_financial_snapshots to authenticated;

insert into public.production_delivery_financial_snapshots
  (organization_id, delivery_id, client_unit_price, editor_unit_cost, created_at)
select
  d.organization_id,
  d.id,
  coalesce(d.client_unit_price, 0),
  coalesce(ai.editor_unit_cost, 0),
  d.created_at
from public.job_deliveries d
left join public.job_assignment_items ai
  on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
on conflict (delivery_id) do nothing;

create or replace function private.capture_production_delivery_financial_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.production_delivery_financial_snapshots
    (organization_id, delivery_id, client_unit_price, editor_unit_cost)
  select
    new.organization_id,
    new.id,
    coalesce(new.client_unit_price, 0),
    coalesce(ai.editor_unit_cost, 0)
  from public.job_assignment_items ai
  where ai.assignment_id = new.assignment_id
    and ai.job_item_id = new.job_item_id
  on conflict (delivery_id) do nothing;
  return new;
end;
$$;

drop trigger if exists capture_production_delivery_financial_snapshot on public.job_deliveries;
create trigger capture_production_delivery_financial_snapshot
after insert on public.job_deliveries
for each row execute function private.capture_production_delivery_financial_snapshot();

create or replace function private.validate_delivery_submission_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_capacity numeric;
  accepted_quantity numeric;
  reserved_quantity numeric;
  requested_quantity numeric;
begin
  select ai.assigned_quantity, ai.delivered_quantity
    into assignment_capacity, accepted_quantity
  from public.job_assignment_items ai
  where ai.assignment_id = new.assignment_id
    and ai.job_item_id = new.job_item_id
  for update;

  if assignment_capacity is null then
    raise exception 'El servicio no pertenece a esta asignación';
  end if;

  select coalesce(sum(greatest(0, s.quantity - s.approved_quantity)), 0)
    into reserved_quantity
  from public.delivery_submissions s
  where s.assignment_id = new.assignment_id
    and s.job_item_id = new.job_item_id
    and s.status in ('pending_review', 'changes_requested')
    and s.id <> new.id;

  requested_quantity := case
    when new.status in ('pending_review', 'changes_requested')
      then greatest(0, new.quantity - new.approved_quantity)
    else 0
  end;

  if accepted_quantity + reserved_quantity + requested_quantity > assignment_capacity then
    raise exception 'La entrega supera las unidades pendientes de esta asignación';
  end if;

  return new;
end;
$$;

drop trigger if exists delivery_submissions_validate_capacity on public.delivery_submissions;
create trigger delivery_submissions_validate_capacity
before insert or update of assignment_id, job_item_id, quantity, approved_quantity, status
on public.delivery_submissions
for each row execute function private.validate_delivery_submission_capacity();

create or replace function public.submit_delivery_items(
  target_assignment uuid,
  target_job_item uuid,
  delivery_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_org uuid;
  parent record;
  submission_id uuid := gen_random_uuid();
  item_count integer;
begin
  select p.organization_id into actor_org
  from public.profiles p
  where p.id = auth.uid() and p.active = true;

  if actor_org is null or not private.can_access_assignment(target_assignment) then
    raise exception 'No tienes acceso a esta asignación';
  end if;

  select a.organization_id, a.job_id
    into parent
  from public.job_assignments a
  join public.job_assignment_items ai
    on ai.assignment_id = a.id and ai.job_item_id = target_job_item
  where a.id = target_assignment
    and a.organization_id = actor_org
  for update of ai;

  if parent.job_id is null then
    raise exception 'No se encontró el servicio asignado';
  end if;

  if jsonb_typeof(delivery_items) <> 'array' then
    raise exception 'La entrega necesita una lista de vídeos';
  end if;

  item_count := jsonb_array_length(delivery_items);
  if item_count < 1 then
    raise exception 'Añade al menos un vídeo';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(delivery_items) item
    where coalesce(trim(item->>'url'), '') = ''
  ) then
    raise exception 'Cada vídeo necesita un enlace';
  end if;

  insert into public.delivery_submissions
    (id, organization_id, assignment_id, job_id, job_item_id, submitted_by,
     quantity, approved_quantity, folder_url, status)
  values
    (submission_id, actor_org, target_assignment, parent.job_id,
     target_job_item, auth.uid(), item_count, 0, null, 'pending_review');

  insert into public.delivery_submission_items
    (organization_id, submission_id, label, url, status)
  select
    actor_org,
    submission_id,
    coalesce(nullif(trim(item->>'label'), ''), 'Vídeo'),
    trim(item->>'url'),
    'pending_review'
  from jsonb_array_elements(delivery_items) with ordinality as rows(item, position)
  order by position;

  return submission_id;
end;
$$;

revoke all on function public.submit_delivery_items(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_delivery_items(uuid, uuid, jsonb) to authenticated;

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
  coalesce(
    i.video_number,
    row_number() over (
      partition by j.id
      order by coalesce(i.created_at, d.delivered_on::timestamp), d.id
    )::integer
  ) as video_number,
  d.quantity,
  coalesce(fs.client_unit_price, d.client_unit_price, 0)::numeric(12,2) as client_unit_price,
  coalesce(fs.editor_unit_cost, 0)::numeric(12,2) as editor_unit_cost,
  (d.quantity * coalesce(fs.client_unit_price, d.client_unit_price, 0))::numeric(12,2) as client_total,
  (d.quantity * coalesce(fs.editor_unit_cost, 0))::numeric(12,2) as editor_total,
  (d.quantity * (coalesce(fs.client_unit_price, d.client_unit_price, 0) - coalesce(fs.editor_unit_cost, 0)))::numeric(12,2) as net_profit,
  a.assigned_on,
  j.planned_on,
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
left join public.delivery_submission_items i on i.id = d.submission_item_id
left join public.delivery_submissions s on s.id = i.submission_id
left join public.production_delivery_financial_snapshots fs on fs.delivery_id = d.id
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
    coalesce(d.quantity * coalesce(fs.client_unit_price, d.client_unit_price, 0), 0)::numeric as client_amount,
    coalesce(d.quantity * coalesce(fs.editor_unit_cost, 0), 0)::numeric as editor_amount,
    coalesce(d.quantity * (coalesce(fs.client_unit_price, d.client_unit_price, 0) - coalesce(fs.editor_unit_cost, 0)), 0)::numeric as net_profit,
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

-- Closed period snapshots are inserted once. Re-running the hourly rollover is
-- idempotent and cannot rewrite a closed month's figures.
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
          coalesce(fs.client_unit_price, d.client_unit_price, 0) as client_unit_price,
          coalesce(fs.editor_unit_cost, 0) as editor_unit_cost,
          coalesce((i.reviewed_at at time zone org.timezone)::date, d.delivered_on) as period_date
        from public.job_deliveries d
        left join public.production_delivery_financial_snapshots fs on fs.delivery_id = d.id
        left join public.delivery_submission_items i on i.id = d.submission_item_id
        where d.organization_id = org.id
      )
      select jsonb_build_object(
        'approved_units', coalesce((select sum(d.quantity) from approved_deliveries d where d.period_date >= period_row.period_start and d.period_date < period_row.period_end), 0),
        'client_amount', coalesce((select sum(d.quantity * d.client_unit_price) from approved_deliveries d where d.period_date >= period_row.period_start and d.period_date < period_row.period_end), 0),
        'editor_amount', coalesce((select sum(d.quantity * d.editor_unit_cost) from approved_deliveries d where d.period_date >= period_row.period_start and d.period_date < period_row.period_end), 0),
        'net_profit', coalesce((select sum(d.quantity * (d.client_unit_price - d.editor_unit_cost)) from approved_deliveries d where d.period_date >= period_row.period_start and d.period_date < period_row.period_end), 0),
        'bonus_payments', coalesce((select sum(b.initial_amount) from public.bonus_accounts b where b.organization_id = org.id and b.paid_on >= period_row.period_start and b.paid_on < period_row.period_end), 0),
        'bonus_usage', coalesce((select sum(m.amount) from public.bonus_movements m where m.organization_id = org.id and m.movement_type = 'usage' and m.occurred_on >= period_row.period_start and m.occurred_on < period_row.period_end), 0),
        'pending_payments', coalesce((select sum(r.amount) from public.receivables r where r.organization_id = org.id and coalesce(r.started_on, r.created_at::date) >= period_row.period_start and coalesce(r.started_on, r.created_at::date) < period_row.period_end), 0),
        'late_units', coalesce((select sum(s.quantity) from public.delivery_submissions s where s.organization_id = org.id and s.was_late and (s.created_at at time zone org.timezone)::date >= period_row.period_start and (s.created_at at time zone org.timezone)::date < period_row.period_end), 0),
        'corrections', coalesce((select count(*) from public.delivery_corrections c where c.organization_id = org.id and (c.created_at at time zone org.timezone)::date >= period_row.period_start and (c.created_at at time zone org.timezone)::date < period_row.period_end), 0)
      ) into period_metrics;

      insert into public.production_period_snapshots
        (organization_id, period_id, metrics, closed_at)
      values
        (org.id, period_row.id, period_metrics, coalesce(period_row.closed_at, reference_at))
      on conflict (period_id) do nothing;
    end loop;
  end loop;
end;
$$;

revoke all on function private.roll_production_periods(timestamptz) from public, anon, authenticated;
