-- Permanent production periods, derived video history, editor performance,
-- activity/availability and idempotent notification maintenance.

create table if not exists public.production_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  timezone text not null default 'Europe/Madrid',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_start),
  check (period_end > period_start)
);

create unique index if not exists production_periods_one_active_idx
  on public.production_periods(organization_id)
  where status = 'active';

create index if not exists production_periods_timeline_idx
  on public.production_periods(organization_id, period_start desc);

create table if not exists public.production_period_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.production_periods(id) on delete cascade,
  metrics jsonb not null default '{}'::jsonb,
  closed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id)
);

alter table public.production_periods enable row level security;
alter table public.production_period_snapshots enable row level security;

drop policy if exists "production periods admin read" on public.production_periods;
create policy "production periods admin read"
on public.production_periods for select to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

drop policy if exists "production snapshots admin read" on public.production_period_snapshots;
create policy "production snapshots admin read"
on public.production_period_snapshots for select to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

revoke all on public.production_periods from anon;
revoke all on public.production_period_snapshots from anon;
grant select on public.production_periods to authenticated;
grant select on public.production_period_snapshots to authenticated;

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
      select jsonb_build_object(
        'approved_units', coalesce((
          select sum(d.quantity)
          from public.job_deliveries d
          where d.organization_id = org.id
            and d.delivered_on >= period_row.period_start
            and d.delivered_on < period_row.period_end
        ), 0),
        'client_amount', coalesce((
          select sum(d.quantity * coalesce(d.client_unit_price, 0))
          from public.job_deliveries d
          where d.organization_id = org.id
            and d.delivered_on >= period_row.period_start
            and d.delivered_on < period_row.period_end
        ), 0),
        'editor_amount', coalesce((
          select sum(d.quantity * coalesce(ai.editor_unit_cost, 0))
          from public.job_deliveries d
          left join public.job_assignment_items ai
            on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
          where d.organization_id = org.id
            and d.delivered_on >= period_row.period_start
            and d.delivered_on < period_row.period_end
        ), 0),
        'net_profit', coalesce((
          select sum(d.quantity * (coalesce(d.client_unit_price, 0) - coalesce(ai.editor_unit_cost, 0)))
          from public.job_deliveries d
          left join public.job_assignment_items ai
            on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
          where d.organization_id = org.id
            and d.delivered_on >= period_row.period_start
            and d.delivered_on < period_row.period_end
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

with organization_bounds as (
  select
    o.id as organization_id,
    coalesce(nullif(o.timezone, ''), 'Europe/Madrid') as timezone,
    least(
      coalesce((select min(j.created_at)::date from public.jobs j where j.organization_id = o.id), current_date),
      coalesce((select min(d.created_at)::date from public.job_deliveries d where d.organization_id = o.id), current_date),
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

select cron.schedule(
  'negodigi-production-period-rollover',
  '7 * * * *',
  'select private.roll_production_periods(now());'
);

create or replace function private.cleanup_read_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count integer;
begin
  delete from public.notifications
  where read_at is not null and read_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.cleanup_read_notifications() from public, anon, authenticated;

select cron.schedule(
  'negodigi-clean-read-notifications',
  '25 2 * * *',
  'select private.cleanup_read_notifications();'
);

create table if not exists public.editor_activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  editor_id uuid not null references public.editors(id) on delete cascade,
  status text not null check (status in ('active', 'inactive', 'editing', 'correcting', 'unavailable')),
  available_from timestamptz,
  available_until timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (available_until is null or available_from is null or available_until > available_from)
);

create index if not exists editor_activity_events_latest_idx
  on public.editor_activity_events(editor_id, created_at desc);

alter table public.editor_activity_events enable row level security;

drop policy if exists "editor activity read" on public.editor_activity_events;
create policy "editor activity read"
on public.editor_activity_events for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_activity_events.editor_id and e.user_id = auth.uid()
  )
);

drop policy if exists "editor activity insert" on public.editor_activity_events;
create policy "editor activity insert"
on public.editor_activity_events for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_activity_events.editor_id and e.user_id = auth.uid()
    )
  )
);

revoke all on public.editor_activity_events from anon;
grant select, insert on public.editor_activity_events to authenticated;

-- Editor responses are allowed; the obsolete self-validation flag is not.
create or replace function private.guard_delivery_correction_editor_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_role public.app_role;
begin
  select p.role into actor_role
  from public.profiles p
  where p.id = auth.uid() and p.active = true;

  if actor_role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    if new.organization_id is distinct from old.organization_id
       or new.submission_item_id is distinct from old.submission_item_id
       or new.created_by is distinct from old.created_by
       or new.body is distinct from old.body
       or new.editor_completed is distinct from old.editor_completed
       or new.reviewed_at is distinct from old.reviewed_at
       or new.closed_at is distinct from old.closed_at
       or (new.status is distinct from old.status and new.status <> 'responded')
       or (new.status = 'responded' and new.editor_response is null) then
      raise exception 'Los editores solo pueden responder a sus correcciones';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_delivery_correction_editor_update() from public, anon, authenticated;

