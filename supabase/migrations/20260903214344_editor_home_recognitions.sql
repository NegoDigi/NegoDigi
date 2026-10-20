-- Persistent, rate-limited recognition data for the editor home. Daily bonus
-- points are deliberately separate from payments and production records.
create table if not exists public.editor_daily_ranking_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  editor_id uuid not null references public.editors(id) on delete cascade,
  claimed_by uuid not null references auth.users(id) on delete restrict,
  acting_for_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz not null default now(),
  points integer not null default 1 check (points = 1)
);

create index if not exists editor_daily_ranking_points_editor_claimed_idx
  on public.editor_daily_ranking_points (editor_id, claimed_at desc);
create index if not exists editor_daily_ranking_points_org_claimed_idx
  on public.editor_daily_ranking_points (organization_id, claimed_at desc);

alter table public.editor_daily_ranking_points enable row level security;
grant select on public.editor_daily_ranking_points to authenticated;

create policy editor_daily_ranking_points_select
on public.editor_daily_ranking_points for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin','editor']::public.app_role[])
);

-- A single recognition is frozen for each completed Madrid week. It is never
-- recreated when another editor opens the panel later in the same week.
create table if not exists public.editor_weekly_recognitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  editor_id uuid not null references public.editors(id) on delete restrict,
  total_score numeric(10,2) not null,
  generated_at timestamptz not null default now(),
  unique (organization_id, week_start)
);

create index if not exists editor_weekly_recognitions_org_week_idx
  on public.editor_weekly_recognitions (organization_id, week_start desc);

alter table public.editor_weekly_recognitions enable row level security;
grant select on public.editor_weekly_recognitions to authenticated;

create policy editor_weekly_recognitions_select
on public.editor_weekly_recognitions for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin','editor']::public.app_role[])
);

create or replace function public.claim_editor_daily_ranking_point(
  target_editor_id uuid,
  acting_as_user_id uuid default null
)
returns table (claimed_at timestamptz, next_eligible_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  target_editor public.editors%rowtype;
  latest_claim timestamptz;
  claim_time timestamptz := now();
begin
  select * into actor from public.profiles where id = auth.uid() and active;
  if actor.id is null then raise exception 'Debes iniciar sesión'; end if;
  if actor.role not in ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) then
    raise exception 'No tienes permiso para conseguir este punto';
  end if;

  select * into target_editor
  from public.editors
  where id = target_editor_id and organization_id = actor.organization_id;
  if target_editor.id is null then raise exception 'No se encontró el editor'; end if;

  if actor.role in ('owner'::public.app_role, 'admin'::public.app_role) then
    if acting_as_user_id is null or target_editor.user_id is distinct from acting_as_user_id then
      raise exception 'La administración solo puede conceder el punto desde la previsualización del editor seleccionado';
    end if;
  elsif target_editor.user_id is distinct from actor.id or acting_as_user_id is not null then
    raise exception 'Solo puedes conseguir tu propio punto';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_editor_id::text, 0));
  select p.claimed_at into latest_claim
  from public.editor_daily_ranking_points p
  where p.editor_id = target_editor_id
  order by p.claimed_at desc
  limit 1
  for update;

  if latest_claim is not null and latest_claim > claim_time - interval '24 hours' then
    raise exception 'El punto diario estará disponible de nuevo a las %', latest_claim + interval '24 hours';
  end if;

  insert into public.editor_daily_ranking_points
    (organization_id, editor_id, claimed_by, acting_for_user_id, claimed_at, points)
  values
    (actor.organization_id, target_editor_id, actor.id, acting_as_user_id, claim_time, 1);

  if acting_as_user_id is not null then
    insert into public.audit_log(organization_id, actor_id, action, entity_type, entity_id, after_data, source)
    values (
      actor.organization_id, actor.id, 'claim_daily_ranking_point_as_editor',
      'editor_daily_ranking_point', target_editor_id::text,
      jsonb_build_object('acting_as_user_id', acting_as_user_id, 'points', 1),
      'admin_preview'
    );
  end if;

  return query select claim_time, claim_time + interval '24 hours';
