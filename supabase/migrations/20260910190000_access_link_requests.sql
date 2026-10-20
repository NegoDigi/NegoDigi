create table if not exists public.access_link_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_kind text not null check (request_kind in ('activation', 'recovery')),
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  unique (organization_id, user_id, request_kind)
);

create index if not exists access_link_requests_open_idx
  on public.access_link_requests (organization_id, handled_at, requested_at desc);

alter table public.access_link_requests enable row level security;
revoke all on table public.access_link_requests from public, anon, authenticated;
