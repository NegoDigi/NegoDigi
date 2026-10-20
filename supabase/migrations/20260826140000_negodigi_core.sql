-- NegoDigi OS · Supabase core schema
-- Generated for the migration from Notion/Glide on 2026-08-26.

create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'admin', 'editor', 'client');
create type public.job_status as enum ('pending', 'delivered', 'cancelled');
create type public.finance_type as enum ('income', 'expense');
create type public.bonus_status as enum ('active', 'exhausted', 'paused', 'expired');
create type public.receivable_status as enum ('open', 'paid', 'cancelled');
create type public.command_status as enum ('draft', 'awaiting_confirmation', 'executed', 'failed', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  currency text not null default 'EUR',
  timezone text not null default 'Europe/Madrid',
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  kind text,
  status text not null default 'active',
  joined_on date,
  drive_url text,
  brand_guide_url text,
  notion_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.client_private (
  client_id uuid primary key references public.clients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  phone text,
  notes text,
  tax_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.editors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role_label text not null default 'Editor',
  status text not null default 'active',
  availability text,
  base_cost numeric(12,2) not null default 0 check (base_cost >= 0),
  paid_historical numeric(12,2) not null default 0 check (paid_historical >= 0),
  net_historical numeric(12,2) not null default 0,
  notion_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.editor_private (
  editor_id uuid primary key references public.editors(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  phone text,
  notes text,
  payment_details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.app_role not null,
  display_name text not null,
  client_id uuid references public.clients(id) on delete set null,
  editor_id uuid references public.editors(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (role = 'client' and client_id is not null and editor_id is null)
    or (role = 'editor' and editor_id is not null and client_id is null)
    or (role in ('owner', 'admin') and client_id is null and editor_id is null)
  )
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.has_role(target_organization uuid, allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.organization_id = target_organization
      and p.active = true
      and p.role = any(allowed_roles)
  );
$$;

revoke all on function private.has_role(uuid, public.app_role[]) from public, anon;
grant execute on function private.has_role(uuid, public.app_role[]) to authenticated;

-- Roles are assigned from the email already approved in the imported team data;
-- never from user-controlled signup metadata.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nd_org_id uuid;
  nd_editor_id uuid;
  nd_editor_name text;
begin
  select o.id into nd_org_id
  from public.organizations o
  where o.slug = 'negodigi';

  if nd_org_id is null then
    return new;
  end if;

  if lower(coalesce(new.email, '')) = 'contactsantimv@gmail.com' then
    insert into public.profiles (id, organization_id, role, display_name)
    values (new.id, nd_org_id, 'owner'::public.app_role, 'Santiago Martínez Vallejo')
    on conflict (id) do nothing;

    update public.editors e
    set user_id = new.id, updated_at = now()
    from public.editor_private ep
    where e.id = ep.editor_id
      and lower(ep.email) = lower(new.email);
    return new;
  end if;

  select e.id, e.name into nd_editor_id, nd_editor_name
  from public.editors e
  join public.editor_private ep on ep.editor_id = e.id
  where e.organization_id = nd_org_id
    and lower(ep.email) = lower(coalesce(new.email, ''));

  if nd_editor_id is not null then
    update public.editors set user_id = new.id, updated_at = now()
    where id = nd_editor_id and user_id is null;

    insert into public.profiles (id, organization_id, role, display_name, editor_id)
    values (new.id, nd_org_id, 'editor'::public.app_role, nd_editor_name, nd_editor_id)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.client_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service text not null,
  client_unit_price numeric(12,2) not null default 0 check (client_unit_price >= 0),
  editor_unit_cost numeric(12,2) not null default 0 check (editor_unit_cost >= 0),
  active boolean not null default true,
  notes text,
  notion_id text,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  editor_id uuid references public.editors(id) on delete set null,
  title text not null,
  status public.job_status not null default 'pending',
  assigned_on date,
  due_on date,
  delivered_on date,
  source text not null default 'app',
  notion_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Legacy Notion deliveries do not all include a delivery date. New app-created
  -- deliveries must include one, while preserving historic data faithfully.
  check (status <> 'delivered' or delivered_on is not null or source = 'notion')
);

create table public.job_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  service text not null,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now()
);

create table public.job_financials (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_total numeric(12,2) not null default 0 check (client_total >= 0),
  editor_total numeric(12,2) not null default 0 check (editor_total >= 0),
  tools_total numeric(12,2) not null default 0 check (tools_total >= 0),
  margin numeric(12,2) generated always as (client_total - editor_total - tools_total) stored,
  updated_at timestamptz not null default now()
);

create table public.editor_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  editor_id uuid not null references public.editors(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending',
  paid_on date,
  created_at timestamptz not null default now()
);

create table public.bonus_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null,
  initial_amount numeric(12,2) not null check (initial_amount >= 0),
  declared_pending_amount numeric(12,2) not null default 0 check (declared_pending_amount >= 0),
  status public.bonus_status not null default 'active',
  paid_on date,
  expires_on date,
  payment_account text,
  description text,
  notion_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Internal ledger: required for traceability, intentionally hidden from the UI.
create table public.bonus_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bonus_id uuid not null references public.bonus_accounts(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  movement_type text not null check (movement_type in ('usage', 'adjustment')),
  amount numeric(12,2) not null,
  description text,
  detail jsonb not null default '{}'::jsonb,
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  bonus_id uuid references public.bonus_accounts(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  status public.receivable_status not null default 'open',
  source text not null default 'manual',
  description text,
  started_on date,
  paid_on date,
  notion_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index receivables_open_bonus_excess_idx
on public.receivables (bonus_id)
where source = 'bonus_excess' and status = 'open';

create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_type public.finance_type not null,
  amount numeric(12,2) not null check (amount >= 0),
  concept text not null,
  category text,
  account text,
  occurred_on date not null,
  client_id uuid references public.clients(id) on delete set null,
  editor_id uuid references public.editors(id) on delete set null,
  receivable_id uuid references public.receivables(id) on delete set null,
  proof_url text,
  source text not null default 'app',
  source_key text,
  created_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  file_kind text not null check (file_kind in ('raw', 'delivery', 'document', 'brand')),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table public.revision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  source text not null default 'app',
  created_at timestamptz not null default now()
);

create table public.ai_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  raw_input text not null,
  input_type text not null default 'text' check (input_type in ('text', 'audio')),
  transcript text,
  parsed_action jsonb,
  status public.command_status not null default 'draft',
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  result jsonb,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact text,
  interest text,
  stage text not null default 'new',
  next_action_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  platform text,
  status text not null default 'idea',
  publish_on date,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  section text,
  body text not null,
  audience public.app_role[] not null default array['owner','admin','editor']::public.app_role[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.can_access_job(target_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs j
    left join public.editors e on e.id = j.editor_id
    left join public.clients c on c.id = j.client_id
    where j.id = target_job
      and (
        private.has_role(j.organization_id, array['owner','admin']::public.app_role[])
        or e.user_id = (select auth.uid())
        or c.user_id = (select auth.uid())
      )
  );
$$;

revoke all on function private.can_access_job(uuid) from public, anon;
grant execute on function private.can_access_job(uuid) to authenticated;

create function private.reconcile_bonus_receivable(target_bonus uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bonus_row public.bonus_accounts%rowtype;
  used_amount numeric(12,2);
  excess_amount numeric(12,2);
begin
  select * into bonus_row from public.bonus_accounts where id = target_bonus;
  if not found then return; end if;

  select coalesce(sum(amount), 0) into used_amount
  from public.bonus_movements
  where bonus_id = target_bonus and movement_type = 'usage';

  excess_amount := greatest(0, bonus_row.declared_pending_amount + used_amount - bonus_row.initial_amount);

  if excess_amount > 0 then
    insert into public.receivables (
      organization_id, client_id, bonus_id, amount, status, source, description, started_on
    ) values (
      bonus_row.organization_id, bonus_row.client_id, bonus_row.id, excess_amount,
      'open', 'bonus_excess', 'Exceso automático del bono ' || bonus_row.name, current_date
    )
    on conflict (bonus_id) where source = 'bonus_excess' and status = 'open'
    do update set amount = excluded.amount, updated_at = now();
  else
    delete from public.receivables
    where bonus_id = target_bonus and source = 'bonus_excess' and status = 'open';
  end if;

  update public.bonus_accounts
  set status = case
    when greatest(0, initial_amount - declared_pending_amount - used_amount) = 0 then 'exhausted'::public.bonus_status
    when status = 'exhausted' then 'active'::public.bonus_status
    else status
  end,
  updated_at = now()
  where id = target_bonus;
end;
$$;

revoke all on function private.reconcile_bonus_receivable(uuid) from public, anon, authenticated;

create function private.bonus_movement_reconcile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_bonus_receivable(coalesce(new.bonus_id, old.bonus_id));
  return coalesce(new, old);
end;
$$;

create function private.bonus_account_reconcile_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.reconcile_bonus_receivable(new.id);
  return new;
end;
$$;

revoke all on function private.bonus_movement_reconcile_trigger() from public, anon, authenticated;
revoke all on function private.bonus_account_reconcile_trigger() from public, anon, authenticated;

create trigger bonus_movement_reconcile
after insert or update or delete on public.bonus_movements
for each row execute function private.bonus_movement_reconcile_trigger();

create trigger bonus_account_reconcile
after update of initial_amount, declared_pending_amount on public.bonus_accounts
for each row execute function private.bonus_account_reconcile_trigger();

create view public.bonus_balances
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
  b.expires_on
from public.bonus_accounts b
left join public.bonus_movements m on m.bonus_id = b.id
group by b.id;

create view public.monthly_finance_summary
with (security_invoker = true)
as
select
  organization_id,
  date_trunc('month', occurred_on)::date as month,
  coalesce(sum(amount) filter (where transaction_type = 'income'), 0)::numeric(12,2) as income,
  coalesce(sum(amount) filter (where transaction_type = 'expense'), 0)::numeric(12,2) as expenses,
  (
    coalesce(sum(amount) filter (where transaction_type = 'income'), 0)
    - coalesce(sum(amount) filter (where transaction_type = 'expense'), 0)
  )::numeric(12,2) as net
from public.finance_transactions
group by organization_id, date_trunc('month', occurred_on);

-- Index every ownership and RLS lookup column.
create index profiles_organization_id_idx on public.profiles (organization_id);
create index clients_organization_id_idx on public.clients (organization_id);
create index clients_user_id_idx on public.clients (user_id);
create index editors_organization_id_idx on public.editors (organization_id);
create index editors_user_id_idx on public.editors (user_id);
create index jobs_organization_id_idx on public.jobs (organization_id);
create index jobs_client_id_idx on public.jobs (client_id);
create index jobs_editor_id_idx on public.jobs (editor_id);
create index jobs_status_due_idx on public.jobs (organization_id, status, due_on);
create index job_items_job_id_idx on public.job_items (job_id);
create index bonus_accounts_client_id_idx on public.bonus_accounts (client_id);
create index bonus_movements_bonus_id_idx on public.bonus_movements (bonus_id);
create index receivables_client_id_idx on public.receivables (client_id);
create index finance_transactions_org_date_idx on public.finance_transactions (organization_id, occurred_on);
create index files_job_id_idx on public.files (job_id);
create index notifications_user_id_idx on public.notifications (user_id, read_at);
create index audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);

-- Explicit Data API grants. Signed-out visitors receive no table access.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.clients, public.editors, public.client_rates, public.jobs, public.job_items,
  public.bonus_accounts, public.receivables, public.files, public.revision_requests, public.notifications,
  public.ai_commands, public.leads, public.content_items, public.knowledge_articles to authenticated;
grant select, insert, update, delete on public.client_private, public.editor_private, public.job_financials,
  public.editor_payments, public.bonus_movements, public.finance_transactions to authenticated;
grant select on public.bonus_balances, public.monthly_finance_summary to authenticated;
grant select, insert on public.audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- RLS is enabled on every exposed table.
alter table public.organizations enable row level security;
alter table public.clients enable row level security;
alter table public.client_private enable row level security;
alter table public.editors enable row level security;
alter table public.editor_private enable row level security;
alter table public.profiles enable row level security;
alter table public.client_rates enable row level security;
alter table public.jobs enable row level security;
alter table public.job_items enable row level security;
alter table public.job_financials enable row level security;
alter table public.editor_payments enable row level security;
alter table public.bonus_accounts enable row level security;
alter table public.bonus_movements enable row level security;
alter table public.receivables enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.files enable row level security;
alter table public.revision_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table public.ai_commands enable row level security;
alter table public.leads enable row level security;
alter table public.content_items enable row level security;
alter table public.knowledge_articles enable row level security;

create policy organizations_select on public.organizations for select to authenticated
using (private.has_role(id, array['owner','admin','editor','client']::public.app_role[]));

create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy profiles_admin_insert on public.profiles for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy profiles_admin_delete on public.profiles for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy clients_select on public.clients for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or user_id = (select auth.uid())
  or exists (select 1 from public.jobs j join public.editors e on e.id = j.editor_id where j.client_id = clients.id and e.user_id = (select auth.uid()))
);
create policy clients_admin_insert on public.clients for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy clients_admin_update on public.clients for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy clients_admin_delete on public.clients for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy client_private_admin_all on public.client_private for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy editors_select on public.editors for select to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]) or user_id = (select auth.uid()));
create policy editors_admin_insert on public.editors for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy editors_admin_update on public.editors for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy editors_admin_delete on public.editors for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy editor_private_admin_all on public.editor_private for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy client_rates_select on public.client_rates for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (select 1 from public.clients c where c.id = client_rates.client_id and c.user_id = (select auth.uid()))
);
create policy client_rates_admin_write on public.client_rates for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy jobs_select on public.jobs for select to authenticated
using (private.can_access_job(id));
create policy jobs_admin_insert on public.jobs for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy jobs_admin_update on public.jobs for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy jobs_admin_delete on public.jobs for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy job_items_select on public.job_items for select to authenticated
using (private.can_access_job(job_id));
create policy job_items_admin_write on public.job_items for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy job_financials_admin_all on public.job_financials for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy editor_payments_select on public.editor_payments for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (select 1 from public.editors e where e.id = editor_payments.editor_id and e.user_id = (select auth.uid()))
);
create policy editor_payments_admin_write on public.editor_payments for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy bonus_accounts_select on public.bonus_accounts for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (select 1 from public.clients c where c.id = bonus_accounts.client_id and c.user_id = (select auth.uid()))
);
create policy bonus_accounts_admin_write on public.bonus_accounts for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy bonus_movements_admin_all on public.bonus_movements for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy receivables_select on public.receivables for select to authenticated
using (
  private.has_role(organization_id, array['owner','admin']::public.app_role[])
  or exists (select 1 from public.clients c where c.id = receivables.client_id and c.user_id = (select auth.uid()))
);
create policy receivables_admin_write on public.receivables for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy finance_admin_all on public.finance_transactions for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy files_select on public.files for select to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]) or (job_id is not null and private.can_access_job(job_id)) or uploaded_by = (select auth.uid()));
create policy files_insert on public.files for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]) or (job_id is not null and private.can_access_job(job_id)));
create policy files_update on public.files for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]) or uploaded_by = (select auth.uid()))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]) or uploaded_by = (select auth.uid()));
create policy files_delete on public.files for delete to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]) or uploaded_by = (select auth.uid()));