end;
$$;
revoke all on function public.claim_editor_daily_ranking_point(uuid, uuid) from public, anon;
grant execute on function public.claim_editor_daily_ranking_point(uuid, uuid) to authenticated;

create or replace function public.ensure_editor_weekly_recognition()
returns public.editor_weekly_recognitions
language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  recognition public.editor_weekly_recognitions%rowtype;
  completed_week_start date := ((now() at time zone 'Europe/Madrid')::date - 7 - extract(isodow from (now() at time zone 'Europe/Madrid')::date)::integer + 1);
  completed_week_end date;
begin
  select * into actor from public.profiles where id = auth.uid() and active;
  if actor.id is null or actor.role not in ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) then
    raise exception 'No tienes permiso para consultar este reconocimiento';
  end if;
  completed_week_end := completed_week_start + 7;
  perform pg_advisory_xact_lock(hashtextextended(actor.organization_id::text || completed_week_start::text, 0));

  select * into recognition
  from public.editor_weekly_recognitions
  where organization_id = actor.organization_id and week_start = completed_week_start;
  if recognition.id is not null then return recognition; end if;

  with weekly_history as (
    select h.editor_id,
      sum(h.quantity)::numeric approved_videos,
      sum(case when h.was_late then 0 else h.quantity end)::numeric on_time_videos,
      sum(coalesce(h.correction_count, 0))::numeric correction_count
    from public.production_video_history h
    join public.editors e on e.id = h.editor_id
    left join public.profiles p on p.editor_id = e.id and p.active
    where h.organization_id = actor.organization_id
      and coalesce((h.approved_at at time zone 'Europe/Madrid')::date, (h.delivered_at at time zone 'Europe/Madrid')::date) >= completed_week_start
      and coalesce((h.approved_at at time zone 'Europe/Madrid')::date, (h.delivered_at at time zone 'Europe/Madrid')::date) < completed_week_end
      and lower(coalesce(e.role_label, '')) not in ('manager','administrador','admin','owner','fundador','dirección','direccion')
      and coalesce(p.role::text, 'editor') not in ('owner','admin')
      and lower(e.name) <> 'santiago martínez vallejo'
    group by h.editor_id
  ), weekly_bonus as (
    select editor_id, sum(points)::numeric points
    from public.editor_daily_ranking_points
    where organization_id = actor.organization_id
      and (claimed_at at time zone 'Europe/Madrid')::date >= completed_week_start
      and (claimed_at at time zone 'Europe/Madrid')::date < completed_week_end
    group by editor_id
  ), winner as (
    select h.editor_id,
      round(h.approved_videos * 10 + h.on_time_videos * 2 - h.correction_count + coalesce(b.points, 0), 2) score
    from weekly_history h
    left join weekly_bonus b on b.editor_id = h.editor_id
    order by score desc, h.editor_id
    limit 1
  )
  insert into public.editor_weekly_recognitions(organization_id, week_start, editor_id, total_score)
  select actor.organization_id, completed_week_start, editor_id, score from winner
  on conflict (organization_id, week_start) do nothing
  returning * into recognition;

  return recognition;
end;
$$;
revoke all on function public.ensure_editor_weekly_recognition() from public, anon;
grant execute on function public.ensure_editor_weekly_recognition() to authenticated;

