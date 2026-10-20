-- Individual approvals must use the organization's Spanish calendar day.
-- The upsert remains idempotent through the unique submission_item_id key.
create or replace function public.review_delivery_item(
  target_submission uuid,
  target_item uuid,
  decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_org uuid;
  actor_role public.app_role;
  parent public.delivery_submissions%rowtype;
  target public.delivery_submission_items%rowtype;
  approved_count integer;
  item_count integer;
  assignment_complete boolean;
  job_complete boolean;
  approval_time timestamptz := now();
  org_timezone text := 'Europe/Madrid';
begin
  select p.organization_id, p.role into actor_org, actor_role
  from public.profiles p
  where p.id = auth.uid() and p.active = true;

  if actor_role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    raise exception 'Solo administración puede revisar entregas';
  end if;
  if decision not in ('approved', 'changes_requested') then
    raise exception 'Decisión de revisión no válida';
  end if;

  select * into parent
  from public.delivery_submissions
  where id = target_submission and organization_id = actor_org
  for update;

  select * into target
  from public.delivery_submission_items
  where id = target_item and submission_id = target_submission
  for update;

  if parent.id is null or target.id is null then
    raise exception 'No se encontró el vídeo de la entrega';
  end if;

  select coalesce(nullif(o.timezone, ''), 'Europe/Madrid')
  into org_timezone
  from public.organizations o
  where o.id = parent.organization_id;

  update public.delivery_submission_items
  set status = decision,
      correction_notes = case when decision = 'approved' then null else correction_notes end,
      reviewed_at = approval_time,
      updated_at = approval_time
  where id = target.id;

  if decision = 'approved' then
    update public.delivery_corrections
    set status = 'closed', reviewed_at = approval_time,
        closed_at = approval_time, updated_at = approval_time
    where submission_item_id = target.id and status <> 'closed';

    insert into public.job_deliveries
      (organization_id, assignment_id, job_item_id, quantity, delivered_on, notes, submission_item_id)
    values
      (parent.organization_id, parent.assignment_id, parent.job_item_id, 1,
       (parent.created_at at time zone org_timezone)::date,
       'Vídeo aprobado en revisión', target.id)
    on conflict (submission_item_id) where submission_item_id is not null
    do update set delivered_on = excluded.delivered_on,
                  notes = excluded.notes;
  else
    update public.job_assignments
    set status = 'in_progress', updated_at = approval_time
    where id = parent.assignment_id and status <> 'cancelled';

    update public.jobs
    set status = 'pending', delivered_on = null, updated_at = approval_time
    where id = parent.job_id and status <> 'cancelled';
  end if;

  select count(*), count(*) filter (where status = 'approved')
    into item_count, approved_count
  from public.delivery_submission_items
  where submission_id = parent.id;

  update public.delivery_submissions
  set approved_quantity = approved_count,
      status = case
        when item_count > 0 and approved_count = item_count then 'approved'
        when decision = 'changes_requested' then 'changes_requested'
        else 'pending_review'
      end,
      reviewed_by = auth.uid(),
      reviewed_at = approval_time,
      updated_at = approval_time
  where id = parent.id;

  select exists (
    select 1
    from public.job_assignment_items jai
    where jai.assignment_id = parent.assignment_id
    having count(*) > 0
       and bool_and(jai.delivered_quantity >= jai.assigned_quantity)
  ) into assignment_complete;

  if assignment_complete then
    update public.job_assignments
    set status = 'completed', updated_at = approval_time
    where id = parent.assignment_id;
  end if;

  select exists (
    select 1
    from public.job_assignments a
    where a.job_id = parent.job_id and a.status <> 'cancelled'
    having count(*) > 0 and bool_and(a.status = 'completed')
  ) into job_complete;

  if job_complete then
    update public.jobs
    set status = 'delivered',
        delivered_on = (approval_time at time zone org_timezone)::date,
        updated_at = approval_time
    where id = parent.job_id;
  elsif decision = 'approved' then
    update public.jobs
    set status = 'pending', delivered_on = null, updated_at = approval_time
    where id = parent.job_id and status <> 'cancelled';
  end if;

  return jsonb_build_object(
    'item_id', target.id,
    'approved_quantity', approved_count,
    'submission_quantity', item_count,
    'assignment_completed', assignment_complete,
    'job_completed', job_complete
  );
end;
$$;

revoke all on function public.review_delivery_item(uuid, uuid, text) from public, anon;
grant execute on function public.review_delivery_item(uuid, uuid, text) to authenticated;
