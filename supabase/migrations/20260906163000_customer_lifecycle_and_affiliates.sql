-- CRM lifecycle and affiliate access. Additive and idempotent: no client,
-- lead or historical production record is deleted.

alter type public.app_role add value if not exists 'affiliate';

alter table public.clients
  add column if not exists relationship_type text not null default 'unclassified';

alter table public.clients
  drop constraint if exists clients_relationship_type_check;

alter table public.clients
  add constraint clients_relationship_type_check
  check (relationship_type in ('recurring', 'one_off', 'former', 'unclassified'));

create index if not exists clients_relationship_type_idx
  on public.clients (organization_id, relationship_type);

comment on column public.clients.relationship_type is
  'Commercial lifecycle: recurring, one_off, former or unclassified. It does not change production, finance or rates.';