-- The daily point is part of the live and closed ranking, but never affects
-- production finance, payments or historical video counts.
create or replace function public.get_my_editor_live_ranking(target_period_key text default null)
returns table (
  editor_id uuid, rank_position bigint, total_score numeric, eligible boolean,
  ineligible_reason text, points jsonb
)
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; target_key text := coalesce(target_period_key, to_char(now() at time zone 'Europe/Madrid','YYYY-MM'));
begin
  select * into actor from public.profiles where id=auth.uid() and active;
  if actor.id is null or actor.role <> 'editor'::public.app_role or actor.editor_id is null then raise exception 'Solo el editor autenticado puede consultar su posición'; end if;
  return query
  with cfg as (
    select coalesce(s.value_weight,40)::numeric value_weight,coalesce(s.quality_weight,25)::numeric quality_weight,
      coalesce(s.punctuality_weight,20)::numeric punctuality_weight,coalesce(s.correction_weight,15)::numeric correction_weight,
      greatest(1,coalesce(s.min_approved_videos,3)) min_approved_videos
    from public.editor_ranking_settings s where s.organization_id=actor.organization_id
    union all select 40,25,20,15,3 where not exists (select 1 from public.editor_ranking_settings s where s.organization_id=actor.organization_id)
    limit 1
  ), bonus as (
    select editor_id, sum(points)::numeric extra_points
    from public.editor_daily_ranking_points
    where organization_id=actor.organization_id and to_char(claimed_at at time zone 'Europe/Madrid','YYYY-MM')=target_key
    group by editor_id
  ), raw as (
    select m.*,cfg.*,coalesce(b.extra_points,0) extra_points,greatest(1,max(m.client_amount) over()) max_value
    from public.editor_monthly_metrics m cross join cfg left join bonus b on b.editor_id=m.editor_id
    where m.organization_id=actor.organization_id and m.period_key=target_key
  ), scored as (
    select r.*,
      least(100,r.client_amount*100.0/r.max_value) value_score,
      least(100,case when r.approved_videos>0 then r.approved_without_correction_videos*100.0/r.approved_videos else 0 end) quality_score,
      least(100,case when r.on_time_videos+r.late_videos>0 then r.on_time_videos*100.0/(r.on_time_videos+r.late_videos) else 0 end) punctuality_score,
      greatest(0,least(100,100-case when r.approved_videos>0 then (r.correction_videos*70+greatest(0,r.correction_count-r.correction_videos)*30)*100.0/r.approved_videos else 100 end)) correction_score
    from raw r
  ), ranked as (
    select s.*, round((s.value_score*s.value_weight+s.quality_score*s.quality_weight+s.punctuality_score*s.punctuality_weight+s.correction_score*s.correction_weight)/100.0+s.extra_points,2) final_score,
      row_number() over(order by ((s.value_score*s.value_weight+s.quality_score*s.quality_weight+s.punctuality_score*s.punctuality_weight+s.correction_score*s.correction_weight)/100.0+s.extra_points) desc,s.editor_id) position_value
    from scored s
  )
  select r.editor_id,r.position_value::bigint,r.final_score,true,
    case when r.approved_videos<r.min_approved_videos then format('Muestra inicial: %s de %s vídeos aprobados',r.approved_videos,r.min_approved_videos) else null end,
    jsonb_build_object(
      'value',jsonb_build_object('value',round(r.value_score,2),'weight',r.value_weight,'points',round(r.value_score*r.value_weight/100.0,2)),
      'quality',jsonb_build_object('value',round(r.quality_score,2),'weight',r.quality_weight,'points',round(r.quality_score*r.quality_weight/100.0,2)),
      'punctuality',jsonb_build_object('value',round(r.punctuality_score,2),'weight',r.punctuality_weight,'points',round(r.punctuality_score*r.punctuality_weight/100.0,2)),
      'corrections',jsonb_build_object('value',round(r.correction_score,2),'weight',r.correction_weight,'points',round(r.correction_score*r.correction_weight/100.0,2)),
      'daily_bonus',jsonb_build_object('value',r.extra_points,'weight',0,'points',r.extra_points)
    )
  from ranked r where r.editor_id=actor.editor_id;
end; $$;
revoke all on function public.get_my_editor_live_ranking(text) from public,anon;
grant execute on function public.get_my_editor_live_ranking(text) to authenticated;
