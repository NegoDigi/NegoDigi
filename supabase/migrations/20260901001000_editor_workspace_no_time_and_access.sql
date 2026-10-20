-- Editorial workspace revision: preserves all historical rows, removes time as
-- a performance input, and adds auditable access/news/planning capabilities.

alter table public.editor_ranking_settings
  add column if not exists value_weight numeric(5,2) not null default 35 check (value_weight >= 0),
  add column if not exists correction_weight numeric(5,2) not null default 10 check (correction_weight >= 0),
  add column if not exists commitment_weight numeric(5,2) not null default 10 check (commitment_weight >= 0);

-- Existing settings are migrated once. The old columns remain for backwards
-- compatibility but are no longer consumed by the application or ranking.
update public.editor_ranking_settings
set value_weight = 35, quality_weight = 25, punctuality_weight = 20,
    correction_weight = 10, commitment_weight = 10,
    completion_weight = 10, rework_weight = 10, activity_weight = 35,
    min_approved_videos = greatest(3, min_approved_videos)
where value_weight = 35 and correction_weight = 10 and commitment_weight = 10;

alter table public.editor_reward_settings
  add column if not exists name text,
  add column if not exists reward_type text not null default 'monetary'
    check (reward_type in ('monetary','non_monetary','special','random'));

alter table public.editor_planning_blocks
  add column if not exists checklist jsonb not null default '[]'::jsonb,
  add column if not exists sort_order integer not null default 0,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists editor_planning_active_idx
  on public.editor_planning_blocks(editor_id, archived_at, starts_at);

create table if not exists public.auth_access_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name_snapshot text not null,
  occurred_at timestamptz not null default now(),
  result text not null default 'success' check (result in ('success','revoked','deleted')),
  device_info text,
  created_at timestamptz not null default now()
);
create index if not exists auth_access_history_org_user_idx on public.auth_access_history(organization_id, user_id, occurred_at desc);
alter table public.auth_access_history enable row level security;
create policy "access history read" on public.auth_access_history for select to authenticated using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or user_id = auth.uid()
);
revoke all on public.auth_access_history from anon;
grant select on public.auth_access_history to authenticated;

create or replace function public.record_my_access_event(device text default null)
returns public.auth_access_history
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; output public.auth_access_history%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() and active;
  if actor.id is null then raise exception 'Sesión sin perfil activo'; end if;
  insert into public.auth_access_history (organization_id,user_id,display_name_snapshot,result,device_info)
  values (actor.organization_id,actor.id,actor.display_name,'success',nullif(left(trim(coalesce(device,'')),240),''))
  returning * into output;
  return output;
end; $$;
revoke all on function public.record_my_access_event(text) from public, anon;
grant execute on function public.record_my_access_event(text) to authenticated;

create table if not exists public.team_announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  audience text not null default 'editors' check (audience in ('all','editors','admins')),
  image_url text,
  featured_month text check (featured_month is null or featured_month ~ '^[0-9]{4}-[0-9]{2}$'),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.team_announcement_reads (
  announcement_id uuid not null references public.team_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id,user_id)
);
alter table public.team_announcements enable row level security;
alter table public.team_announcement_reads enable row level security;
create policy "announcements read" on public.team_announcements for select to authenticated using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or (status = 'published' and audience in ('all','editors'))
);
create policy "announcements admin write" on public.team_announcements for all to authenticated using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
) with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy "announcement reads own" on public.team_announcement_reads for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.team_announcements, public.team_announcement_reads from anon;
grant select, insert, update, delete on public.team_announcements, public.team_announcement_reads to authenticated;

-- A point-in-time availability declaration. It intentionally does not create
-- or calculate a work session; historic session fields remain only as history.
create or replace function public.set_editor_presence_state(
  target_editor_id uuid, target_status text, target_available_from timestamptz default null,
  target_available_until timestamptz default null, target_note text default null
) returns public.editor_activity_events language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); editor_row public.editors%rowtype; result_row public.editor_activity_events%rowtype; changed_at timestamptz := now();
begin
  if actor_id is null then raise exception 'Debes iniciar sesión'; end if;
  if target_status not in ('active','available','inactive') then raise exception 'Estado no válido'; end if;
  if target_available_until is not null and target_available_from is not null and target_available_until <= target_available_from then raise exception 'La hora final debe ser posterior a la inicial'; end if;
  select * into editor_row from public.editors where id = target_editor_id;
  if editor_row.id is null then raise exception 'No se encontró el editor'; end if;
  if not private.has_role(editor_row.organization_id,array['owner','admin']::public.app_role[]) and editor_row.user_id is distinct from actor_id then raise exception 'No puedes modificar este estado'; end if;
  insert into public.editor_activity_events(organization_id,editor_id,status,available_from,available_until,created_by,created_at,started_at,ended_at,note,updated_at)
  values(editor_row.organization_id,target_editor_id,target_status,target_available_from,target_available_until,actor_id,changed_at,changed_at,changed_at,nullif(trim(target_note),''),changed_at)
  returning * into result_row;
  return result_row;
end; $$;
revoke all on function public.set_editor_presence_state(uuid,text,timestamptz,timestamptz,text) from public, anon;
grant execute on function public.set_editor_presence_state(uuid,text,timestamptz,timestamptz,text) to authenticated;

