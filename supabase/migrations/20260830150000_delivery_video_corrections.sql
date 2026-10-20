-- Independent correction records for each submitted video.
-- Corrections are review metadata, never deliveries or financial movements.
create table if not exists public.delivery_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_item_id uuid not null references public.delivery_submission_items(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'responded', 'reviewed', 'closed')),
  editor_response text,
  editor_completed boolean not null default false,
  responded_at timestamptz,
  reviewed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_corrections_item_idx
  on public.delivery_corrections (submission_item_id, created_at);

alter table public.files
  add column if not exists correction_id uuid references public.delivery_corrections(id) on delete set null;

create index if not exists files_correction_idx on public.files(correction_id)
  where correction_id is not null;

create or replace function private.touch_delivery_correction()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists delivery_corrections_touch on public.delivery_corrections;
create trigger delivery_corrections_touch
before update on public.delivery_corrections
for each row execute function private.touch_delivery_correction();

create or replace function private.guard_delivery_correction_editor_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_role public.app_role;
begin
  select p.role into actor_role
  from public.profiles p
  where p.id = (select auth.uid()) and p.active = true;

  if actor_role not in ('owner'::public.app_role, 'admin'::public.app_role) then
    if new.organization_id is distinct from old.organization_id
       or new.submission_item_id is distinct from old.submission_item_id
       or new.created_by is distinct from old.created_by
       or new.body is distinct from old.body
       or new.reviewed_at is distinct from old.reviewed_at
       or new.closed_at is distinct from old.closed_at
       or (new.status is distinct from old.status and new.status <> 'responded')
       or (new.status = 'responded' and new.editor_response is null) then
      raise exception 'Los editores solo pueden responder y marcar sus correcciones';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_corrections_guard_editor on public.delivery_corrections;
create trigger delivery_corrections_guard_editor
before update on public.delivery_corrections
for each row execute function private.guard_delivery_correction_editor_update();

alter table public.delivery_corrections enable row level security;

drop policy if exists "delivery corrections read" on public.delivery_corrections;
create policy "delivery corrections read"
on public.delivery_corrections for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1
    from public.delivery_submission_items i
    join public.delivery_submissions s on s.id = i.submission_id
    where i.id = delivery_corrections.submission_item_id
      and private.can_access_assignment(s.assignment_id)
  )
);

drop policy if exists "delivery corrections admin insert" on public.delivery_corrections;
create policy "delivery corrections admin insert"
on public.delivery_corrections for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

drop policy if exists "delivery corrections update" on public.delivery_corrections;
create policy "delivery corrections update"
on public.delivery_corrections for update to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1
    from public.delivery_submission_items i
    join public.delivery_submissions s on s.id = i.submission_id
    where i.id = delivery_corrections.submission_item_id
      and private.can_access_assignment(s.assignment_id)
  )
)
with check (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (
    select 1
    from public.delivery_submission_items i
    join public.delivery_submissions s on s.id = i.submission_id
    where i.id = delivery_corrections.submission_item_id
      and private.can_access_assignment(s.assignment_id)
  )
);

drop policy if exists "delivery corrections admin delete" on public.delivery_corrections;
create policy "delivery corrections admin delete"
on public.delivery_corrections for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

revoke all on public.delivery_corrections from anon;
grant select, insert, update, delete on public.delivery_corrections to authenticated;