-- Repair approved video rows created before per-video accounting became
-- mandatory. The source item is the idempotency key, so no payment can repeat.
insert into public.job_deliveries
  (organization_id, assignment_id, job_item_id, quantity, delivered_on, notes, submission_item_id)
select
  s.organization_id,
  s.assignment_id,
  s.job_item_id,
  1,
  coalesce(i.reviewed_at, s.created_at)::date,
  'Vídeo aprobado recuperado por integridad de Producción',
  i.id
from public.delivery_submission_items i
join public.delivery_submissions s on s.id = i.submission_id
where i.status = 'approved'
  and s.job_item_id is not null
  and not exists (
    select 1 from public.job_deliveries d where d.submission_item_id = i.id
  )
on conflict (submission_item_id) where submission_item_id is not null do nothing;

with item_counts as (
  select
    s.id,
    count(i.id)::numeric as item_count,
    count(i.id) filter (where i.status = 'approved')::numeric as approved_count
  from public.delivery_submissions s
  join public.delivery_submission_items i on i.submission_id = s.id
  group by s.id
)
update public.delivery_submissions s
set approved_quantity = c.approved_count,
    status = case
      when c.item_count > 0 and c.approved_count = c.item_count then 'approved'
      when exists (
        select 1 from public.delivery_submission_items i
        where i.submission_id = s.id and i.status = 'changes_requested'
      ) then 'changes_requested'
      else 'pending_review'
    end,
    updated_at = now()
from item_counts c
where c.id = s.id
  and (s.approved_quantity is distinct from c.approved_count
       or (c.item_count > 0 and c.approved_count = c.item_count and s.status <> 'approved'));

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
    order by coalesce(i.created_at, d.created_at), d.id
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
  coalesce(s.created_at, d.created_at) as delivered_at,
  coalesce(i.reviewed_at, d.created_at) as approved_at,
  coalesce(cc.correction_count, 0) as correction_count,
  coalesce(vh.version_count, case when i.id is null then 0 else 1 end) as version_count,
  coalesce(vh.versions, '[]'::jsonb) as versions,
  coalesce(s.was_late, a.due_on is not null and d.delivered_on > a.due_on) as was_late,
  'approved'::text as status,
  to_char(
    coalesce(i.reviewed_at, d.created_at) at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'),
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

-- Editors need the client label/resources of jobs assigned through the current
-- many-editor relation, even when the legacy jobs.editor_id column is empty.
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or user_id = (select auth.uid())
  or exists (
    select 1
    from public.jobs j
    join public.job_assignments a on a.job_id = j.id
    join public.editors e on e.id = a.editor_id
    where j.client_id = clients.id and e.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.jobs j
    join public.editors e on e.id = j.editor_id
    where j.client_id = clients.id and e.user_id = (select auth.uid())
  )
);

create or replace view public.editor_monthly_performance
with (security_invoker = true)
as
with correction_counts as (
  select submission_item_id, count(*)::integer as correction_count
  from public.delivery_corrections
  group by submission_item_id
)
select
  s.organization_id,
  a.editor_id,
  e.name as editor_name,
  to_char(
    coalesce(i.reviewed_at, s.created_at) at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'),
    'YYYY-MM'
  ) as period_key,
  count(i.id)::integer as submitted_videos,
  count(i.id) filter (where i.status = 'approved')::integer as approved_videos,
  count(i.id) filter (where s.was_late)::integer as late_videos,
  count(i.id) filter (where not s.was_late)::integer as on_time_videos,
  coalesce(sum(cc.correction_count), 0)::integer as correction_count,
  coalesce(sum(d.quantity * coalesce(d.client_unit_price, 0)), 0)::numeric(12,2) as client_amount,
  coalesce(sum(d.quantity * coalesce(ai.editor_unit_cost, 0)), 0)::numeric(12,2) as editor_amount,
  coalesce(sum(d.quantity * (coalesce(d.client_unit_price, 0) - coalesce(ai.editor_unit_cost, 0))), 0)::numeric(12,2) as net_profit,
  coalesce(avg(extract(epoch from (s.created_at - a.created_at)) / 3600), 0)::numeric(12,2) as avg_delivery_hours,
  coalesce(avg(extract(epoch from (i.reviewed_at - s.created_at)) / 3600) filter (where i.status = 'approved'), 0)::numeric(12,2) as avg_resolution_hours
from public.delivery_submission_items i
join public.delivery_submissions s on s.id = i.submission_id
join public.job_assignments a on a.id = s.assignment_id
join public.editors e on e.id = a.editor_id
join public.organizations o on o.id = s.organization_id
left join public.job_assignment_items ai
  on ai.assignment_id = a.id and ai.job_item_id = s.job_item_id
