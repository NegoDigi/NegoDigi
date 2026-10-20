-- Production event integrity for partial approvals, corrected versions and
-- per-correction conversations. Operational rows remain separate from the
-- permanent delivery/accounting rows.

alter table public.delivery_submissions
  add column if not exists was_late boolean not null default false;

update public.delivery_submissions s
set was_late = true
from public.job_assignments a
where a.id = s.assignment_id
  and a.due_on is not null
  and s.created_at::date > a.due_on
  and s.was_late = false;

create or replace function private.capture_delivery_lateness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare deadline date;
begin
  select a.due_on into deadline
  from public.job_assignments a
  where a.id = new.assignment_id;

  new.was_late := deadline is not null and coalesce(new.created_at, now())::date > deadline;
  return new;
end;
$$;

drop trigger if exists delivery_submissions_capture_lateness on public.delivery_submissions;
create trigger delivery_submissions_capture_lateness
before insert on public.delivery_submissions
for each row execute function private.capture_delivery_lateness();

create table if not exists public.delivery_item_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_item_id uuid not null references public.delivery_submission_items(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  url text not null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  is_current boolean not null default true,
  unique (submission_item_id, version_number)
);

create unique index if not exists delivery_item_versions_current_unique
  on public.delivery_item_versions(submission_item_id)
  where is_current;

create index if not exists delivery_item_versions_timeline_idx
  on public.delivery_item_versions(submission_item_id, version_number desc);

insert into public.delivery_item_versions
  (organization_id, submission_item_id, version_number, url, submitted_by, submitted_at, is_current)
select i.organization_id, i.id, 1, i.url, s.submitted_by, coalesce(i.created_at, s.created_at), true
from public.delivery_submission_items i
join public.delivery_submissions s on s.id = i.submission_id
where coalesce(trim(i.url), '') <> ''
  and not exists (
    select 1 from public.delivery_item_versions v where v.submission_item_id = i.id
  );

create or replace function private.capture_delivery_item_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare next_version integer;
begin
  if tg_op = 'UPDATE' and new.url is not distinct from old.url then
    return new;
  end if;

  if coalesce(trim(new.url), '') = '' then
    return new;
  end if;

  update public.delivery_item_versions
  set is_current = false
  where submission_item_id = new.id and is_current;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.delivery_item_versions
  where submission_item_id = new.id;

  insert into public.delivery_item_versions
    (organization_id, submission_item_id, version_number, url, submitted_by, submitted_at, is_current)
  values
    (new.organization_id, new.id, next_version, new.url, auth.uid(), now(), true);

  return new;
end;
$$;

drop trigger if exists delivery_items_capture_version on public.delivery_submission_items;
create trigger delivery_items_capture_version
after insert or update of url on public.delivery_submission_items
for each row execute function private.capture_delivery_item_version();

alter table public.delivery_item_versions enable row level security;

drop policy if exists "delivery item versions read" on public.delivery_item_versions;
create policy "delivery item versions read"
on public.delivery_item_versions for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1
    from public.delivery_submission_items i
    join public.delivery_submissions s on s.id = i.submission_id
    where i.id = delivery_item_versions.submission_item_id
      and private.can_access_assignment(s.assignment_id)
  )
);

revoke all on public.delivery_item_versions from anon;
grant select on public.delivery_item_versions to authenticated;

alter table public.delivery_review_comments
  add column if not exists correction_id uuid
    references public.delivery_corrections(id) on delete cascade;

create index if not exists delivery_review_comments_correction_idx
  on public.delivery_review_comments(correction_id, created_at)
  where correction_id is not null;

create or replace function public.replace_delivery_item_version(
  target_item uuid,
  replacement_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.delivery_submission_items%rowtype;
  parent public.delivery_submissions%rowtype;
begin
  select * into target
  from public.delivery_submission_items
  where id = target_item;

  if target.id is null then raise exception 'No se encontró el vídeo'; end if;

  select * into parent
  from public.delivery_submissions
  where id = target.submission_id;

  if parent.id is null or not private.can_access_assignment(parent.assignment_id) then
    raise exception 'No tienes acceso a este vídeo';
  end if;
  if coalesce(trim(replacement_url), '') = '' then
    raise exception 'El vídeo necesita un enlace';
  end if;

  update public.delivery_submission_items
  set url = trim(replacement_url), status = 'pending_review',
      correction_notes = null, reviewed_at = null, updated_at = now()
  where id = target.id;

  update public.delivery_submissions
  set status = 'pending_review', review_notes = null, reviewed_by = null,
      reviewed_at = null, updated_at = now()
  where id = parent.id;

  update public.job_assignments
  set status = 'in_progress', updated_at = now()
  where id = parent.assignment_id and status not in ('cancelled', 'completed');

  update public.jobs
  set status = 'pending', delivered_on = null, updated_at = now()
  where id = parent.job_id and status <> 'cancelled';

  return target.id;
end;
$$;

revoke all on function public.replace_delivery_item_version(uuid, text) from public, anon;
grant execute on function public.replace_delivery_item_version(uuid, text) to authenticated;

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

    -- Idempotent: this also repairs older approved items whose accounting row
    -- was never created, without creating a second payment.
    insert into public.job_deliveries
      (organization_id, assignment_id, job_item_id, quantity, delivered_on, notes, submission_item_id)
    values
      (parent.organization_id, parent.assignment_id, parent.job_item_id, 1,
       parent.created_at::date, 'Vídeo aprobado en revisión', target.id)
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
    set status = 'delivered', delivered_on = approval_time::date, updated_at = approval_time
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

