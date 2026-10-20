-- Connected editor performance workspace: explainable ranking, immutable monthly
-- results, real activity sessions, personal planning and configurable rewards.
-- This migration is additive and preserves every existing Production record.

alter table public.editors
  add column if not exists avatar_url text,
  add column if not exists joined_on date;

alter table public.editor_activity_events
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists note text,
  add column if not exists updated_at timestamptz not null default now();

-- Legacy activity rows were point-in-time declarations, not timed work. Close
-- them at their creation time so they never become invented productive hours.
update public.editor_activity_events
set started_at = coalesce(started_at, created_at),
    ended_at = coalesce(ended_at, created_at),
    updated_at = coalesce(updated_at, created_at)
where started_at is null or ended_at is null;

alter table public.editor_activity_events
  alter column started_at set default now(),
  alter column started_at set not null;

alter table public.editor_activity_events
  drop constraint if exists editor_activity_events_status_check;

alter table public.editor_activity_events
  add constraint editor_activity_events_status_check
  check (status in (
    'available', 'working', 'waiting', 'inactive',
    'active', 'editing', 'correcting', 'unavailable'
  )),
  add constraint editor_activity_events_session_range_check
  check (ended_at is null or ended_at >= started_at);

create unique index if not exists editor_activity_one_open_session_idx
  on public.editor_activity_events(editor_id)
  where ended_at is null;

create index if not exists editor_activity_period_idx
  on public.editor_activity_events(organization_id, started_at desc);

create or replace function public.set_editor_activity_state(
  target_editor_id uuid,
  target_status text,
  target_available_from timestamptz default null,
  target_available_until timestamptz default null,
  target_note text default null
)
returns public.editor_activity_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  editor_row public.editors%rowtype;
  result_row public.editor_activity_events%rowtype;
  changed_at timestamptz := now();
begin
  if actor_id is null then
    raise exception 'Debes iniciar sesión para actualizar la actividad';
  end if;

  if target_status not in ('available', 'working', 'waiting', 'inactive') then
    raise exception 'Estado de actividad no válido';
  end if;

  if target_available_until is not null
     and target_available_from is not null
     and target_available_until <= target_available_from then
    raise exception 'La hora final debe ser posterior a la hora inicial';
  end if;

  select * into editor_row
  from public.editors e
  where e.id = target_editor_id;

  if editor_row.id is null then
    raise exception 'No se encontró el editor';
  end if;

  if not private.has_role(
    editor_row.organization_id,
    array['owner','admin']::public.app_role[]
  ) and editor_row.user_id is distinct from actor_id then
    raise exception 'No puedes modificar la actividad de otro editor';
  end if;

  perform pg_advisory_xact_lock(hashtext('editor-activity-' || target_editor_id::text));

  update public.editor_activity_events
  set ended_at = greatest(started_at, changed_at),
      updated_at = changed_at
  where editor_id = target_editor_id
    and ended_at is null;

  insert into public.editor_activity_events (
    organization_id,
    editor_id,
    status,
    available_from,
    available_until,
    created_by,
    created_at,
    started_at,
    note,
    updated_at
  ) values (
    editor_row.organization_id,
    target_editor_id,
    target_status,
    target_available_from,
    target_available_until,
    actor_id,
    changed_at,
    changed_at,
    nullif(trim(target_note), ''),
    changed_at
  )
  returning * into result_row;

  return result_row;
end;
$$;

revoke all on function public.set_editor_activity_state(uuid, text, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.set_editor_activity_state(uuid, text, timestamptz, timestamptz, text)
  to authenticated;

create table if not exists public.editor_planning_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  editor_id uuid not null references public.editors(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  job_id uuid references public.jobs(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists editor_planning_timeline_idx
  on public.editor_planning_blocks(editor_id, starts_at desc);

alter table public.editor_planning_blocks enable row level security;

drop policy if exists "editor planning read" on public.editor_planning_blocks;
create policy "editor planning read"
on public.editor_planning_blocks for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_planning_blocks.editor_id and e.user_id = auth.uid()
  )
);

drop policy if exists "editor planning insert" on public.editor_planning_blocks;
create policy "editor planning insert"
on public.editor_planning_blocks for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    private.has_role(organization_id, array['owner','admin']::public.app_role[])
    or exists (
      select 1 from public.editors e
      where e.id = editor_planning_blocks.editor_id and e.user_id = auth.uid()
    )
  )
);

