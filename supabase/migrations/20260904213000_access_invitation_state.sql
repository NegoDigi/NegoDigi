-- Separate team membership and operational access from the invitation lifecycle.
-- This prevents a temporary auth ban before signup from being displayed as a revocation.
alter table public.profiles
  add column if not exists access_state text not null default 'active';

alter table public.profiles
  drop constraint if exists profiles_access_state_check;

alter table public.profiles
  add constraint profiles_access_state_check
  check (access_state in ('pending_invitation', 'invitation_sent', 'active', 'revoked', 'archived'));

update public.profiles p
set access_state = case
  when p.role = 'editor'::public.app_role
    and exists (select 1 from public.editors e where e.id = p.editor_id and e.status = 'archived') then 'archived'
  when p.role = 'editor' and p.editor_id is not null
    and exists (select 1 from auth.users u where u.id = p.id and u.confirmed_at is null) then 'pending_invitation'
  when p.active then 'active'
  else 'revoked'
end
where p.access_state = 'active';

create or replace function public.activate_profile_after_invitation_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.confirmed_at is not null and old.confirmed_at is null then
    update public.profiles
    set active = true,
        access_state = 'active',
        updated_at = now()
    where id = new.id
      and access_state in ('pending_invitation', 'invitation_sent');
  end if;
  return new;
end;
$$;

drop trigger if exists activate_profile_after_invitation_confirmation on auth.users;
create trigger activate_profile_after_invitation_confirmation
after update of confirmed_at on auth.users
for each row execute function public.activate_profile_after_invitation_confirmation();