-- Unique videos are calculated from permanent approved records, never from
-- correction comments. No activity/minutes/hour column is exposed by this view.
create or replace view public.editor_monthly_metrics with (security_invoker = true) as
with workload as (
  select a.organization_id,a.editor_id,to_char(coalesce(a.due_on,j.due_on,a.assigned_on),'YYYY-MM') period_key,
    coalesce(sum(ai.assigned_quantity),0)::integer assigned_videos
  from public.job_assignments a join public.jobs j on j.id=a.job_id join public.job_assignment_items ai on ai.assignment_id=a.id
  group by a.organization_id,a.editor_id,to_char(coalesce(a.due_on,j.due_on,a.assigned_on),'YYYY-MM')
), history as (
  select h.organization_id,h.editor_id,h.period_key,
    coalesce(sum(h.quantity),0)::integer approved_videos,
    coalesce(sum(h.quantity) filter (where coalesce(h.correction_count,0)=0),0)::integer approved_without_correction_videos,
    coalesce(sum(h.quantity) filter (where coalesce(h.correction_count,0)>0),0)::integer corrected_approved_videos,
    coalesce(sum(h.quantity) filter (where h.was_late is false),0)::integer on_time_videos,
    coalesce(sum(h.quantity) filter (where h.was_late is true),0)::integer late_videos,
    coalesce(sum(h.correction_count),0)::integer correction_count,
    coalesce(sum(h.quantity) filter (where coalesce(h.correction_count,0)>0),0)::integer correction_videos,
    coalesce(sum(h.client_total),0)::numeric(12,2) client_amount,
    coalesce(sum(h.editor_total),0)::numeric(12,2) editor_amount,
    coalesce(sum(h.net_profit),0)::numeric(12,2) net_profit
  from public.production_video_history h group by h.organization_id,h.editor_id,h.period_key
), metric_keys as (
  select organization_id,editor_id,period_key from workload union select organization_id,editor_id,period_key from history
  union select e.organization_id,e.id,to_char(now() at time zone coalesce(nullif(o.timezone,''),'Europe/Madrid'),'YYYY-MM') from public.editors e join public.organizations o on o.id=e.organization_id where e.status='active'
)
select k.organization_id,k.editor_id,e.name editor_name,k.period_key,
  coalesce(h.approved_videos,0)::integer submitted_videos,coalesce(h.approved_videos,0)::integer approved_videos,
  coalesce(h.approved_without_correction_videos,0)::integer approved_without_correction_videos,
  coalesce(h.corrected_approved_videos,0)::integer corrected_approved_videos,
  coalesce(h.late_videos,0)::integer late_videos,coalesce(h.on_time_videos,0)::integer on_time_videos,
  coalesce(h.correction_count,0)::integer correction_count,coalesce(h.correction_videos,0)::integer correction_videos,
  coalesce(h.client_amount,0)::numeric(12,2) client_amount,coalesce(h.editor_amount,0)::numeric(12,2) editor_amount,coalesce(h.net_profit,0)::numeric(12,2) net_profit,
  coalesce(w.assigned_videos,0)::integer assigned_videos,coalesce(h.approved_videos,0)::integer completed_videos,
  case when coalesce(h.approved_videos,0)>0 then round(coalesce(h.approved_without_correction_videos,0)*100.0/h.approved_videos,2) else 0 end first_pass_approval_rate
from metric_keys k join public.editors e on e.id=k.editor_id
left join workload w on w.organization_id=k.organization_id and w.editor_id=k.editor_id and w.period_key=k.period_key
left join history h on h.organization_id=k.organization_id and h.editor_id=k.editor_id and h.period_key=k.period_key;
grant select on public.editor_monthly_metrics to authenticated;

-- Linking a profile is optional for editors and clients; the internal record
-- continues to exist independently of Auth.
create or replace function public.admin_set_user_profile(
  target_user_id uuid,target_role public.app_role,target_display_name text,target_editor_id uuid default null,target_client_id uuid default null,target_active boolean default true,target_phone text default null
) returns public.profiles language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; output public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid() and active and role in ('owner'::public.app_role,'admin'::public.app_role);
  if actor.id is null then raise exception 'Solo un administrador puede gestionar usuarios'; end if;
  if target_role='owner'::public.app_role then raise exception 'El rol propietario no se asigna desde aquí'; end if;
  if coalesce(trim(target_display_name),'')='' then raise exception 'El nombre es obligatorio'; end if;
  if not exists(select 1 from auth.users where id=target_user_id) then raise exception 'No se encontró la cuenta'; end if;
  if target_editor_id is not null and not exists(select 1 from public.editors where id=target_editor_id and organization_id=actor.organization_id) then raise exception 'Editor no válido'; end if;
  if target_client_id is not null and not exists(select 1 from public.clients where id=target_client_id and organization_id=actor.organization_id) then raise exception 'Cliente no válido'; end if;
  if target_role <> 'editor'::public.app_role then target_editor_id:=null; end if;
  if target_role <> 'client'::public.app_role then target_client_id:=null; end if;
  update public.editors set user_id=null,updated_at=now() where organization_id=actor.organization_id and user_id=target_user_id and id is distinct from target_editor_id;
  update public.clients set user_id=null,updated_at=now() where organization_id=actor.organization_id and user_id=target_user_id and id is distinct from target_client_id;
  if target_editor_id is not null then update public.editors set user_id=target_user_id,updated_at=now() where id=target_editor_id; end if;
  if target_client_id is not null then update public.clients set user_id=target_user_id,updated_at=now() where id=target_client_id; end if;
  insert into public.profiles(id,organization_id,role,display_name,editor_id,client_id,active,updated_at)
  values(target_user_id,actor.organization_id,target_role,trim(target_display_name),target_editor_id,target_client_id,target_active,now())
  on conflict(id) do update set role=excluded.role,display_name=excluded.display_name,editor_id=excluded.editor_id,client_id=excluded.client_id,active=excluded.active,updated_at=now()
  returning * into output;
  return output;
end; $$;
