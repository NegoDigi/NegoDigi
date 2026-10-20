create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  role_label text,
  notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.client_contacts enable row level security;
grant select, insert, update, delete on table public.client_contacts to authenticated;

create policy client_contacts_admin_all
on public.client_contacts for all to authenticated
using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));

update public.client_rates set service = 'Miniaturas' where service = 'Miniatura';
create unique index client_rates_one_service_per_client
on public.client_rates (client_id, service);

create or replace function private.refresh_job_financials(target_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  target_client uuid;
  client_total numeric(12,2) := 0;
  editor_total numeric(12,2) := 0;
  tools_total numeric(12,2) := 0;
begin
  select j.organization_id, j.client_id into target_org, target_client from public.jobs j where j.id = target_job;
  if target_org is null then return; end if;

  select coalesce(sum(ji.quantity * coalesce(rate.client_unit_price, 0)), 0),
         coalesce(sum(ji.quantity * coalesce(rate.editor_unit_cost, 0)), 0)
  into client_total, editor_total
  from public.job_items ji
  left join lateral (
    select cr.client_unit_price, cr.editor_unit_cost
    from public.client_rates cr
    where cr.client_id = target_client and cr.active
      and (case when cr.service in ('Miniatura', 'Miniaturas') then 'Miniaturas' else cr.service end)
        = (case when ji.service in ('Miniatura', 'Miniaturas') then 'Miniaturas' else ji.service end)
    order by cr.created_at desc limit 1
  ) rate on true
  where ji.job_id = target_job;

  insert into public.job_financials (job_id, organization_id, client_total, editor_total, tools_total, updated_at)
  values (target_job, target_org, client_total, editor_total, tools_total, now())
  on conflict (job_id) do update set
    client_total = excluded.client_total,
    editor_total = excluded.editor_total,
    tools_total = excluded.tools_total,
    updated_at = now();
end;
$$;

create or replace function private.after_job_item_financial_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_job_financials(coalesce(new.job_id, old.job_id));
  return coalesce(new, old);
end;
$$;

create or replace function private.after_job_client_financial_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_job_financials(new.id);
  return new;
end;
$$;

create trigger refresh_job_financials_after_item
after insert or update or delete on public.job_items
for each row execute function private.after_job_item_financial_change();

create trigger refresh_job_financials_after_client_change
after update of client_id on public.jobs
for each row execute function private.after_job_client_financial_change();

select private.refresh_job_financials(id) from public.jobs;