left join public.job_deliveries d on d.submission_item_id = i.id
left join correction_counts cc on cc.submission_item_id = i.id
group by s.organization_id, a.editor_id, e.name,
  to_char(
    coalesce(i.reviewed_at, s.created_at) at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'),
    'YYYY-MM'
  );

grant select on public.editor_monthly_performance to authenticated;

create or replace function private.notify_delivery_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client_name text;
  editor_name text;
  job_title text;
  service_name text;
begin
  if tg_op <> 'INSERT' or new.status <> 'pending_review' then
    return new;
  end if;

  select c.name, j.title, ji.service, e.name
    into client_name, job_title, service_name, editor_name
  from public.jobs j
  join public.clients c on c.id = j.client_id
  left join public.job_items ji on ji.id = new.job_item_id
  left join public.job_assignments ja on ja.id = new.assignment_id
  left join public.editors e on e.id = ja.editor_id
  where j.id = new.job_id;

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  select
    new.organization_id,
    p.id,
    format('El editor %s ha enviado una entrega', coalesce(editor_name, 'Editor')),
    format('%s · %s · %s · %s vídeo(s) para revisar.',
      coalesce(client_name, 'Cliente'),
      coalesce(editor_name, 'Editor'),
      coalesce(job_title, 'Trabajo'),
      trim(to_char(new.quantity, 'FM999999990.##'))
    ),
    format('/operaciones?job=%s&submission=%s&event=delivery', new.job_id, new.id)
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    and p.active = true
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_delivery_submission() from public, anon, authenticated;

create or replace function private.notify_delivery_item_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent record;
begin
  if new.version_number <= 1 then
    return new;
  end if;

  select
    s.organization_id,
    s.job_id,
    s.id as submission_id,
    i.label,
    c.name as client_name,
    e.name as editor_name,
    j.title as job_title
  into parent
  from public.delivery_submission_items i
  join public.delivery_submissions s on s.id = i.submission_id
  join public.jobs j on j.id = s.job_id
  join public.clients c on c.id = j.client_id
  join public.job_assignments a on a.id = s.assignment_id
  join public.editors e on e.id = a.editor_id
  where i.id = new.submission_item_id;

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  select
    parent.organization_id,
    p.id,
    format('El editor %s ha enviado una versión corregida', coalesce(parent.editor_name, 'Editor')),
    format('%s · %s · %s · %s · versión %s.',
      coalesce(parent.client_name, 'Cliente'),
      coalesce(parent.editor_name, 'Editor'),
      coalesce(parent.job_title, 'Trabajo'),
      coalesce(parent.label, 'Vídeo'),
      new.version_number
    ),
    format('/operaciones?job=%s&submission=%s&video=%s&event=version-%s',
      parent.job_id, parent.submission_id, new.submission_item_id, new.version_number
    )
  from public.profiles p
  where p.organization_id = parent.organization_id
    and p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    and p.active = true
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_delivery_item_version() from public, anon, authenticated;

drop trigger if exists notify_delivery_item_version on public.delivery_item_versions;
create trigger notify_delivery_item_version
after insert on public.delivery_item_versions
for each row execute function private.notify_delivery_item_version();

create or replace function private.notify_delivery_item_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  client_name text;
  editor_name text;
  job_title text;
  job_id uuid;
  event_key text;
begin
  if new.status not in ('approved', 'changes_requested')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select e.user_id, c.name, e.name, j.title, j.id
    into target_user, client_name, editor_name, job_title, job_id
  from public.delivery_submissions ds
  join public.jobs j on j.id = ds.job_id
  join public.clients c on c.id = j.client_id
  join public.job_assignments ja on ja.id = ds.assignment_id
  join public.editors e on e.id = ja.editor_id
  where ds.id = new.submission_id;

  if target_user is null then
    return new;
  end if;

  event_key := format('%s-%s', new.status, extract(epoch from coalesce(new.reviewed_at, now()))::bigint);

  insert into public.notifications (organization_id, user_id, title, body, action_url)
  values (
    new.organization_id,
    target_user,
    case when new.status = 'approved'
      then 'Tu trabajo ha sido aprobado'
      else 'El administrador ha solicitado cambios'
    end,
    format('%s · %s · %s · %s (%s).',
      coalesce(client_name, 'Cliente'),
      coalesce(editor_name, 'Editor'),
      coalesce(job_title, 'Trabajo'),
      coalesce(new.label, 'Vídeo'),
      case when new.status = 'approved' then 'aprobado' else 'correcciones pendientes' end
    ),
    format('/operaciones?job=%s&submission=%s&video=%s&event=%s',
      job_id, new.submission_id, new.id, event_key
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.notify_delivery_item_review() from public, anon, authenticated;

