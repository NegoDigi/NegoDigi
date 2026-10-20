-- Standalone investment register. It does not create finance transactions and
-- attributed returns are intentionally kept outside general income totals.
create table public.finance_investments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text,
  amount numeric(12,2) not null check (amount > 0),
  invested_on date not null default current_date,
  periodicity text not null default 'one_off' check (periodicity in ('one_off', 'monthly', 'annual')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  attributed_return numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_investment_clients (
  investment_id uuid not null references public.finance_investments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  primary key (investment_id, client_id)
);

create table public.finance_investment_services (
  investment_id uuid not null references public.finance_investments(id) on delete cascade,
  service_name text not null check (length(trim(service_name)) > 0),
  primary key (investment_id, service_name)
);

create table public.finance_investment_transaction_links (
  investment_id uuid not null references public.finance_investments(id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions(id) on delete restrict,
  primary key (investment_id, transaction_id)
);

create index finance_investments_org_date_idx
  on public.finance_investments (organization_id, invested_on desc);
create index finance_investment_clients_client_idx
  on public.finance_investment_clients (client_id);
create index finance_investment_transaction_links_transaction_idx
  on public.finance_investment_transaction_links (transaction_id);

alter table public.finance_investments enable row level security;
alter table public.finance_investment_clients enable row level security;
alter table public.finance_investment_services enable row level security;
alter table public.finance_investment_transaction_links enable row level security;

create policy finance_investments_admin_all on public.finance_investments for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy finance_investment_clients_admin_all on public.finance_investment_clients for all to authenticated
using (exists (select 1 from public.finance_investments investment where investment.id = investment_id and private.has_role(investment.organization_id, array['owner','admin']::public.app_role[])))
with check (exists (select 1 from public.finance_investments investment where investment.id = investment_id and private.has_role(investment.organization_id, array['owner','admin']::public.app_role[])));

create policy finance_investment_services_admin_all on public.finance_investment_services for all to authenticated
using (exists (select 1 from public.finance_investments investment where investment.id = investment_id and private.has_role(investment.organization_id, array['owner','admin']::public.app_role[])))
with check (exists (select 1 from public.finance_investments investment where investment.id = investment_id and private.has_role(investment.organization_id, array['owner','admin']::public.app_role[])));

create policy finance_investment_transaction_links_admin_all on public.finance_investment_transaction_links for all to authenticated
using (exists (select 1 from public.finance_investments investment where investment.id = investment_id and private.has_role(investment.organization_id, array['owner','admin']::public.app_role[])))
with check (exists (select 1 from public.finance_investments investment where investment.id = investment_id and private.has_role(investment.organization_id, array['owner','admin']::public.app_role[])));

comment on table public.finance_investments is 'Independent investment register. Attributed return is ROI-only and is never general income.';
comment on table public.finance_investment_transaction_links is 'Optional future traceability to existing finance movements; no movement is created automatically.';
