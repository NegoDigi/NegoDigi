-- An administrative preview may target an editor who has not yet created an
-- Auth account. The authenticated administrator remains the actor; the target
-- editor is kept in the point record and the audit log.
create or replace function public.claim_editor_daily_ranking_point(
  target_editor_id uuid,
  acting_as_user_id uuid default null
)
returns table (claimed_at timestamptz, next_eligible_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
  target_editor public.editors%rowtype;
  latest_claim timestamptz;
  claim_time timestamptz := now();
begin
  select * into actor from public.profiles where id = auth.uid() and active;
  if actor.id is null then raise exception 'Debes iniciar sesión'; end if;
  if actor.role not in ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) then
    raise exception 'No tienes permiso para conseguir este punto';
  end if;

  select * into target_editor
  from public.editors
  where id = target_editor_id and organization_id = actor.organization_id;
  if target_editor.id is null then raise exception 'No se encontró el editor'; end if;

  if actor.role in ('owner'::public.app_role, 'admin'::public.app_role) then
    -- When the selected editor has an Auth account, a supplied preview subject
    -- must match it. Editors without access still remain valid preview targets.
    if acting_as_user_id is not null and target_editor.user_id is not null and target_editor.user_id is distinct from acting_as_user_id then
      raise exception 'El perfil seleccionado no coincide con el editor de esta vista previa';
    end if;
  elsif target_editor.user_id is distinct from actor.id or acting_as_user_id is not null then
    raise exception 'Solo puedes conseguir tu propio punto';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_editor_id::text, 0));
  select p.claimed_at into latest_claim
  from public.editor_daily_ranking_points p
  where p.editor_id = target_editor_id
  order by p.claimed_at desc
  limit 1
  for update;

  if latest_claim is not null and latest_claim > claim_time - interval '24 hours' then
    raise exception 'El punto diario estará disponible de nuevo a las %', latest_claim + interval '24 hours';
  end if;

  insert into public.editor_daily_ranking_points
    (organization_id, editor_id, claimed_by, acting_for_user_id, claimed_at, points)
  values
    (actor.organization_id, target_editor_id, actor.id,
      case when actor.role in ('owner'::public.app_role, 'admin'::public.app_role) then acting_as_user_id else null end,
      claim_time, 1);

  if actor.role in ('owner'::public.app_role, 'admin'::public.app_role) then
    insert into public.audit_log(organization_id, actor_id, action, entity_type, entity_id, after_data, source)
    values (
      actor.organization_id, actor.id, 'claim_daily_ranking_point_as_editor',
      'editor_daily_ranking_point', target_editor_id::text,
      jsonb_build_object('acting_as_user_id', acting_as_user_id, 'target_editor_id', target_editor_id, 'points', 1),
      'admin_preview'
    );
  end if;

  return query select claim_time, claim_time + interval '24 hours';
end;
$$;

revoke all on function public.claim_editor_daily_ranking_point(uuid, uuid) from public, anon;
grant execute on function public.claim_editor_daily_ranking_point(uuid, uuid) to authenticated;
