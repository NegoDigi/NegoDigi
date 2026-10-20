-- Administrative panel preview: preserve the authenticated administrator while
-- attributing editor-originated actions to the selected editor.  The caller is
-- always verified from auth.uid(); a browser can never nominate an arbitrary
-- profile without an owner/admin session.

create or replace function public.submit_delivery_items(
  target_assignment uuid,
  target_job_item uuid,
  delivery_items jsonb,
  acting_as_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  actor_org uuid;
  parent record;
  assignment_editor_user_id uuid;
  effective_submitter uuid;
  submission_id uuid := gen_random_uuid();
  item_count integer;
begin
  select * into actor from public.profiles
  where id = auth.uid() and active = true;
  if actor.id is null then raise exception 'Sesión sin perfil activo'; end if;
  actor_org := actor.organization_id;
  effective_submitter := auth.uid();

  select e.user_id into assignment_editor_user_id
  from public.job_assignments a
  join public.editors e on e.id = a.editor_id
  where a.id = target_assignment and a.organization_id = actor_org;

  if actor.role in ('owner'::public.app_role, 'admin'::public.app_role)
     and acting_as_user_id is not null then
    if assignment_editor_user_id is distinct from acting_as_user_id then
      raise exception 'El perfil seleccionado no corresponde al editor asignado';
    end if;
    effective_submitter := acting_as_user_id;
  elsif acting_as_user_id is not null then
    raise exception 'Solo Dirección puede actuar en nombre de un editor';
  end if;

  if not private.can_access_assignment(target_assignment) then
    raise exception 'No tienes acceso a esta asignación';
  end if;

  select a.organization_id, a.job_id into parent
  from public.job_assignments a
  join public.job_assignment_items ai
    on ai.assignment_id = a.id and ai.job_item_id = target_job_item
  where a.id = target_assignment and a.organization_id = actor_org
  for update of ai;
  if parent.job_id is null then raise exception 'No se encontró el servicio asignado'; end if;
  if jsonb_typeof(delivery_items) <> 'array' or jsonb_array_length(delivery_items) < 1 then
    raise exception 'Añade al menos un vídeo';
  end if;
  if exists (select 1 from jsonb_array_elements(delivery_items) item where coalesce(trim(item->>'url'), '') = '') then
    raise exception 'Cada vídeo necesita un enlace';
  end if;
  item_count := jsonb_array_length(delivery_items);

  insert into public.delivery_submissions
    (id, organization_id, assignment_id, job_id, job_item_id, submitted_by, quantity, approved_quantity, folder_url, status)
  values
    (submission_id, actor_org, target_assignment, parent.job_id, target_job_item, effective_submitter, item_count, 0, null, 'pending_review');
  insert into public.delivery_submission_items (organization_id, submission_id, label, url, status)
  select actor_org, submission_id, coalesce(nullif(trim(item->>'label'), ''), 'Vídeo'), trim(item->>'url'), 'pending_review'
  from jsonb_array_elements(delivery_items) with ordinality as rows(item, position)
  order by position;

  if acting_as_user_id is not null then
    insert into public.audit_log(organization_id, actor_id, action, entity_type, entity_id, after_data, source)
    values (actor_org, auth.uid(), 'submit_delivery_as_editor', 'delivery_submission', submission_id::text,
      jsonb_build_object('acting_as_user_id', acting_as_user_id, 'assignment_id', target_assignment), 'admin_preview');
  end if;
  return submission_id;
end;
$$;
revoke all on function public.submit_delivery_items(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.submit_delivery_items(uuid, uuid, jsonb, uuid) to authenticated;

create or replace function public.set_editor_presence_state(
  target_editor_id uuid, target_status text, target_available_from timestamptz default null,
  target_available_until timestamptz default null, target_note text default null,
  acting_as_user_id uuid default null
) returns public.editor_activity_events language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor public.profiles%rowtype; editor_row public.editors%rowtype; result_row public.editor_activity_events%rowtype; effective_creator uuid; changed_at timestamptz := now();
begin
  select * into actor from public.profiles where id = actor_id and active;
  if actor.id is null then raise exception 'Debes iniciar sesión'; end if;
  if target_status not in ('active','available','inactive') then raise exception 'Estado no válido'; end if;
  if target_available_until is not null and target_available_from is not null and target_available_until <= target_available_from then raise exception 'La hora final debe ser posterior a la inicial'; end if;
  select * into editor_row from public.editors where id = target_editor_id and organization_id = actor.organization_id;
  if editor_row.id is null then raise exception 'No se encontró el editor'; end if;
  effective_creator := actor_id;
  if acting_as_user_id is not null then
    if actor.role not in ('owner'::public.app_role,'admin'::public.app_role) or editor_row.user_id is distinct from acting_as_user_id then
      raise exception 'No puedes actuar en nombre de este editor';
    end if;
    effective_creator := acting_as_user_id;
  elsif actor.role not in ('owner'::public.app_role,'admin'::public.app_role) and editor_row.user_id is distinct from actor_id then
    raise exception 'No puedes modificar este estado';
  end if;
  insert into public.editor_activity_events(organization_id,editor_id,status,available_from,available_until,created_by,created_at,started_at,ended_at,note,updated_at)
  values(editor_row.organization_id,target_editor_id,target_status,target_available_from,target_available_until,effective_creator,changed_at,changed_at,changed_at,nullif(trim(target_note),''),changed_at)
  returning * into result_row;
  if acting_as_user_id is not null then
    insert into public.audit_log(organization_id, actor_id, action, entity_type, entity_id, after_data, source)
    values(actor.organization_id, actor_id, 'set_editor_presence_as_editor', 'editor_activity_event', result_row.id::text,
      jsonb_build_object('acting_as_user_id', acting_as_user_id, 'editor_id', target_editor_id), 'admin_preview');
  end if;
  return result_row;
end; $$;
revoke all on function public.set_editor_presence_state(uuid,text,timestamptz,timestamptz,text,uuid) from public, anon;
grant execute on function public.set_editor_presence_state(uuid,text,timestamptz,timestamptz,text,uuid) to authenticated;
