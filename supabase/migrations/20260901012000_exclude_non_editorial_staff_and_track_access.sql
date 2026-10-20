-- Safe editorial-only projection. The central metrics view remains untouched:
-- financial and historical reporting in other modules keep its exact records.

alter table public.profiles
  add column if not exists last_access_at timestamptz;

create or replace function public.record_my_access_event(device text default null)
returns public.auth_access_history
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; output public.auth_access_history%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() and active;
  if actor.id is null then raise exception 'Sesión sin perfil activo'; end if;
  update public.profiles set last_access_at = now(), updated_at = now() where id = actor.id;
  insert into public.auth_access_history (organization_id,user_id,display_name_snapshot,result,device_info)
  values (actor.organization_id,actor.id,actor.display_name,'success',nullif(left(trim(coalesce(device,'')),240),''))
  returning * into output;
  return output;
end; $$;
revoke all on function public.record_my_access_event(text) from public, anon;
grant execute on function public.record_my_access_event(text) to authenticated;

create or replace view public.editorial_monthly_metrics with (security_invoker = true) as
select m.*
from public.editor_monthly_metrics m
join public.editors e on e.id=m.editor_id and e.organization_id=m.organization_id
where lower(trim(coalesce(e.role_label,''))) not in ('manager','administrador','admin','owner','fundador','dirección','direccion')
  and not exists (
    select 1 from public.profiles p
    where p.editor_id=e.id and p.role in ('owner'::public.app_role,'admin'::public.app_role)
  );

grant select on public.editorial_monthly_metrics to authenticated;
