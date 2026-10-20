-- Ranking revision: four transparent criteria, no time tracking and a
-- provisional position for every internal editor with activity.

update public.editor_ranking_settings
set value_weight = 40,
    quality_weight = 25,
    punctuality_weight = 20,
    correction_weight = 15,
    commitment_weight = 0,
    min_approved_videos = greatest(1, min_approved_videos)
where true;

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
  ), raw as (
    select m.*,cfg.*,greatest(1,max(m.client_amount) over()) max_value
    from public.editor_monthly_metrics m cross join cfg
    where m.organization_id=actor.organization_id and m.period_key=target_key
  ), scored as (
    select r.*,
      least(100,r.client_amount*100.0/r.max_value) value_score,
      least(100,case when r.approved_videos>0 then r.approved_without_correction_videos*100.0/r.approved_videos else 0 end) quality_score,
      least(100,case when r.on_time_videos+r.late_videos>0 then r.on_time_videos*100.0/(r.on_time_videos+r.late_videos) else 0 end) punctuality_score,
      greatest(0,least(100,100-case when r.approved_videos>0 then (r.correction_videos*70+greatest(0,r.correction_count-r.correction_videos)*30)*100.0/r.approved_videos else 100 end)) correction_score
    from raw r
  ), ranked as (
    select s.*, round((s.value_score*s.value_weight+s.quality_score*s.quality_weight+s.punctuality_score*s.punctuality_weight+s.correction_score*s.correction_weight)/100.0,2) final_score,
      row_number() over(order by (s.value_score*s.value_weight+s.quality_score*s.quality_weight+s.punctuality_score*s.punctuality_weight+s.correction_score*s.correction_weight) desc,s.editor_id) position_value
    from scored s
  )
  select r.editor_id,r.position_value::bigint,r.final_score,true,
    case when r.approved_videos<r.min_approved_videos then format('Muestra inicial: %s de %s vídeos aprobados',r.approved_videos,r.min_approved_videos) else null end,
    jsonb_build_object(
      'value',jsonb_build_object('value',round(r.value_score,2),'weight',r.value_weight,'points',round(r.value_score*r.value_weight/100.0,2)),
      'quality',jsonb_build_object('value',round(r.quality_score,2),'weight',r.quality_weight,'points',round(r.quality_score*r.quality_weight/100.0,2)),
      'punctuality',jsonb_build_object('value',round(r.punctuality_score,2),'weight',r.punctuality_weight,'points',round(r.punctuality_score*r.punctuality_weight/100.0,2)),
      'corrections',jsonb_build_object('value',round(r.correction_score,2),'weight',r.correction_weight,'points',round(r.correction_score*r.correction_weight/100.0,2))
    )
  from ranked r where r.editor_id=actor.editor_id;
end; $$;
revoke all on function public.get_my_editor_live_ranking(text) from public,anon;
grant execute on function public.get_my_editor_live_ranking(text) to authenticated;

create or replace function private.freeze_editor_monthly_ranking(target_period_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare period_row public.production_periods%rowtype;
begin
  select * into period_row from public.production_periods p where p.id=target_period_id for update;
  if period_row.id is null or period_row.status <> 'closed' or exists(select 1 from public.editor_monthly_rankings r where r.period_id=target_period_id) then return; end if;
  with cfg as (
    select coalesce(s.value_weight,40)::numeric value_weight,coalesce(s.quality_weight,25)::numeric quality_weight,coalesce(s.punctuality_weight,20)::numeric punctuality_weight,coalesce(s.correction_weight,15)::numeric correction_weight,greatest(1,coalesce(s.min_approved_videos,3)) min_approved_videos
    from public.editor_ranking_settings s where s.organization_id=period_row.organization_id
    union all select 40,25,20,15,3 where not exists(select 1 from public.editor_ranking_settings s where s.organization_id=period_row.organization_id) limit 1
  ), raw as (
    select m.*,cfg.*,greatest(1,max(m.client_amount) over()) max_value from public.editor_monthly_metrics m cross join cfg where m.organization_id=period_row.organization_id and m.period_key=to_char(period_row.period_start,'YYYY-MM')
  ), scored as (
    select r.*,least(100,r.client_amount*100.0/r.max_value) value_score,least(100,case when r.approved_videos>0 then r.approved_without_correction_videos*100.0/r.approved_videos else 0 end) quality_score,least(100,case when r.on_time_videos+r.late_videos>0 then r.on_time_videos*100.0/(r.on_time_videos+r.late_videos) else 0 end) punctuality_score,greatest(0,least(100,100-case when r.approved_videos>0 then (r.correction_videos*70+greatest(0,r.correction_count-r.correction_videos)*30)*100.0/r.approved_videos else 100 end)) correction_score from raw r
  ), ranked as (
    select s.*,round((s.value_score*s.value_weight+s.quality_score*s.quality_weight+s.punctuality_score*s.punctuality_weight+s.correction_score*s.correction_weight)/100.0,2) total_score,row_number() over(order by (s.value_score*s.value_weight+s.quality_score*s.quality_weight+s.punctuality_score*s.punctuality_weight+s.correction_score*s.correction_weight) desc,s.editor_id) rank_position from scored s
  )
  insert into public.editor_monthly_rankings(organization_id,period_id,period_key,editor_id,rank_position,total_score,eligible,ineligible_reason,metrics,points,settings,reward_amount,reward_description,finalized_at)
  select r.organization_id,period_row.id,r.period_key,r.editor_id,r.rank_position,r.total_score,true,case when r.approved_videos<r.min_approved_videos then format('Muestra inicial: %s de %s vídeos aprobados',r.approved_videos,r.min_approved_videos) else null end,
    jsonb_build_object('assigned_videos',r.assigned_videos,'submitted_videos',r.submitted_videos,'approved_videos',r.approved_videos,'approved_without_correction_videos',r.approved_without_correction_videos,'corrected_approved_videos',r.corrected_approved_videos,'correction_videos',r.correction_videos,'correction_count',r.correction_count,'late_videos',r.late_videos,'on_time_videos',r.on_time_videos,'client_amount',r.client_amount,'editor_amount',r.editor_amount),
    jsonb_build_object('value',jsonb_build_object('value',round(r.value_score,2),'weight',r.value_weight,'points',round(r.value_score*r.value_weight/100.0,2)),'quality',jsonb_build_object('value',round(r.quality_score,2),'weight',r.quality_weight,'points',round(r.quality_score*r.quality_weight/100.0,2)),'punctuality',jsonb_build_object('value',round(r.punctuality_score,2),'weight',r.punctuality_weight,'points',round(r.punctuality_score*r.punctuality_weight/100.0,2)),'corrections',jsonb_build_object('value',round(r.correction_score,2),'weight',r.correction_weight,'points',round(r.correction_score*r.correction_weight/100.0,2))),
    jsonb_build_object('value_weight',r.value_weight,'quality_weight',r.quality_weight,'punctuality_weight',r.punctuality_weight,'correction_weight',r.correction_weight,'min_approved_videos',r.min_approved_videos),coalesce(reward.amount,0),reward.description,coalesce(period_row.closed_at,now())
  from ranked r left join public.editor_reward_settings reward on reward.organization_id=r.organization_id and reward.period_key=r.period_key and reward.rank_position=r.rank_position and reward.status='active'
  on conflict(period_id,editor_id) do nothing;
end; $$;
revoke all on function private.freeze_editor_monthly_ranking(uuid) from public,anon,authenticated;
