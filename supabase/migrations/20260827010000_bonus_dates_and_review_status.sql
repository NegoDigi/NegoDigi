-- Keep the bonus list ordered by the actual last change, not by its original payment date.
create or replace view public.bonus_balances
with (security_invoker = true)
as
select
  b.id,
  b.organization_id,
  b.client_id,
  b.name,
  b.initial_amount,
  b.declared_pending_amount,
  coalesce(sum(m.amount) filter (where m.movement_type = 'usage'), 0)::numeric(12,2) as used_amount,
  greatest(
    0,
    b.initial_amount - b.declared_pending_amount - coalesce(sum(m.amount) filter (where m.movement_type = 'usage'), 0)
  )::numeric(12,2) as available_amount,
  greatest(
    0,
    b.declared_pending_amount + coalesce(sum(m.amount) filter (where m.movement_type = 'usage'), 0) - b.initial_amount
  )::numeric(12,2) as excess_amount,
  b.status,
  b.paid_on,
  b.expires_on,
  b.updated_at
from public.bonus_accounts b
left join public.bonus_movements m on m.bonus_id = b.id
group by b.id, b.updated_at;

grant select on public.bonus_balances to authenticated;

-- Editors can submit a complete assignment for review. It must not enter the
-- owner's history until the owner explicitly approves it.
alter table public.job_assignments
  drop constraint if exists job_assignments_status_check;
alter table public.job_assignments
  add constraint job_assignments_status_check
  check (status = any (array['pending','in_progress','ready_for_review','completed','cancelled']));

create or replace function private.refresh_job_assignment(target_assignment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job uuid;
  total_assigned numeric := 0;
  total_delivered numeric := 0;
begin
  update public.job_assignment_items jai
  set delivered_quantity = coalesce((
    select sum(d.quantity) from public.job_deliveries d
    where d.assignment_id = jai.assignment_id and d.job_item_id = jai.job_item_id
  ), 0),
  updated_at = now()
  where jai.assignment_id = target_assignment
    and jai.delivered_quantity is distinct from coalesce((
      select sum(d.quantity) from public.job_deliveries d
      where d.assignment_id = jai.assignment_id and d.job_item_id = jai.job_item_id
    ), 0);

  update public.job_assignments ja
  set status = case
      when exists (select 1 from public.job_assignment_items jai where jai.assignment_id = ja.id)
       and not exists (select 1 from public.job_assignment_items jai where jai.assignment_id = ja.id and jai.delivered_quantity < jai.assigned_quantity) then 'ready_for_review'
      when exists (select 1 from public.job_assignment_items jai where jai.assignment_id = ja.id and jai.delivered_quantity > 0) then 'in_progress'
      else 'pending'
    end,
    updated_at = now()
  where ja.id = target_assignment
    and ja.status <> 'completed'
    and ja.status <> 'cancelled'
  returning ja.job_id into target_job;

  if target_job is null then return; end if;

  select coalesce(sum(jai.assigned_quantity), 0), coalesce(sum(jai.delivered_quantity), 0)
    into total_assigned, total_delivered
  from public.job_assignment_items jai
  join public.job_assignments ja on ja.id = jai.assignment_id
  where ja.job_id = target_job and ja.status <> 'cancelled';

  -- The owner approval flow, not the editor's last upload, moves the job to
  -- delivered/history. Partial work remains pending.
  if total_delivered > 0 and total_delivered < total_assigned then
    update public.jobs set status = 'pending', delivered_on = null, updated_at = now()
    where id = target_job and status <> 'cancelled';
  end if;
end;
$$;

revoke all on function private.refresh_job_assignment(uuid) from public, anon, authenticated;

create or replace function private.after_job_assignment_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    if not exists (
      select 1 from public.job_assignments ja
      where ja.job_id = new.job_id
        and ja.status not in ('completed', 'cancelled')
    ) then
      update public.jobs
      set status = 'delivered', delivered_on = coalesce(delivered_on, current_date), updated_at = now()
      where id = new.job_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.after_job_assignment_status_change() from public, anon, authenticated;

drop trigger if exists complete_job_after_assignment_approval on public.job_assignments;
create trigger complete_job_after_assignment_approval
after update of status on public.job_assignments
for each row execute function private.after_job_assignment_status_change();
