-- Match lib/editor-performance.ts and rankingWithDailyPoints for live rankings.
-- Frozen monthly rankings, financial snapshots and historical closures are not
-- modified. The RPC still returns only the authenticated editor's score.
create or replace function public.get_my_editor_live_ranking(target_period_key text default null)
returns table (
  editor_id uuid,
  rank_position bigint,
  total_score numeric,
  eligible boolean,
  ineligible_reason text,
  points jsonb
)
language plpgsql security definer set search_path = '' as $function$
declare
  actor public.profiles%rowtype;
  target_key text := coalesce(target_period_key, to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM'));
  month_start timestamptz;
  month_end timestamptz;
begin
  select * into actor from public.profiles where id = auth.uid() and active;
  if actor.id is null or actor.role <> 'editor'::public.app_role or actor.editor_id is null then
    raise exception 'Solo el editor autenticado puede consultar su posición';
  end if;
  if target_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Mes no válido';
  end if;
  month_start := (target_key || '-01')::timestamp at time zone 'Europe/Madrid';
  month_end := ((target_key || '-01')::date + interval '1 month') at time zone 'Europe/Madrid';

  return query
  with cfg as (
    select coalesce(s.value_weight, 40)::numeric value_weight,
      coalesce(s.quality_weight, 30)::numeric quality_weight,
      coalesce(s.punctuality_weight, 30)::numeric punctuality_weight,
      greatest(0, coalesce(s.late_penalty_points, 2))::numeric late_penalty_points,
      greatest(0, coalesce(s.correction_penalty_points, 1))::numeric correction_penalty_points,
      greatest(1, coalesce(s.min_approved_videos, 3))::numeric min_approved_videos
    from (select 1) seed
    left join public.editor_ranking_settings s on s.organization_id = actor.organization_id
  ), bonus as (
    select p.editor_id bonus_editor_id, sum(p.points)::numeric extra_points
    from public.editor_daily_ranking_points p
    where p.organization_id = actor.organization_id
      and p.claimed_at >= month_start and p.claimed_at < month_end
    group by p.editor_id
  ), raw as (
    select m.*, cfg.*, coalesce(b.extra_points, 0) extra_points,
      greatest(1, max(m.client_amount) over ()) max_value
    from public.editorial_monthly_metrics m
    cross join cfg
    left join bonus b on b.bonus_editor_id = m.editor_id
    where m.organization_id = actor.organization_id and m.period_key = target_key
  ), scores as (
    select r.*,
      greatest(0, least(100, r.client_amount * 100.0 / r.max_value)) value_score,
      greatest(0, least(100, case when r.approved_videos <> 0
        then r.approved_without_correction_videos * 100.0 / r.approved_videos else 0 end)) quality_score,
      greatest(0, least(100, case when r.on_time_videos + r.late_videos <> 0
        then r.on_time_videos * 100.0 / (r.on_time_videos + r.late_videos) else 0 end)) punctuality_score
    from raw r
  ), parts as (
    select s.*,
      round(s.value_score * s.value_weight / 100.0, 1) value_points,
      round(s.quality_score * s.quality_weight / 100.0, 1) quality_points,
      round(s.punctuality_score * s.punctuality_weight / 100.0, 1) punctuality_points,
      -round(s.late_videos * s.late_penalty_points, 1) late_points,
      -round(s.correction_count * s.correction_penalty_points, 1) correction_points
    from scores s
  ), totals as (
    select p.*,
      greatest(0, round(p.value_points + p.quality_points + p.punctuality_points + p.late_points + p.correction_points, 1))
        + p.extra_points final_score
    from parts p
  ), ranked as (
    select t.*, row_number() over (order by t.final_score desc, t.editor_id) position_value
    from totals t
  )
  select r.editor_id, r.position_value, r.final_score, true,
    case when r.approved_videos < r.min_approved_videos
      then format('Muestra inicial: %s de %s vídeos aprobados', r.approved_videos, r.min_approved_videos)
      else null end,
    jsonb_build_object(
      'value', jsonb_build_object('value', round(r.value_score, 1), 'weight', r.value_weight, 'points', r.value_points),
      'quality', jsonb_build_object('value', round(r.quality_score, 1), 'weight', r.quality_weight, 'points', r.quality_points),
      'punctuality', jsonb_build_object('value', round(r.punctuality_score, 1), 'weight', r.punctuality_weight, 'points', r.punctuality_points),
      'late_penalty', jsonb_build_object('value', r.late_videos, 'weight', r.late_penalty_points, 'points', r.late_points),
      'correction_penalty', jsonb_build_object('value', r.correction_count, 'weight', r.correction_penalty_points, 'points', r.correction_points),
      'daily_bonus', jsonb_build_object('value', r.extra_points, 'weight', 0, 'points', r.extra_points)
    )
  from ranked r where r.editor_id = actor.editor_id;
end;
$function$;

revoke all on function public.get_my_editor_live_ranking(text) from public, anon;
grant execute on function public.get_my_editor_live_ranking(text) to authenticated;