drop policy if exists "editor planning update" on public.editor_planning_blocks;
create policy "editor planning update"
on public.editor_planning_blocks for update to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_planning_blocks.editor_id and e.user_id = auth.uid()
  )
)
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_planning_blocks.editor_id and e.user_id = auth.uid()
  )
);

drop policy if exists "editor planning delete" on public.editor_planning_blocks;
create policy "editor planning delete"
on public.editor_planning_blocks for delete to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_planning_blocks.editor_id and e.user_id = auth.uid()
  )
);

revoke all on public.editor_planning_blocks from anon;
grant select, insert, update, delete on public.editor_planning_blocks to authenticated;

create table if not exists public.editor_ranking_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  quality_weight numeric(5,2) not null default 30 check (quality_weight >= 0),
  punctuality_weight numeric(5,2) not null default 25 check (punctuality_weight >= 0),
  completion_weight numeric(5,2) not null default 20 check (completion_weight >= 0),
  rework_weight numeric(5,2) not null default 15 check (rework_weight >= 0),
  activity_weight numeric(5,2) not null default 10 check (activity_weight >= 0),
  min_approved_videos integer not null default 5 check (min_approved_videos >= 1),
  min_activity_days integer not null default 0 check (min_activity_days >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    quality_weight + punctuality_weight + completion_weight
    + rework_weight + activity_weight = 100
  )
);

insert into public.editor_ranking_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

alter table public.editor_ranking_settings enable row level security;

drop policy if exists "ranking settings read" on public.editor_ranking_settings;
create policy "ranking settings read"
on public.editor_ranking_settings for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = editor_ranking_settings.organization_id
      and p.active
  )
);

drop policy if exists "ranking settings admin write" on public.editor_ranking_settings;
create policy "ranking settings admin write"
on public.editor_ranking_settings for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  and updated_by = auth.uid()
);

revoke all on public.editor_ranking_settings from anon;
grant select, insert, update on public.editor_ranking_settings to authenticated;

create table if not exists public.editor_reward_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  rank_position integer not null check (rank_position between 1 and 3),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_key, rank_position)
);

alter table public.editor_reward_settings enable row level security;

drop policy if exists "reward settings read" on public.editor_reward_settings;
create policy "reward settings read"
on public.editor_reward_settings for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.organization_id = editor_reward_settings.organization_id
      and p.active
  )
);

drop policy if exists "reward settings admin write" on public.editor_reward_settings;
drop policy if exists "reward settings admin insert" on public.editor_reward_settings;
create policy "reward settings admin insert"
on public.editor_reward_settings for insert to authenticated
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  and created_by = auth.uid()
);

drop policy if exists "reward settings admin update" on public.editor_reward_settings;
create policy "reward settings admin update"
on public.editor_reward_settings for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

drop policy if exists "reward settings admin delete" on public.editor_reward_settings;
create policy "reward settings admin delete"
on public.editor_reward_settings for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

revoke all on public.editor_reward_settings from anon;
grant select, insert, update, delete on public.editor_reward_settings to authenticated;

create table if not exists public.editor_monthly_rankings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.production_periods(id) on delete cascade,
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  editor_id uuid not null references public.editors(id) on delete cascade,
  rank_position integer,
  total_score numeric(6,2) not null default 0,
  eligible boolean not null default false,
  ineligible_reason text,
  metrics jsonb not null default '{}'::jsonb,
  points jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  reward_amount numeric(12,2) not null default 0,
  reward_description text,
  finalized_at timestamptz not null default now(),
  unique (period_id, editor_id)
);

alter table public.editor_monthly_rankings enable row level security;

drop policy if exists "monthly rankings read" on public.editor_monthly_rankings;
create policy "monthly rankings read"
on public.editor_monthly_rankings for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_monthly_rankings.editor_id and e.user_id = auth.uid()
  )
);

revoke all on public.editor_monthly_rankings from anon;
grant select on public.editor_monthly_rankings to authenticated;

