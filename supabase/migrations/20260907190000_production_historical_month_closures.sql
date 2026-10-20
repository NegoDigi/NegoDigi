-- Historical production closes are intentionally independent from Finance.
-- They preserve the real Jan–Aug reporting figures without creating, changing
-- or reusing financial transactions, receivables or bonus movements.
create table if not exists public.production_historical_month_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_key text not null check (period_key ~ '^\\d{4}-\\d{2}$'),
  gross_revenue numeric(12,2) not null check (gross_revenue >= 0),
  company_expenses numeric(12,2) not null default 0 check (company_expenses >= 0),
  team_payment numeric(12,2) not null check (team_payment >= 0),
  net_profit numeric(12,2) not null,
  source_key text not null default 'manual_historical_close',
  notes text,
  created_at timestamptz not null default now(),
  unique (organization_id, period_key)
);

alter table public.production_historical_month_closures enable row level security;
grant select on public.production_historical_month_closures to authenticated;

create policy production_historical_month_closures_admin_read
on public.production_historical_month_closures for select to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

create policy production_historical_month_closures_admin_write
on public.production_historical_month_closures for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

insert into public.production_historical_month_closures (
  organization_id, period_key, gross_revenue, company_expenses, team_payment, net_profit, source_key, notes
) values
  ('00000000-0000-4000-8000-000000000001', '2026-01', 738.00, 0.00, 190.00, 548.00, 'user_confirmed_historical_close', 'Cierre confirmado por administración; no afecta Finanzas.'),
  ('00000000-0000-4000-8000-000000000001', '2026-03', 1529.00, 8.95, 501.50, 1018.55, 'user_confirmed_historical_close', 'Cierre confirmado por administración; no afecta Finanzas.'),
  ('00000000-0000-4000-8000-000000000001', '2026-04', 2620.25, 27.95, 551.50, 2040.80, 'user_confirmed_historical_close', 'Cierre confirmado por administración; no afecta Finanzas.')
on conflict (organization_id, period_key) do update set
  gross_revenue = excluded.gross_revenue,
  company_expenses = excluded.company_expenses,
  team_payment = excluded.team_payment,
  net_profit = excluded.net_profit,
  source_key = excluded.source_key,
  notes = excluded.notes;