create policy revision_requests_select on public.revision_requests for select to authenticated
using (private.can_access_job(job_id));
create policy revision_requests_insert on public.revision_requests for insert to authenticated
with check (private.can_access_job(job_id) and requested_by = (select auth.uid()));
create policy revision_requests_admin_update on public.revision_requests for update to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy notifications_own_select on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_admin_insert on public.notifications for insert to authenticated
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy audit_admin_select on public.audit_log for select to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy audit_insert on public.audit_log for insert to authenticated
with check (actor_id = (select auth.uid()) and private.has_role(organization_id, array['owner','admin','editor','client']::public.app_role[]));

create policy ai_commands_own_select on public.ai_commands for select to authenticated
using (actor_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy ai_commands_own_insert on public.ai_commands for insert to authenticated
with check (actor_id = (select auth.uid()) and private.has_role(organization_id, array['owner','admin','editor','client']::public.app_role[]));
create policy ai_commands_own_update on public.ai_commands for update to authenticated
using (actor_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (actor_id = (select auth.uid()) or private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy leads_admin_all on public.leads for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy content_admin_all on public.content_items for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy knowledge_select on public.knowledge_articles for select to authenticated
using (
  private.has_role(organization_id, audience)
  or private.has_role(organization_id, array['owner','admin']::public.app_role[])
);
create policy knowledge_admin_write on public.knowledge_articles for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

-- Private storage buckets. Object paths must be: organization_id/job_id/kind/filename.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('negodigi-material', 'negodigi-material', false, 2147483648),
  ('negodigi-deliveries', 'negodigi-deliveries', false, 2147483648),
  ('negodigi-documents', 'negodigi-documents', false, 52428800),
  ('negodigi-brand', 'negodigi-brand', false, 52428800)
on conflict (id) do nothing;

create policy storage_job_select on storage.objects for select to authenticated
using (
  bucket_id in ('negodigi-material', 'negodigi-deliveries', 'negodigi-documents', 'negodigi-brand')
  and (
    owner_id = (select auth.uid()::text)
    or private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.app_role[])
    or private.can_access_job(((storage.foldername(name))[2])::uuid)
  )
);
create policy storage_job_insert on storage.objects for insert to authenticated
with check (
  bucket_id in ('negodigi-material', 'negodigi-deliveries', 'negodigi-documents', 'negodigi-brand')
  and (
    private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.app_role[])
    or private.can_access_job(((storage.foldername(name))[2])::uuid)
  )
);
create policy storage_job_update on storage.objects for update to authenticated
using (
  owner_id = (select auth.uid()::text)
  or private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.app_role[])
  or private.can_access_job(((storage.foldername(name))[2])::uuid)
)
with check (
  owner_id = (select auth.uid()::text)
  or private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.app_role[])
  or private.can_access_job(((storage.foldername(name))[2])::uuid)
);
create policy storage_job_delete on storage.objects for delete to authenticated
using (
  owner_id = (select auth.uid()::text)
  or private.has_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.app_role[])
  or private.can_access_job(((storage.foldername(name))[2])::uuid)
);
