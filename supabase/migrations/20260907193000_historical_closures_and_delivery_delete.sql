-- Complete confirmed historical closes. These figures never write to Finance.
insert into public.production_historical_month_closures (
  organization_id, period_key, gross_revenue, company_expenses, team_payment, net_profit, source_key, notes
) values
  ('00000000-0000-4000-8000-000000000001', '2026-02', 1431.75, 0.00, 354.00, 1077.75, 'user_confirmed_historical_close', 'Cierre confirmado por administración; no afecta Finanzas.'),
  ('00000000-0000-4000-8000-000000000001', '2026-05', 1344.75, 27.95, 360.50, 956.30, 'user_confirmed_historical_close', 'Cierre confirmado por administración; no afecta Finanzas.')
on conflict (organization_id, period_key) do update set
  gross_revenue = excluded.gross_revenue,
  company_expenses = excluded.company_expenses,
  team_payment = excluded.team_payment,
  net_profit = excluded.net_profit,
  source_key = excluded.source_key,
  notes = excluded.notes;

create or replace function public.delete_historical_production_record(target_record uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_org uuid;
begin
  select p.organization_id into target_org from public.profiles p where p.id = auth.uid() and p.active limit 1;
  if target_org is null or not private.has_role(target_org, array['owner','admin']::public.app_role[]) then raise exception 'Solo un administrador puede eliminar registros de Producción'; end if;
  delete from public.production_historical_work_items where id = target_record and organization_id = target_org;
  if found then return true; end if;
  delete from public.job_deliveries where id = target_record and organization_id = target_org;
  if found then return true; end if;
  raise exception 'No se encontró el registro de Producción';
end;
$$;