create table if not exists public.editor_monthly_awards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  rank_position integer not null check (rank_position between 1 and 3),
  editor_id uuid not null references public.editors(id) on delete cascade,
  reward_setting_id uuid references public.editor_reward_settings(id) on delete set null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  description text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'paid', 'cancelled')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_key, rank_position)
);

alter table public.editor_monthly_awards enable row level security;

drop policy if exists "monthly awards read" on public.editor_monthly_awards;
create policy "monthly awards read"
on public.editor_monthly_awards for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1 from public.editors e
    where e.id = editor_monthly_awards.editor_id and e.user_id = auth.uid()
  )
);

drop policy if exists "monthly awards admin write" on public.editor_monthly_awards;
drop policy if exists "monthly awards admin insert" on public.editor_monthly_awards;
create policy "monthly awards admin insert"
on public.editor_monthly_awards for insert to authenticated
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  and confirmed_by = auth.uid()
);

drop policy if exists "monthly awards admin update" on public.editor_monthly_awards;
create policy "monthly awards admin update"
on public.editor_monthly_awards for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

revoke all on public.editor_monthly_awards from anon;
grant select, insert, update on public.editor_monthly_awards to authenticated;

create or replace view public.editor_monthly_metrics
with (security_invoker = true)
as
with workload as (
  select
    a.organization_id,
    a.editor_id,
    to_char(coalesce(a.due_on, j.due_on, a.assigned_on), 'YYYY-MM') as period_key,
    coalesce(sum(ai.assigned_quantity), 0)::numeric as assigned_videos
  from public.job_assignments a
  join public.jobs j on j.id = a.job_id
  join public.job_assignment_items ai on ai.assignment_id = a.id
  group by a.organization_id, a.editor_id,
    to_char(coalesce(a.due_on, j.due_on, a.assigned_on), 'YYYY-MM')
), activity as (
  select
    a.organization_id,
    a.editor_id,
    to_char(a.started_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'), 'YYYY-MM') as period_key,
    coalesce(sum(
      case when a.status in ('working', 'editing', 'correcting') then
        greatest(0, extract(epoch from (coalesce(a.ended_at, now()) - a.started_at)) / 60)
      else 0 end
    ), 0)::numeric(14,2) as productive_minutes,
    coalesce(sum(
      case when a.status in ('available', 'active') then
        greatest(0, extract(epoch from (coalesce(a.ended_at, now()) - a.started_at)) / 60)
      else 0 end
    ), 0)::numeric(14,2) as available_minutes,
    coalesce(sum(
      case when a.status = 'waiting' then
        greatest(0, extract(epoch from (coalesce(a.ended_at, now()) - a.started_at)) / 60)
      else 0 end
    ), 0)::numeric(14,2) as waiting_minutes,
    coalesce(sum(
      case when a.status in ('inactive', 'unavailable') then
        greatest(0, extract(epoch from (coalesce(a.ended_at, now()) - a.started_at)) / 60)
      else 0 end
    ), 0)::numeric(14,2) as inactive_minutes,
    count(distinct (a.started_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'))::date)
      filter (
        where a.status in ('working', 'editing', 'correcting')
          and coalesce(a.ended_at, now()) > a.started_at
      )::integer as activity_days,
    max(a.started_at) as last_activity_at
  from public.editor_activity_events a
  join public.organizations o on o.id = a.organization_id
  group by a.organization_id, a.editor_id,
    to_char(a.started_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'), 'YYYY-MM')
), metric_keys as (
  select organization_id, editor_id, period_key from public.editor_monthly_performance
  union
  select organization_id, editor_id, period_key from workload
  union
  select organization_id, editor_id, period_key from activity
  union
  select
    e.organization_id,
    e.id,
    to_char(now() at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'), 'YYYY-MM')
  from public.editors e
  join public.organizations o on o.id = e.organization_id
  where e.status = 'active'
)
select
  k.organization_id,
  k.editor_id,
  e.name as editor_name,
  k.period_key,
  coalesce(p.submitted_videos, 0)::integer as submitted_videos,
  coalesce(p.approved_videos, 0)::integer as approved_videos,
  coalesce(p.late_videos, 0)::integer as late_videos,
  coalesce(p.on_time_videos, 0)::integer as on_time_videos,
  coalesce(p.correction_count, 0)::integer as correction_count,
  coalesce(p.client_amount, 0)::numeric(12,2) as client_amount,
  coalesce(p.editor_amount, 0)::numeric(12,2) as editor_amount,
  coalesce(p.net_profit, 0)::numeric(12,2) as net_profit,
  coalesce(p.avg_delivery_hours, 0)::numeric(12,2) as avg_delivery_hours,
  coalesce(p.avg_resolution_hours, 0)::numeric(12,2) as avg_resolution_hours,
  coalesce(w.assigned_videos, 0)::integer as assigned_videos,
  coalesce(p.approved_videos, 0)::integer as completed_videos,
  coalesce(a.productive_minutes, 0)::numeric(14,2) as productive_minutes,
  coalesce(a.available_minutes, 0)::numeric(14,2) as available_minutes,
  coalesce(a.waiting_minutes, 0)::numeric(14,2) as waiting_minutes,
  coalesce(a.inactive_minutes, 0)::numeric(14,2) as inactive_minutes,
  coalesce(a.activity_days, 0)::integer as activity_days,
  a.last_activity_at
from metric_keys k
join public.editors e on e.id = k.editor_id
left join public.editor_monthly_performance p
  on p.organization_id = k.organization_id
 and p.editor_id = k.editor_id
 and p.period_key = k.period_key
left join workload w
  on w.organization_id = k.organization_id
 and w.editor_id = k.editor_id
 and w.period_key = k.period_key
left join activity a
  on a.organization_id = k.organization_id
 and a.editor_id = k.editor_id
 and a.period_key = k.period_key;

grant select on public.editor_monthly_metrics to authenticated;

-- Editors can see their own live score and position without receiving any
-- private metric or identity from their peers. The ranking itself is computed
-- with definer privileges and filtered to the authenticated editor at return.
create or replace function public.get_my_editor_live_ranking(target_period_key text)
returns table (
  editor_id uuid,
  rank_position bigint,
  total_score numeric,
  eligible boolean,
  ineligible_reason text,
  points jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
begin
  select * into actor_profile
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and p.role = 'editor'::public.app_role;

  if actor_profile.id is null or actor_profile.editor_id is null then
    return;
  end if;

  return query
  with settings as (
    select s.* from public.editor_ranking_settings s
    where s.organization_id = actor_profile.organization_id
  ), raw as (
    select
      m.*,
      s.quality_weight,
      s.punctuality_weight,
      s.completion_weight,
      s.rework_weight,
      s.activity_weight,
      s.min_approved_videos,
      s.min_activity_days,
      greatest(1, max(m.productive_minutes) over ()) as max_productive_minutes,
      greatest(1, max(m.activity_days) over ()) as max_activity_days
    from public.editor_monthly_metrics m
    cross join settings s
    where m.organization_id = actor_profile.organization_id
      and m.period_key = target_period_key
  ), calculated as (
    select
      r.*,
      least(100, case when r.submitted_videos > 0 then r.approved_videos * 100.0 / r.submitted_videos else 0 end) as quality_score,
      least(100, case when r.on_time_videos + r.late_videos > 0 then r.on_time_videos * 100.0 / (r.on_time_videos + r.late_videos) else 0 end) as punctuality_score,
      least(100, case when r.assigned_videos > 0 then r.completed_videos * 100.0 / r.assigned_videos else 0 end) as completion_score,
      greatest(0, 100 - case when r.submitted_videos > 0 then r.correction_count * 100.0 / r.submitted_videos else 100 end) as rework_score,
      least(100,
        (r.productive_minutes * 100.0 / r.max_productive_minutes) * 0.60
        + (r.activity_days * 100.0 / r.max_activity_days) * 0.40
      ) as activity_score,
      r.approved_videos >= r.min_approved_videos
        and r.activity_days >= r.min_activity_days as is_eligible
    from raw r
  ), scored as (
    select
      c.*,
      round((
        c.quality_score * c.quality_weight
        + c.punctuality_score * c.punctuality_weight
        + c.completion_score * c.completion_weight
        + c.rework_score * c.rework_weight
        + c.activity_score * c.activity_weight
      ) / 100.0, 2) as score_value
    from calculated c
  ), ranked as (
    select
      s.*,
      case when s.is_eligible then row_number() over (
        partition by s.is_eligible
        order by s.score_value desc,
          s.quality_score desc,
          s.punctuality_score desc,
          s.rework_score desc,
          s.approved_videos desc,
          s.editor_id
      ) end as position_value
    from scored s
  )
  select
    r.editor_id,
    r.position_value,
    r.score_value,
    r.is_eligible,
    case
      when r.approved_videos < r.min_approved_videos then
        format('Datos insuficientes: %s de %s vídeos aprobados', r.approved_videos, r.min_approved_videos)
      when r.activity_days < r.min_activity_days then
        format('Datos insuficientes: %s de %s días de actividad', r.activity_days, r.min_activity_days)
      else null
    end,
    jsonb_build_object(
      'quality', jsonb_build_object('value', round(r.quality_score, 2), 'weight', r.quality_weight, 'points', round(r.quality_score * r.quality_weight / 100.0, 2)),
      'punctuality', jsonb_build_object('value', round(r.punctuality_score, 2), 'weight', r.punctuality_weight, 'points', round(r.punctuality_score * r.punctuality_weight / 100.0, 2)),
      'completion', jsonb_build_object('value', round(r.completion_score, 2), 'weight', r.completion_weight, 'points', round(r.completion_score * r.completion_weight / 100.0, 2)),
      'rework', jsonb_build_object('value', round(r.rework_score, 2), 'weight', r.rework_weight, 'points', round(r.rework_score * r.rework_weight / 100.0, 2)),
      'activity', jsonb_build_object('value', round(r.activity_score, 2), 'weight', r.activity_weight, 'points', round(r.activity_score * r.activity_weight / 100.0, 2))
    )
  from ranked r
  where r.editor_id = actor_profile.editor_id;
end;
$$;

revoke all on function public.get_my_editor_live_ranking(text) from public, anon;
grant execute on function public.get_my_editor_live_ranking(text) to authenticated;

create or replace function private.freeze_editor_monthly_ranking(target_period_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.production_periods%rowtype;
begin
  select * into period_row
  from public.production_periods p
  where p.id = target_period_id
  for update;

  if period_row.id is null or period_row.status <> 'closed' then
    return;
  end if;

  if exists (
    select 1 from public.editor_monthly_rankings r
    where r.period_id = target_period_id
  ) then
    return;
  end if;

  with settings as (
    select s.*
    from public.editor_ranking_settings s
    where s.organization_id = period_row.organization_id
  ), raw as (
    select
      m.*,
      s.quality_weight,
      s.punctuality_weight,
      s.completion_weight,
      s.rework_weight,
      s.activity_weight,
      s.min_approved_videos,
      s.min_activity_days,
      greatest(1, max(m.productive_minutes) over ()) as max_productive_minutes,
      greatest(1, max(m.activity_days) over ()) as max_activity_days
    from public.editor_monthly_metrics m
    cross join settings s
    where m.organization_id = period_row.organization_id
      and m.period_key = to_char(period_row.period_start, 'YYYY-MM')
  ), calculated as (
    select
      r.*,
      least(100, case when r.submitted_videos > 0 then r.approved_videos * 100.0 / r.submitted_videos else 0 end) as quality_score,
      least(100, case when r.on_time_videos + r.late_videos > 0 then r.on_time_videos * 100.0 / (r.on_time_videos + r.late_videos) else 0 end) as punctuality_score,
      least(100, case when r.assigned_videos > 0 then r.completed_videos * 100.0 / r.assigned_videos else 0 end) as completion_score,
      greatest(0, 100 - case when r.submitted_videos > 0 then r.correction_count * 100.0 / r.submitted_videos else 100 end) as rework_score,
      least(100,
        (r.productive_minutes * 100.0 / r.max_productive_minutes) * 0.60
        + (r.activity_days * 100.0 / r.max_activity_days) * 0.40
      ) as activity_score,
      r.approved_videos >= r.min_approved_videos
        and r.activity_days >= r.min_activity_days as eligible
    from raw r
  ), scored as (
    select
      c.*,
      round((
        c.quality_score * c.quality_weight
        + c.punctuality_score * c.punctuality_weight
        + c.completion_score * c.completion_weight
        + c.rework_score * c.rework_weight
        + c.activity_score * c.activity_weight
      ) / 100.0, 2) as total_score
    from calculated c
  ), ranked as (
    select
      s.*,
      case when s.eligible then row_number() over (
        partition by s.eligible
        order by s.total_score desc,
          s.quality_score desc,
          s.punctuality_score desc,
          s.rework_score desc,
          s.approved_videos desc,
          s.editor_id
      ) end as rank_position
    from scored s
  )
  insert into public.editor_monthly_rankings (
    organization_id,
    period_id,
    period_key,
    editor_id,
    rank_position,
    total_score,
    eligible,
    ineligible_reason,
    metrics,
    points,
    settings,
    reward_amount,
    reward_description,
    finalized_at
  )
  select
    r.organization_id,
    period_row.id,
    r.period_key,
    r.editor_id,
    r.rank_position,
    r.total_score,
    r.eligible,
    case
      when r.approved_videos < r.min_approved_videos then
        format('Datos insuficientes: %s de %s vídeos aprobados', r.approved_videos, r.min_approved_videos)
      when r.activity_days < r.min_activity_days then
        format('Datos insuficientes: %s de %s días de actividad', r.activity_days, r.min_activity_days)
      else null
    end,
    jsonb_build_object(
      'assigned_videos', r.assigned_videos,
      'submitted_videos', r.submitted_videos,
      'approved_videos', r.approved_videos,
      'late_videos', r.late_videos,
      'on_time_videos', r.on_time_videos,
      'correction_count', r.correction_count,
      'productive_minutes', r.productive_minutes,
      'activity_days', r.activity_days,
      'editor_amount', r.editor_amount
    ),
    jsonb_build_object(
      'quality', jsonb_build_object('value', round(r.quality_score, 2), 'weight', r.quality_weight, 'points', round(r.quality_score * r.quality_weight / 100.0, 2)),
      'punctuality', jsonb_build_object('value', round(r.punctuality_score, 2), 'weight', r.punctuality_weight, 'points', round(r.punctuality_score * r.punctuality_weight / 100.0, 2)),
      'completion', jsonb_build_object('value', round(r.completion_score, 2), 'weight', r.completion_weight, 'points', round(r.completion_score * r.completion_weight / 100.0, 2)),
      'rework', jsonb_build_object('value', round(r.rework_score, 2), 'weight', r.rework_weight, 'points', round(r.rework_score * r.rework_weight / 100.0, 2)),
      'activity', jsonb_build_object('value', round(r.activity_score, 2), 'weight', r.activity_weight, 'points', round(r.activity_score * r.activity_weight / 100.0, 2))
    ),
    jsonb_build_object(
      'quality_weight', r.quality_weight,
      'punctuality_weight', r.punctuality_weight,
      'completion_weight', r.completion_weight,
      'rework_weight', r.rework_weight,
      'activity_weight', r.activity_weight,
      'min_approved_videos', r.min_approved_videos,
      'min_activity_days', r.min_activity_days
    ),
    coalesce(reward.amount, 0),
    reward.description,
    coalesce(period_row.closed_at, now())
  from ranked r
  left join public.editor_reward_settings reward
    on reward.organization_id = r.organization_id
   and reward.period_key = r.period_key
   and reward.rank_position = r.rank_position
   and reward.status = 'active'
  on conflict (period_id, editor_id) do nothing;
end;
$$;

revoke all on function private.freeze_editor_monthly_ranking(uuid)
  from public, anon, authenticated;

create or replace function private.freeze_ranking_after_period_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from new.status then
    perform private.freeze_editor_monthly_ranking(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_ranking_after_period_close on public.production_periods;
create trigger freeze_ranking_after_period_close
after update of status on public.production_periods
for each row execute function private.freeze_ranking_after_period_close();

-- Freeze any period that was already closed before this migration. The helper
-- is deliberately idempotent and never rewrites an existing result.
do $$
declare period_record record;
begin
  for period_record in select id from public.production_periods where status = 'closed'
  loop
    perform private.freeze_editor_monthly_ranking(period_record.id);
  end loop;
end;
$$;

create or replace function public.admin_set_user_profile(
  target_user_id uuid,
  target_role public.app_role,
  target_display_name text,
  target_editor_id uuid default null,
  target_client_id uuid default null,
  target_active boolean default true,
  target_phone text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile public.profiles%rowtype;
  result_profile public.profiles%rowtype;
  target_email text;
begin
  select * into actor_profile
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and p.role in ('owner'::public.app_role, 'admin'::public.app_role);

  if actor_profile.id is null then
    raise exception 'Solo un administrador puede gestionar usuarios';
  end if;

  if target_role = 'owner'::public.app_role then
    raise exception 'El rol propietario no se asigna desde esta pantalla';
  end if;

  if coalesce(trim(target_display_name), '') = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  select u.email into target_email from auth.users u where u.id = target_user_id;
  if target_email is null then
    raise exception 'No se encontró el usuario de autenticación';
  end if;

  if target_role = 'editor'::public.app_role then
    if target_editor_id is null or not exists (
      select 1 from public.editors e
      where e.id = target_editor_id
        and e.organization_id = actor_profile.organization_id
    ) then
      raise exception 'Selecciona un editor válido';
    end if;
    target_client_id := null;
  elsif target_role = 'client'::public.app_role then
    if target_client_id is null or not exists (
      select 1 from public.clients c
      where c.id = target_client_id
        and c.organization_id = actor_profile.organization_id
    ) then
      raise exception 'Selecciona un cliente válido';
    end if;
    target_editor_id := null;
  else
    target_editor_id := null;
    target_client_id := null;
  end if;

  update public.editors
  set user_id = null, updated_at = now()
  where organization_id = actor_profile.organization_id
    and user_id = target_user_id
    and id is distinct from target_editor_id;

  update public.clients
  set user_id = null, updated_at = now()
  where organization_id = actor_profile.organization_id
    and user_id = target_user_id
    and id is distinct from target_client_id;

  insert into public.profiles (
    id,
    organization_id,
    role,
    display_name,
    editor_id,
    client_id,
    active,
    updated_at
  ) values (
    target_user_id,
    actor_profile.organization_id,
    target_role,
    trim(target_display_name),
    target_editor_id,
    target_client_id,
    target_active,
    now()
  )
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    role = excluded.role,
    display_name = excluded.display_name,
    editor_id = excluded.editor_id,
    client_id = excluded.client_id,
    active = excluded.active,
    updated_at = excluded.updated_at
  returning * into result_profile;

  if target_editor_id is not null then
    update public.editors
    set user_id = target_user_id, updated_at = now()
    where id = target_editor_id;

    insert into public.editor_private (
      editor_id,
      organization_id,
      email,
      phone,
      updated_at
    ) values (
      target_editor_id,
      actor_profile.organization_id,
      target_email,
      nullif(trim(target_phone), ''),
      now()
    )
    on conflict (editor_id) do update set
      email = excluded.email,
      phone = coalesce(excluded.phone, public.editor_private.phone),
      updated_at = now();
  elsif target_client_id is not null then
    update public.clients
    set user_id = target_user_id, updated_at = now()
    where id = target_client_id;

    insert into public.client_private (
      client_id,
      organization_id,
      email,
      phone,
      updated_at
    ) values (
      target_client_id,
      actor_profile.organization_id,
      target_email,
      nullif(trim(target_phone), ''),
      now()
    )
    on conflict (client_id) do update set
      email = excluded.email,
      phone = coalesce(excluded.phone, public.client_private.phone),
      updated_at = now();
  end if;

  return result_profile;
end;
$$;

revoke all on function public.admin_set_user_profile(uuid, public.app_role, text, uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.admin_set_user_profile(uuid, public.app_role, text, uuid, uuid, boolean, text)
  to authenticated;

-- Profile role/link updates are administrative operations. The previous
-- self-update policy allowed a user to alter their own authorization fields.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update
on public.profiles for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
