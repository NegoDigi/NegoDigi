-- Additive Marketing workspace. No seeds, financial writes or recurring jobs.
create table if not exists public.marketing_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('strategy','reference','channel','campaign','affiliate')),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'draft',
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
alter table public.marketing_resources enable row level security;
revoke all on public.marketing_resources from anon, authenticated;
grant select, insert, update on public.marketing_resources to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='marketing_resources' and policyname='marketing_admin_all') then
    create policy marketing_admin_all on public.marketing_resources for all to authenticated
    using (private.has_role(organization_id, array['owner','admin']::public.app_role[]))
    with check (private.has_role(organization_id, array['owner','admin']::public.app_role[]));
  end if;
end $$;
create index if not exists marketing_resources_org_kind on public.marketing_resources(organization_id,kind);
alter table public.content_items add column if not exists marketing_details jsonb not null default '{}'::jsonb;
alter table public.content_items add column if not exists strategy_id uuid;
alter table public.leads add column if not exists marketing_details jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists source_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='content_marketing_strategy_fk') then
    alter table public.content_items add constraint content_marketing_strategy_fk foreign key (organization_id,strategy_id) references public.marketing_resources(organization_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='leads_marketing_source_fk') then
    alter table public.leads add constraint leads_marketing_source_fk foreign key (organization_id,source_id) references public.marketing_resources(organization_id,id);
  end if;
end $$;
create index if not exists content_marketing_strategy_idx on public.content_items(organization_id,strategy_id);
create index if not exists leads_marketing_source_idx on public.leads(organization_id,source_id);
-- Concurrent creates of the same contact must not produce duplicate CRM leads.
create unique index if not exists leads_contact_unique on public.leads
  (organization_id, lower(regexp_replace(btrim(contact), '\s+', '', 'g')))
  where contact is not null and btrim(contact) <> '';
-- No destructive rollback: deploying the previous app leaves these unused additions intact.
