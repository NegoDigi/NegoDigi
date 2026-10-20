-- Monthly historical work summaries have no client or delivery date. They are
-- kept outside operational jobs and Finance while still appearing in history
-- and editor comparisons.
alter table public.production_historical_work_items enable row level security;
grant select on public.production_historical_work_items to authenticated;
drop policy if exists production_historical_work_items_select on public.production_historical_work_items;
create policy production_historical_work_items_select on public.production_historical_work_items
for select to authenticated using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.organization_id = production_historical_work_items.organization_id and p.editor_id = production_historical_work_items.editor_id and p.active)
);
drop policy if exists production_historical_work_items_admin_write on public.production_historical_work_items;
create policy production_historical_work_items_admin_write on public.production_historical_work_items
for all to authenticated using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

-- Keep the current production history columns and append summary rows.
create or replace view public.production_video_history
with (security_invoker = true)
as
with correction_counts as (
  select submission_item_id, count(*)::integer as correction_count from public.delivery_corrections group by submission_item_id
), version_history as (
  select submission_item_id, count(*)::integer as version_count,
    jsonb_agg(jsonb_build_object('version', version_number, 'url', url, 'submitted_at', submitted_at, 'current', is_current) order by version_number) as versions
  from public.delivery_item_versions group by submission_item_id
), base_history as (
  select d.id as delivery_id, d.organization_id, j.id as job_id, j.title as job_title, j.client_id, c.name as client_name,
    a.id as assignment_id, a.editor_id, e.name as editor_name, d.job_item_id, ji.service, d.submission_item_id as video_id,
    coalesce(i.label, 'Entrega histórica') as video_label,
    coalesce(i.video_number, row_number() over (partition by j.id order by coalesce(i.created_at, d.delivered_on::timestamp), d.id)::integer) as video_number,
    d.quantity, coalesce(fs.client_unit_price, d.client_unit_price, 0)::numeric(12,2) as client_unit_price,
    coalesce(fs.editor_unit_cost, ai.editor_unit_cost, 0)::numeric(12,2) as editor_unit_cost,
    (d.quantity * coalesce(fs.client_unit_price, d.client_unit_price, 0))::numeric(12,2) as client_total,
    (d.quantity * coalesce(fs.editor_unit_cost, ai.editor_unit_cost, 0))::numeric(12,2) as editor_total,
    (d.quantity * (coalesce(fs.client_unit_price, d.client_unit_price, 0) - coalesce(fs.editor_unit_cost, ai.editor_unit_cost, 0)))::numeric(12,2) as net_profit,
    a.assigned_on, j.planned_on, a.due_on,
    coalesce(s.created_at, d.delivered_on::timestamp at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid')) as delivered_at,
    coalesce(i.reviewed_at, d.delivered_on::timestamp at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid')) as approved_at,
    coalesce(cc.correction_count, 0) as correction_count, coalesce(vh.version_count, case when i.id is null then 0 else 1 end) as version_count,
    coalesce(vh.versions, '[]'::jsonb) as versions, coalesce(s.was_late, a.due_on is not null and d.delivered_on > a.due_on) as was_late,
    'approved'::text as status, to_char(coalesce(i.reviewed_at at time zone coalesce(nullif(o.timezone, ''), 'Europe/Madrid'), d.delivered_on::timestamp), 'YYYY-MM') as period_key, d.billable
  from public.job_deliveries d join public.job_assignments a on a.id = d.assignment_id join public.jobs j on j.id = a.job_id
  join public.organizations o on o.id = d.organization_id join public.clients c on c.id = j.client_id join public.editors e on e.id = a.editor_id
  join public.job_items ji on ji.id = d.job_item_id left join public.job_assignment_items ai on ai.assignment_id = d.assignment_id and ai.job_item_id = d.job_item_id
  left join public.delivery_submission_items i on i.id = d.submission_item_id left join public.delivery_submissions s on s.id = i.submission_id
  left join public.production_delivery_financial_snapshots fs on fs.delivery_id = d.id left join correction_counts cc on cc.submission_item_id = i.id left join version_history vh on vh.submission_item_id = i.id
), summary_history as (
  select w.id as delivery_id, w.organization_id, null::uuid as job_id, w.work_name as job_title, null::uuid as client_id,
    'Resumen histórico'::text as client_name, null::uuid as assignment_id, w.editor_id, e.name as editor_name, null::uuid as job_item_id,
    'Resumen histórico'::text as service, null::uuid as video_id, w.work_name as video_label, 1::integer as video_number, 1::numeric as quantity,
    w.amount::numeric(12,2) as client_unit_price, w.amount::numeric(12,2) as editor_unit_cost, w.amount::numeric(12,2) as client_total,
    w.amount::numeric(12,2) as editor_total, 0::numeric(12,2) as net_profit, null::date as assigned_on, null::date as planned_on, null::date as due_on,
    null::timestamptz as delivered_at, null::timestamptz as approved_at, 0::integer as correction_count, 0::integer as version_count,
    '[]'::jsonb as versions, false as was_late, 'approved'::text as status, w.period_key, false as billable
  from public.production_historical_work_items w join public.editors e on e.id = w.editor_id
)
select * from base_history union all select * from summary_history;

grant select on public.production_video_history to authenticated;

-- Safe correction path: only non-billable history can be permanently removed.
create or replace function public.delete_historical_production_record(target_record uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_org uuid;
begin
  select p.organization_id into target_org from public.profiles p where p.id = auth.uid() and p.active limit 1;
  if target_org is null or not private.has_role(target_org, array['owner','admin']::public.app_role[]) then raise exception 'Solo un administrador puede eliminar históricos'; end if;
  delete from public.production_historical_work_items where id = target_record and organization_id = target_org;
  if found then return true; end if;
  if exists (select 1 from public.job_deliveries where id = target_record and organization_id = target_org and billable = false) then
    delete from public.job_deliveries where id = target_record and organization_id = target_org and billable = false;
    return true;
  end if;
  raise exception 'Solo se pueden eliminar registros históricos no facturables';
end;
$$;
revoke all on function public.delete_historical_production_record(uuid) from public, anon;
grant execute on function public.delete_historical_production_record(uuid) to authenticated;
