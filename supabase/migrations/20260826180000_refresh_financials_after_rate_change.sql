-- Rates are the source of truth for the current value of a production order.
-- Recalculate every affected order whenever a rate is inserted, changed or removed.
create or replace function private.refresh_client_job_financials(target_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_job uuid;
begin
  for target_job in
    select j.id
    from public.jobs j
    where j.client_id = target_client
  loop
    perform private.refresh_job_financials(target_job);
  end loop;
end;
$$;

revoke all on function private.refresh_client_job_financials(uuid) from public;

create or replace function private.after_client_rate_financial_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    perform private.refresh_client_job_financials(old.client_id);
  end if;

  perform private.refresh_client_job_financials(coalesce(new.client_id, old.client_id));
  return coalesce(new, old);
end;
$$;

revoke all on function private.after_client_rate_financial_change() from public;

drop trigger if exists refresh_job_financials_after_rate_change on public.client_rates;
create trigger refresh_job_financials_after_rate_change
after insert or update or delete on public.client_rates
for each row execute function private.after_client_rate_financial_change();
