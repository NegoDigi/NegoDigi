-- First access from the normal domain, approved explicitly by Direction.
-- Tokens are hashed. Passwords are never stored in this request queue.
create table public.account_setup_requests (
  id uuid primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  reference text not null unique,
  token_hash text not null check (length(token_hash) = 64),
  status text not null default 'pending' check (status in ('pending','approved','processing','consumed','rejected','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  processing_at timestamptz,
  password_saved_at timestamptz,
  lease_id uuid,
  completed_at timestamptz,
  constraint account_setup_real_identity check ((user_id is null) = (organization_id is null))
);
create unique index account_setup_one_open_per_user on public.account_setup_requests(user_id)
  where user_id is not null and status in ('pending','approved','processing');
create index account_setup_admin_queue on public.account_setup_requests(organization_id,created_at desc)
  where user_id is not null and status in ('pending','approved','processing');
alter table public.account_setup_requests enable row level security;
revoke all on public.account_setup_requests from public, anon, authenticated;
grant select, insert, update, delete on public.account_setup_requests to service_role;

create table public.account_setup_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1
);
alter table public.account_setup_rate_limits enable row level security;
revoke all on public.account_setup_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.account_setup_rate_limits to service_role;

create function public.account_setup_take_limit(limit_key text, max_attempts integer, window_seconds integer)
returns boolean language plpgsql set search_path = '' as $$
declare hits integer;
begin
  delete from public.account_setup_rate_limits where key_hash in
    (select key_hash from public.account_setup_rate_limits where window_started_at < now() - interval '1 day' limit 100);
  insert into public.account_setup_rate_limits as limits(key_hash) values(limit_key)
  on conflict(key_hash) do update set
    attempts = case when limits.window_started_at < now() - make_interval(secs => window_seconds) then 1 else limits.attempts + 1 end,
    window_started_at = case when limits.window_started_at < now() - make_interval(secs => window_seconds) then now() else limits.window_started_at end
  returning attempts into hits;
  return hits <= max_attempts;
end;
$$;

create function public.account_setup_claim(request_id uuid, request_token_hash text, request_lease_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare setup public.account_setup_requests%rowtype; target public.profiles%rowtype;
begin
  select * into setup from public.account_setup_requests where id=request_id and token_hash=request_token_hash for update;
  if not found or setup.user_id is null then return jsonb_build_object('state','unavailable'); end if;
  if setup.status='consumed' then return jsonb_build_object('state','consumed'); end if;
  if setup.expires_at <= now() then return jsonb_build_object('state','expired'); end if;
  if setup.status='processing' and setup.password_saved_at is not null then
    return jsonb_build_object('state','password_saved','user_id',setup.user_id,'email',setup.email,'lease_id',setup.lease_id);
  end if;
  if setup.status <> 'approved' then return jsonb_build_object('state',setup.status); end if;
  select * into target from public.profiles where id=setup.user_id for update;
  if not found or target.active or target.access_state <> 'pending_invitation'
    or target.organization_id <> setup.organization_id then
    update public.account_setup_requests set status='rejected' where id=setup.id;
    return jsonb_build_object('state','unavailable');
  end if;
  update public.account_setup_requests set status='processing',processing_at=now(),lease_id=request_lease_id where id=setup.id;
  return jsonb_build_object('state','processing','user_id',setup.user_id,'email',setup.email);
end;
$$;

-- Only this service-only finalizer accesses auth.users. It changes the ban
-- timestamp in the same transaction as profile activation, after locking the
-- profile. A concurrent revoke can never be overwritten by a stale Auth call.
create function public.account_setup_finalize(request_id uuid, request_token_hash text, request_lease_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare setup public.account_setup_requests%rowtype; target public.profiles%rowtype;
begin
  if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  select * into setup from public.account_setup_requests where id=request_id and token_hash=request_token_hash for update;
  if not found or setup.user_id is null or setup.status<>'processing'
    or setup.password_saved_at is null or setup.lease_id is distinct from request_lease_id or setup.expires_at<=now() then return false; end if;
  select * into target from public.profiles where id=setup.user_id for update;
  if not found or target.active or target.access_state<>'pending_invitation'
    or target.organization_id<>setup.organization_id then
    update public.account_setup_requests set status='rejected' where id=setup.id;
    return false;
  end if;
  update auth.users set banned_until=null where id=setup.user_id;
  update public.profiles set active=true,access_state='active',updated_at=now() where id=setup.user_id;
  update public.account_setup_requests set status='consumed',completed_at=now() where id=setup.id;
  return true;
end;
$$;

-- Preserve existing invitation behavior; domain setup waits for its explicit
-- finalizer instead of activating halfway through Auth's password update.
create or replace function public.activate_profile_after_invitation_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.confirmed_at is not null and old.confirmed_at is null then
    update public.profiles set active=true,access_state='active',updated_at=now()
    where id=new.id and access_state in ('pending_invitation','invitation_sent')
      and not exists(select 1 from public.account_setup_requests where user_id=new.id and processing_at is not null);
  end if;
  return new;
end;
$$;
revoke all on function public.activate_profile_after_invitation_confirmation() from public, anon, authenticated;
revoke all on function public.account_setup_take_limit(text,integer,integer), public.account_setup_claim(uuid,text,uuid), public.account_setup_finalize(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.account_setup_take_limit(text,integer,integer), public.account_setup_claim(uuid,text,uuid), public.account_setup_finalize(uuid,text,uuid) to service_role;
