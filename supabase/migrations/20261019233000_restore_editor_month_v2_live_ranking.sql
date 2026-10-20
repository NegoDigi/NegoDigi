create or replace function public.get_editor_team_live_ranking(
  target_period_key text default null
)
returns table(
  editor_id uuid,
  editor_name text,
  rank_position bigint,
  total_score numeric,
  eligible boolean,
  ineligible_reason text,
  points jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles%rowtype;
  target_key text := coalesce(
    target_period_key,
    to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM')
  );
  month_start timestamptz;
  month_end timestamptz;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and active;

  if actor.id is null
     or actor.role <> 'editor'::public.app_role
     or actor.organization_id is null then
    raise exception 'Solo un editor autenticado puede consultar el ranking del equipo';
  end if;

  if target_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes no válido';
  end if;

  month_start := (target_key || '-01')::timestamp at time zone 'Europe/Madrid';
  month_end := ((target_key || '-01')::date + interval '1 month') at time zone 'Europe/Madrid';

  return query
  with cfg as (
    select
      greatest(0, coalesce(s.v2_punctuality_weight, 30))::numeric as punctuality_weight,
      greatest(0, coalesce(s.v2_communication_weight, 30))::numeric as communication_weight,
      greatest(0, coalesce(s.v2_quality_weight, 20))::numeric as quality_weight,
      greatest(0, coalesce(s.v2_production_weight, 20))::numeric as production_weight,
      greatest(0, coalesce(s.v2_daily_activity_cap, 5))::numeric as daily_activity_cap,
      greatest(1, coalesce(s.v2_priority_late_multiplier, 1.5))::numeric as priority_late_multiplier,
      greatest(1, coalesce(s.min_approved_videos, 1))::numeric as min_approved_videos
    from (select 1) seed
    left join public.editor_ranking_settings s
      on s.organization_id = actor.organization_id
  ),
  communication as (
    select
      review.editor_id as communication_editor_id,
      avg(greatest(0, least(5, review.score)))::numeric as average_score
    from public.editor_communication_reviews review
    where review.organization_id = actor.organization_id
      and review.week_start >= month_start::date
      and review.week_start < month_end::date
    group by review.editor_id
  ),
  daily as (
    select
      point.editor_id as daily_editor_id,
      sum(greatest(0, point.points))::numeric as claimed_points
    from public.editor_daily_ranking_points point
    where point.organization_id = actor.organization_id
      and point.claimed_at >= month_start
      and point.claimed_at < month_end
    group by point.editor_id
  ),
  raw as (
    select
      metric.*,
      cfg.*,
      coalesce(communication.average_score, 0)::numeric as communication_average,
      least(cfg.daily_activity_cap, coalesce(daily.claimed_points, 0))::numeric as activity_points,
      greatest(1, max(metric.approved_videos) over ())::numeric as max_approved,
      (
        metric.on_time_videos
        + greatest(0, metric.late_videos - metric.v2_late_videos)
      )::numeric as adjusted_on_time,
      (
        metric.v2_late_videos
        + metric.v2_priority_late_videos * (cfg.priority_late_multiplier - 1)
      )::numeric as weighted_late
    from public.editorial_monthly_ranking_v2_metrics metric
    cross join cfg
    left join communication
      on communication.communication_editor_id = metric.editor_id
    left join daily
      on daily.daily_editor_id = metric.editor_id
    where metric.organization_id = actor.organization_id
      and metric.period_key = target_key
  ),
  scores as (
    select
      raw.*,
      greatest(0, least(100, case
        when raw.adjusted_on_time + raw.weighted_late > 0
          then raw.adjusted_on_time * 100.0
            / (raw.adjusted_on_time + raw.weighted_late)
        else 0
      end))::numeric as punctuality_score,
      greatest(0, least(
        raw.communication_weight,
        (raw.communication_average / 5.0)
          * greatest(0, raw.communication_weight - raw.daily_activity_cap)
        + raw.activity_points
      ))::numeric as communication_points,
      greatest(0, least(100, case
        when raw.approved_videos > 0
          then raw.v2_approved_without_correction_videos * 100.0
            / raw.approved_videos
        else 0
      end))::numeric as quality_score,
      greatest(0, least(
        100,
        raw.approved_videos * 100.0 / raw.max_approved
      ))::numeric as production_score
    from raw
  ),
  parts as (
    select
      scores.*,
      round(scores.punctuality_score * scores.punctuality_weight / 100.0, 1)
        as punctuality_points,
      round(scores.communication_points, 1) as rounded_communication_points,
      round(scores.quality_score * scores.quality_weight / 100.0, 1)
        as quality_points,
      round(scores.production_score * scores.production_weight / 100.0, 1)
        as production_points
    from scores
  ),
  totals as (
    select
      parts.*,
      greatest(0, least(100, round(
        parts.punctuality_points
        + parts.rounded_communication_points
        + parts.quality_points
        + parts.production_points,
        1
      )))::numeric as final_score
    from parts
  ),
  ranked as (
    select
      totals.*,
      row_number() over (
        order by
          totals.final_score desc,
          totals.production_points desc,
          totals.quality_points desc,
          totals.punctuality_points desc,
          totals.editor_id
      ) as position_value
    from totals
  )
  select
    ranked.editor_id,
    ranked.editor_name,
    ranked.position_value,
    ranked.final_score,
    true,
    case
      when ranked.approved_videos < ranked.min_approved_videos
        then format(
          'Muestra inicial: %s de %s vídeos aprobados',
          ranked.approved_videos,
          ranked.min_approved_videos
        )
      else null
    end,
    jsonb_build_object(
      'punctuality', jsonb_build_object(
        'value', round(ranked.punctuality_score, 1),
        'weight', ranked.punctuality_weight,
        'points', ranked.punctuality_points
      ),
      'communication', jsonb_build_object(
        'value', round(ranked.communication_average, 1),
        'weight', ranked.communication_weight,
        'points', ranked.rounded_communication_points,
        'activity_points', ranked.activity_points
      ),
      'quality', jsonb_build_object(
        'value', round(ranked.quality_score, 1),
        'weight', ranked.quality_weight,
        'points', ranked.quality_points
      ),
      'production', jsonb_build_object(
        'value', round(ranked.production_score, 1),
        'weight', ranked.production_weight,
        'points', ranked.production_points
      )
    )
  from ranked;
end;
$function$;

create or replace function public.get_my_editor_live_ranking(
  target_period_key text default null
)
returns table(
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
as $function$
declare
  actor public.profiles%rowtype;
  target_key text := coalesce(
    target_period_key,
    to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM')
  );
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and active;

  if actor.id is null
     or actor.role <> 'editor'::public.app_role
     or actor.editor_id is null then
    raise exception 'Solo el editor autenticado puede consultar su posición';
  end if;

  if target_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes no válido';
  end if;

  return query
  select
    ranking.editor_id,
    ranking.rank_position,
    ranking.total_score,
    ranking.eligible,
    ranking.ineligible_reason,
    ranking.points
  from public.get_editor_team_live_ranking(target_key) ranking
  where ranking.editor_id = actor.editor_id;
end;
$function$;
