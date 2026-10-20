-- Hiring candidates are editorial leads, not application users or CRM leads.
-- Source rows are kept separately so a future manual sync can attach a new
-- source record to the same stable candidate without deleting history.
create table if not exists public.team_hiring_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  age text,
  phone text,
  normalized_phone text,
  email text,
  tools text,
  portfolio text,
  why_choose text,
  personal_info text,
  status text not null default 'SIN ESTADO INFORMADO',
  original_status text,
  response_date timestamptz,
  source text not null,
  source_id text not null,
  source_order integer not null default 0,
  raw_data jsonb not null default '{}'::jsonb,
  source_records jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_hiring_lead_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.team_hiring_leads(id) on delete cascade,
  source text not null,
  source_id text not null,
  response_date timestamptz,
  source_order integer not null default 0,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, source_id)
);

create index if not exists team_hiring_leads_org_order_idx
  on public.team_hiring_leads (organization_id, response_date, source_order);
create index if not exists team_hiring_leads_org_name_idx
  on public.team_hiring_leads (organization_id, normalized_name);
create index if not exists team_hiring_leads_org_phone_idx
  on public.team_hiring_leads (organization_id, normalized_phone);
create index if not exists team_hiring_lead_sources_lead_idx
  on public.team_hiring_lead_sources (organization_id, lead_id);

grant select, update on public.team_hiring_leads to authenticated;

alter table public.team_hiring_leads enable row level security;
alter table public.team_hiring_lead_sources enable row level security;

create policy team_hiring_leads_admin_select
  on public.team_hiring_leads for select to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy team_hiring_leads_admin_update
  on public.team_hiring_leads for update to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
  with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
create policy team_hiring_lead_sources_admin_select
  on public.team_hiring_lead_sources for select to authenticated
  using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
