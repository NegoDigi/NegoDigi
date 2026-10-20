create table if not exists public.complementary_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  investment_id uuid references public.finance_investments(id) on delete set null,
  income_transaction_id uuid references public.finance_transactions(id) on delete set null,
  service_name text not null,
  tool_name text,
  client_price numeric(12,2) not null check (client_price >= 0),
  periodicity text not null default 'one_off' check (periodicity in ('one_off','monthly','quarterly','annual')),
  started_on date not null,
  next_expected_on date,
  ended_on date,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists complementary_services_organization_idx on public.complementary_services(organization_id, status);
create index if not exists complementary_services_client_idx on public.complementary_services(client_id);
alter table public.complementary_services enable row level security;
drop policy if exists complementary_services_admin_access on public.complementary_services;
create policy complementary_services_admin_access on public.complementary_services for all to authenticated using (private.has_role(organization_id, array['owner','admin']::public.app_role[])) with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
comment on table public.complementary_services is 'Servicios complementarios. Los importes son previstos hasta que income_transaction_id vincule un cobro real; esta tabla nunca genera movimientos automáticamente.';
