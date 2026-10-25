-- Harden authenticated SECURITY DEFINER entry points that can change identity,
-- production, or editorial activity data. Each operation remains tenant-bound.

CREATE OR REPLACE FUNCTION public.admin_set_user_profile(
  target_user_id uuid,
  target_role public.app_role,
  target_display_name text,
  target_editor_id uuid DEFAULT NULL,
  target_client_id uuid DEFAULT NULL,
  target_active boolean DEFAULT true,
  target_phone text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor public.profiles%ROWTYPE;
  existing public.profiles%ROWTYPE;
  output public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO actor
  FROM public.profiles
  WHERE id = auth.uid() AND active
    AND role IN ('owner'::public.app_role, 'admin'::public.app_role);

  IF actor.id IS NULL THEN
    RAISE EXCEPTION 'Solo un administrador puede gestionar usuarios';
  END IF;
  IF target_user_id IS NULL OR target_user_id = actor.id THEN
    RAISE EXCEPTION 'No puedes modificar tu propio perfil desde aquí';
  END IF;
  IF target_role IS NULL OR target_role NOT IN (
    'admin'::public.app_role, 'editor'::public.app_role,
    'client'::public.app_role, 'affiliate'::public.app_role
  ) THEN
    RAISE EXCEPTION 'El rol no se puede asignar desde aquí';
  END IF;
  IF target_role = 'admin'::public.app_role AND actor.role <> 'owner'::public.app_role THEN
    RAISE EXCEPTION 'Solo la cuenta propietaria puede asignar administradores';
  END IF;
  IF coalesce(trim(target_display_name), '') = '' OR char_length(trim(target_display_name)) > 120 THEN
    RAISE EXCEPTION 'El nombre no es válido';
  END IF;
  IF target_phone IS NOT NULL AND char_length(trim(target_phone)) > 64 THEN
    RAISE EXCEPTION 'El teléfono no es válido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'No se encontró la cuenta';
  END IF;

  SELECT * INTO existing FROM public.profiles WHERE id = target_user_id FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.organization_id IS DISTINCT FROM actor.organization_id THEN
      RAISE EXCEPTION 'No puedes modificar usuarios de otra organización';
    END IF;
    IF existing.role = 'owner'::public.app_role THEN
      RAISE EXCEPTION 'La cuenta propietaria no se modifica desde aquí';
    END IF;
    IF existing.role = 'admin'::public.app_role AND actor.role <> 'owner'::public.app_role THEN
      RAISE EXCEPTION 'Solo la cuenta propietaria puede gestionar administradores';
    END IF;
  END IF;

  IF target_editor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.editors
    WHERE id = target_editor_id AND organization_id = actor.organization_id
  ) THEN
    RAISE EXCEPTION 'Editor no válido';
  END IF;
  IF target_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = target_client_id AND organization_id = actor.organization_id
  ) THEN
    RAISE EXCEPTION 'Cliente no válido';
  END IF;
  IF target_role <> 'editor'::public.app_role THEN target_editor_id := NULL; END IF;
  IF target_role <> 'client'::public.app_role THEN target_client_id := NULL; END IF;

  UPDATE public.editors
  SET user_id = NULL, updated_at = now()
  WHERE organization_id = actor.organization_id
    AND user_id = target_user_id AND id IS DISTINCT FROM target_editor_id;
  UPDATE public.clients
  SET user_id = NULL, updated_at = now()
  WHERE organization_id = actor.organization_id
    AND user_id = target_user_id AND id IS DISTINCT FROM target_client_id;

  IF target_editor_id IS NOT NULL THEN
    UPDATE public.editors SET user_id = target_user_id, updated_at = now()
    WHERE id = target_editor_id AND organization_id = actor.organization_id;
  END IF;
  IF target_client_id IS NOT NULL THEN
    UPDATE public.clients SET user_id = target_user_id, updated_at = now()
    WHERE id = target_client_id AND organization_id = actor.organization_id;
  END IF;

  INSERT INTO public.profiles
    (id, organization_id, role, display_name, editor_id, client_id, active, updated_at)
  VALUES
    (target_user_id, actor.organization_id, target_role, trim(target_display_name),
     target_editor_id, target_client_id, coalesce(target_active, false), now())
  ON CONFLICT (id) DO UPDATE SET
    role = excluded.role,
    display_name = excluded.display_name,
    editor_id = excluded.editor_id,
    client_id = excluded.client_id,
    active = excluded.active,
    updated_at = now()
  WHERE public.profiles.organization_id = excluded.organization_id
  RETURNING * INTO output;

  IF output.id IS NULL THEN
    RAISE EXCEPTION 'No puedes modificar usuarios de otra organización';
  END IF;
  RETURN output;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_user_profile(uuid, public.app_role, text, uuid, uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_profile(uuid, public.app_role, text, uuid, uuid, boolean, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_editor_activity_state(
  target_editor_id uuid,
  target_status text,
  target_available_from timestamptz DEFAULT NULL,
  target_available_until timestamptz DEFAULT NULL,
  target_note text DEFAULT NULL
)
RETURNS public.editor_activity_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor public.profiles%ROWTYPE;
  editor_row public.editors%ROWTYPE;
  result_row public.editor_activity_events%ROWTYPE;
  changed_at timestamptz := now();
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid() AND active = true;
  IF actor.id IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión con una cuenta activa'; END IF;
  IF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) THEN
    RAISE EXCEPTION 'No tienes permiso para actualizar la actividad';
  END IF;
  IF target_status IS NULL OR target_status NOT IN ('available', 'working', 'waiting', 'inactive') THEN
    RAISE EXCEPTION 'Estado de actividad no válido';
  END IF;
  IF target_available_until IS NOT NULL AND target_available_from IS NOT NULL
     AND target_available_until <= target_available_from THEN
    RAISE EXCEPTION 'La hora final debe ser posterior a la hora inicial';
  END IF;
  IF target_note IS NOT NULL AND char_length(target_note) > 500 THEN
    RAISE EXCEPTION 'La nota supera el límite permitido';
  END IF;

  SELECT * INTO editor_row FROM public.editors
  WHERE id = target_editor_id AND organization_id = actor.organization_id;
  IF editor_row.id IS NULL THEN RAISE EXCEPTION 'No se encontró el editor'; END IF;
  IF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role)
     AND (actor.role <> 'editor'::public.app_role OR editor_row.user_id IS DISTINCT FROM actor.id) THEN
    RAISE EXCEPTION 'No puedes modificar la actividad de otro editor';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('editor-activity-' || target_editor_id::text));
  UPDATE public.editor_activity_events
  SET ended_at = greatest(started_at, changed_at), updated_at = changed_at
  WHERE editor_id = target_editor_id AND ended_at IS NULL;

  INSERT INTO public.editor_activity_events
    (organization_id, editor_id, status, available_from, available_until,
     created_by, created_at, started_at, note, updated_at)
  VALUES
    (actor.organization_id, target_editor_id, target_status, target_available_from,
     target_available_until, actor.id, changed_at, changed_at,
     nullif(trim(target_note), ''), changed_at)
  RETURNING * INTO result_row;
  RETURN result_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_editor_activity_state(uuid, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_editor_activity_state(uuid, text, timestamptz, timestamptz, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_editor_presence_state(
  target_editor_id uuid,
  target_status text,
  target_available_from timestamptz DEFAULT NULL,
  target_available_until timestamptz DEFAULT NULL,
  target_note text DEFAULT NULL
)
RETURNS public.editor_activity_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor public.profiles%ROWTYPE;
  editor_row public.editors%ROWTYPE;
  result_row public.editor_activity_events%ROWTYPE;
  changed_at timestamptz := now();
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid() AND active = true;
  IF actor.id IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión con una cuenta activa'; END IF;
  IF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) THEN
    RAISE EXCEPTION 'No tienes permiso para modificar este estado';
  END IF;
  IF target_status IS NULL OR target_status NOT IN ('active', 'available', 'inactive') THEN RAISE EXCEPTION 'Estado no válido'; END IF;
  IF target_available_until IS NOT NULL AND target_available_from IS NOT NULL
     AND target_available_until <= target_available_from THEN
    RAISE EXCEPTION 'La hora final debe ser posterior a la inicial';
  END IF;
  IF target_note IS NOT NULL AND char_length(target_note) > 500 THEN
    RAISE EXCEPTION 'La nota supera el límite permitido';
  END IF;
  SELECT * INTO editor_row FROM public.editors
  WHERE id = target_editor_id AND organization_id = actor.organization_id;
  IF editor_row.id IS NULL THEN RAISE EXCEPTION 'No se encontró el editor'; END IF;
  IF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role)
     AND (actor.role <> 'editor'::public.app_role OR editor_row.user_id IS DISTINCT FROM actor.id) THEN
    RAISE EXCEPTION 'No puedes modificar este estado';
  END IF;

  INSERT INTO public.editor_activity_events
    (organization_id, editor_id, status, available_from, available_until,
     created_by, created_at, started_at, ended_at, note, updated_at)
  VALUES
    (actor.organization_id, target_editor_id, target_status, target_available_from,
     target_available_until, actor.id, changed_at, changed_at, changed_at,
     nullif(trim(target_note), ''), changed_at)
  RETURNING * INTO result_row;
  RETURN result_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_editor_presence_state(uuid, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_editor_presence_state(uuid, text, timestamptz, timestamptz, text)
  TO authenticated;

-- The editor-preview overload already verifies an active administrator and
-- confines its target to that administrator's organization; cap caller notes.
CREATE OR REPLACE FUNCTION public.set_editor_presence_state(
  target_editor_id uuid,
  target_status text,
  target_available_from timestamptz DEFAULT NULL,
  target_available_until timestamptz DEFAULT NULL,
  target_note text DEFAULT NULL,
  acting_as_user_id uuid DEFAULT NULL
)
RETURNS public.editor_activity_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  actor public.profiles%ROWTYPE;
  editor_row public.editors%ROWTYPE;
  result_row public.editor_activity_events%ROWTYPE;
  effective_creator uuid;
  changed_at timestamptz := now();
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = actor_id AND active = true;
  IF actor.id IS NULL THEN RAISE EXCEPTION 'Debes iniciar sesión'; END IF;
  IF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role, 'editor'::public.app_role) THEN
    RAISE EXCEPTION 'No tienes permiso para modificar este estado';
  END IF;
  IF target_status IS NULL OR target_status NOT IN ('active', 'available', 'inactive') THEN RAISE EXCEPTION 'Estado no válido'; END IF;
  IF target_available_until IS NOT NULL AND target_available_from IS NOT NULL
     AND target_available_until <= target_available_from THEN
    RAISE EXCEPTION 'La hora final debe ser posterior a la inicial';
  END IF;
  IF target_note IS NOT NULL AND char_length(target_note) > 500 THEN
    RAISE EXCEPTION 'La nota supera el límite permitido';
  END IF;
  SELECT * INTO editor_row FROM public.editors
  WHERE id = target_editor_id AND organization_id = actor.organization_id;
  IF editor_row.id IS NULL THEN RAISE EXCEPTION 'No se encontró el editor'; END IF;

  effective_creator := actor_id;
  IF acting_as_user_id IS NOT NULL THEN
    IF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role)
       OR editor_row.user_id IS DISTINCT FROM acting_as_user_id THEN
      RAISE EXCEPTION 'No puedes actuar en nombre de este editor';
    END IF;
    effective_creator := acting_as_user_id;
  ELSIF actor.role NOT IN ('owner'::public.app_role, 'admin'::public.app_role)
        AND (actor.role <> 'editor'::public.app_role OR editor_row.user_id IS DISTINCT FROM actor_id) THEN
    RAISE EXCEPTION 'No puedes modificar este estado';
  END IF;

  INSERT INTO public.editor_activity_events
    (organization_id, editor_id, status, available_from, available_until,
     created_by, created_at, started_at, ended_at, note, updated_at)
  VALUES
    (editor_row.organization_id, target_editor_id, target_status, target_available_from,
     target_available_until, effective_creator, changed_at, changed_at, changed_at,
     nullif(trim(target_note), ''), changed_at)
  RETURNING * INTO result_row;
  IF acting_as_user_id IS NOT NULL THEN
    INSERT INTO public.audit_log
      (organization_id, actor_id, action, entity_type, entity_id, after_data, source)
    VALUES
      (actor.organization_id, actor_id, 'set_editor_presence_as_editor',
       'editor_activity_event', result_row.id::text,
       jsonb_build_object('acting_as_user_id', acting_as_user_id, 'editor_id', target_editor_id),
       'admin_preview');
  END IF;
  RETURN result_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_editor_presence_state(uuid, text, timestamptz, timestamptz, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_editor_presence_state(uuid, text, timestamptz, timestamptz, text, uuid)
  TO authenticated;

-- This legacy RPC is not called by the current app. It omitted the active flag
-- check and exposed per-editor work-time metrics, so close it to browser roles.
REVOKE ALL ON FUNCTION public.get_editor_team_ranking_v2_metrics(text)
  FROM PUBLIC, anon, authenticated;

-- Bound delivery payload size and prevent script/data URLs from entering the
-- fields later rendered as clickable links.
CREATE OR REPLACE FUNCTION public.submit_delivery_items(
  target_assignment uuid,
  target_job_item uuid,
  delivery_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_org uuid;
  parent record;
  submission_id uuid := gen_random_uuid();
  item_count integer;
BEGIN
  SELECT p.organization_id INTO actor_org
  FROM public.profiles p WHERE p.id = auth.uid() AND p.active = true;
  IF actor_org IS NULL OR NOT private.can_access_assignment(target_assignment) THEN
    RAISE EXCEPTION 'No tienes acceso a esta asignación';
  END IF;
  SELECT a.organization_id, a.job_id INTO parent
  FROM public.job_assignments a
  JOIN public.job_assignment_items ai ON ai.assignment_id = a.id AND ai.job_item_id = target_job_item
  WHERE a.id = target_assignment AND a.organization_id = actor_org
  FOR UPDATE OF ai;
  IF parent.job_id IS NULL THEN RAISE EXCEPTION 'No se encontró el servicio asignado'; END IF;
  IF jsonb_typeof(delivery_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'La entrega necesita una lista de vídeos';
  END IF;
  item_count := jsonb_array_length(delivery_items);
  IF item_count < 1 OR item_count > 500 THEN
    RAISE EXCEPTION 'La entrega debe contener entre 1 y 500 vídeos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(delivery_items) item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR char_length(trim(coalesce(item->>'url', ''))) NOT BETWEEN 9 AND 2048
       OR trim(item->>'url') !~* '^https?://[^[:space:]]+$'
       OR char_length(coalesce(item->>'label', '')) > 120
  ) THEN RAISE EXCEPTION 'Cada vídeo debe incluir un enlace web válido y un título de hasta 120 caracteres'; END IF;

  INSERT INTO public.delivery_submissions
    (id, organization_id, assignment_id, job_id, job_item_id, submitted_by,
     quantity, approved_quantity, folder_url, status)
  VALUES
    (submission_id, actor_org, target_assignment, parent.job_id, target_job_item,
     auth.uid(), item_count, 0, NULL, 'pending_review');
  INSERT INTO public.delivery_submission_items
    (organization_id, submission_id, label, url, status)
  SELECT actor_org, submission_id, coalesce(nullif(trim(item->>'label'), ''), 'Vídeo'),
         trim(item->>'url'), 'pending_review'
  FROM jsonb_array_elements(delivery_items) WITH ORDINALITY AS rows(item, position)
  ORDER BY position;
  RETURN submission_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_delivery_items(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_delivery_items(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_delivery_items(
  target_assignment uuid,
  target_job_item uuid,
  delivery_items jsonb,
  acting_as_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor public.profiles%ROWTYPE;
  actor_org uuid;
  parent record;
  assignment_editor_user_id uuid;
  effective_submitter uuid;
  submission_id uuid := gen_random_uuid();
  item_count integer;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid() AND active = true;
  IF actor.id IS NULL THEN RAISE EXCEPTION 'Sesión sin perfil activo'; END IF;
  actor_org := actor.organization_id;
  effective_submitter := auth.uid();
  SELECT e.user_id INTO assignment_editor_user_id
  FROM public.job_assignments a JOIN public.editors e ON e.id = a.editor_id
  WHERE a.id = target_assignment AND a.organization_id = actor_org;
  IF actor.role IN ('owner'::public.app_role, 'admin'::public.app_role)
     AND acting_as_user_id IS NOT NULL THEN
    IF assignment_editor_user_id IS DISTINCT FROM acting_as_user_id THEN
      RAISE EXCEPTION 'El perfil seleccionado no corresponde al editor asignado';
    END IF;
    effective_submitter := acting_as_user_id;
  ELSIF acting_as_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo Dirección puede actuar en nombre de un editor';
  END IF;
  IF NOT private.can_access_assignment(target_assignment) THEN
    RAISE EXCEPTION 'No tienes acceso a esta asignación';
  END IF;
  SELECT a.organization_id, a.job_id INTO parent
  FROM public.job_assignments a
  JOIN public.job_assignment_items ai ON ai.assignment_id = a.id AND ai.job_item_id = target_job_item
  WHERE a.id = target_assignment AND a.organization_id = actor_org
  FOR UPDATE OF ai;
  IF parent.job_id IS NULL THEN RAISE EXCEPTION 'No se encontró el servicio asignado'; END IF;
  IF jsonb_typeof(delivery_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'La entrega necesita una lista de vídeos';
  END IF;
  item_count := jsonb_array_length(delivery_items);
  IF item_count < 1 OR item_count > 500 THEN
    RAISE EXCEPTION 'La entrega debe contener entre 1 y 500 vídeos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(delivery_items) item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR char_length(trim(coalesce(item->>'url', ''))) NOT BETWEEN 9 AND 2048
       OR trim(item->>'url') !~* '^https?://[^[:space:]]+$'
       OR char_length(coalesce(item->>'label', '')) > 120
  ) THEN RAISE EXCEPTION 'Cada vídeo debe incluir un enlace web válido y un título de hasta 120 caracteres'; END IF;
  INSERT INTO public.delivery_submissions
    (id, organization_id, assignment_id, job_id, job_item_id, submitted_by,
     quantity, approved_quantity, folder_url, status)
  VALUES
    (submission_id, actor_org, target_assignment, parent.job_id, target_job_item,
     effective_submitter, item_count, 0, NULL, 'pending_review');
  INSERT INTO public.delivery_submission_items
    (organization_id, submission_id, label, url, status)
  SELECT actor_org, submission_id, coalesce(nullif(trim(item->>'label'), ''), 'Vídeo'),
         trim(item->>'url'), 'pending_review'
  FROM jsonb_array_elements(delivery_items) WITH ORDINALITY AS rows(item, position)
  ORDER BY position;
  IF acting_as_user_id IS NOT NULL THEN
    INSERT INTO public.audit_log
      (organization_id, actor_id, action, entity_type, entity_id, after_data, source)
    VALUES
      (actor_org, auth.uid(), 'submit_delivery_as_editor', 'delivery_submission',
       submission_id::text,
       jsonb_build_object('acting_as_user_id', acting_as_user_id, 'assignment_id', target_assignment),
       'admin_preview');
  END IF;
  RETURN submission_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_delivery_items(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_delivery_items(uuid, uuid, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_delivery_item_version(target_item uuid, replacement_url text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target public.delivery_submission_items%ROWTYPE;
  parent public.delivery_submissions%ROWTYPE;
  clean_url text := trim(coalesce(replacement_url, ''));
BEGIN
  IF char_length(clean_url) NOT BETWEEN 9 AND 2048 OR clean_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'El enlace debe ser una URL web válida';
  END IF;
  SELECT * INTO target FROM public.delivery_submission_items WHERE id = target_item;
  IF target.id IS NULL THEN RAISE EXCEPTION 'No se encontró el vídeo'; END IF;
  SELECT * INTO parent FROM public.delivery_submissions WHERE id = target.submission_id;
  IF parent.id IS NULL OR NOT private.can_access_assignment(parent.assignment_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este vídeo';
  END IF;
  UPDATE public.delivery_submission_items
  SET url = clean_url, status = 'pending_review', correction_notes = NULL,
      reviewed_at = NULL, updated_at = now()
  WHERE id = target.id;
  UPDATE public.delivery_submissions
  SET status = 'pending_review', review_notes = NULL, reviewed_by = NULL,
      reviewed_at = NULL, updated_at = now()
  WHERE id = parent.id;
  UPDATE public.job_assignments
  SET status = 'in_progress', updated_at = now()
  WHERE id = parent.assignment_id AND status NOT IN ('cancelled', 'completed');
  UPDATE public.jobs SET status = 'pending', delivered_on = NULL, updated_at = now()
  WHERE id = parent.job_id AND status <> 'cancelled';
  RETURN target.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.replace_delivery_item_version(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_delivery_item_version(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_delivery_submission(
  target_submission uuid,
  replacement_folder_url text,
  replacement_notes text,
  replacement_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  original public.delivery_submissions%ROWTYPE;
  clean_folder_url text := trim(coalesce(replacement_folder_url, ''));
  item_count integer;
BEGIN
  SELECT * INTO original FROM public.delivery_submissions
  WHERE id = target_submission FOR UPDATE;
  IF original.id IS NULL THEN RAISE EXCEPTION 'No se encontró la entrega'; END IF;
  IF NOT private.can_access_assignment(original.assignment_id) THEN
    RAISE EXCEPTION 'No tienes acceso a esta entrega';
  END IF;
  IF original.status NOT IN ('pending_review', 'changes_requested') THEN
    RAISE EXCEPTION 'Solo se puede sustituir una entrega pendiente o devuelta';
  END IF;

  IF char_length(coalesce(replacement_notes, '')) > 5000 THEN
    RAISE EXCEPTION 'Las notas superan el límite permitido';
  END IF;
  IF clean_folder_url <> '' AND (char_length(clean_folder_url) NOT BETWEEN 9 AND 2048
     OR clean_folder_url !~* '^https?://[^[:space:]]+$') THEN
    RAISE EXCEPTION 'El enlace de carpeta debe ser una URL web válida';
  END IF;
  IF replacement_items IS NOT NULL AND jsonb_typeof(replacement_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Los vídeos deben enviarse en una lista';
  END IF;
  item_count := coalesce(jsonb_array_length(coalesce(replacement_items, '[]'::jsonb)), 0);
  IF item_count > 500 THEN RAISE EXCEPTION 'No se pueden sustituir más de 500 vídeos a la vez'; END IF;
  IF item_count > 0 AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(replacement_items) item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR char_length(trim(coalesce(item->>'url', ''))) NOT BETWEEN 9 AND 2048
       OR trim(item->>'url') !~* '^https?://[^[:space:]]+$'
       OR char_length(coalesce(item->>'label', '')) > 120
  ) THEN RAISE EXCEPTION 'Cada vídeo debe incluir un enlace web válido y un título de hasta 120 caracteres'; END IF;

  IF coalesce(nullif(clean_folder_url, ''), '') = '' AND item_count <> original.quantity THEN
    RAISE EXCEPTION 'La sustitución debe contener exactamente % enlaces', original.quantity;
  END IF;

  UPDATE public.delivery_submissions
  SET folder_url = nullif(clean_folder_url, ''), notes = nullif(trim(replacement_notes), ''),
      status = 'pending_review', approved_quantity = 0, review_notes = NULL,
      reviewed_by = NULL, reviewed_at = NULL,
      submitted_by = coalesce(auth.uid(), submitted_by), updated_at = now()
  WHERE id = original.id;
  IF item_count = 0 THEN
    DELETE FROM public.delivery_submission_items WHERE submission_id = original.id;
  ELSE
    DELETE FROM public.delivery_submission_items i
    WHERE i.submission_id = original.id AND i.id NOT IN (
      SELECT ranked.id FROM (
        SELECT id, row_number() OVER (ORDER BY created_at, id) rn
        FROM public.delivery_submission_items WHERE submission_id = original.id
      ) ranked WHERE ranked.rn <= item_count
    );
    WITH incoming AS (
      SELECT row_number() OVER () rn,
        coalesce(nullif(trim(item->>'label'), ''), 'Vídeo ' || row_number() OVER ()) label,
        trim(item->>'url') url
      FROM jsonb_array_elements(replacement_items) item
    ), existing AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) rn
      FROM public.delivery_submission_items WHERE submission_id = original.id
    )
    UPDATE public.delivery_submission_items target
    SET label = incoming.label, url = incoming.url, status = 'pending_review',
        correction_notes = NULL, reviewed_at = NULL, updated_at = now()
    FROM existing JOIN incoming USING (rn) WHERE target.id = existing.id;
    WITH incoming AS (
      SELECT row_number() OVER () rn,
        coalesce(nullif(trim(item->>'label'), ''), 'Vídeo ' || row_number() OVER ()) label,
        trim(item->>'url') url
      FROM jsonb_array_elements(replacement_items) item
    ), existing_count AS (
      SELECT count(*)::integer count FROM public.delivery_submission_items WHERE submission_id = original.id
    )
    INSERT INTO public.delivery_submission_items
      (organization_id, submission_id, label, url, status, correction_notes, reviewed_at)
    SELECT original.organization_id, original.id, incoming.label, incoming.url,
           'pending_review', NULL, NULL
    FROM incoming, existing_count WHERE incoming.rn > existing_count.count;
  END IF;
  RETURN original.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.replace_delivery_submission(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_delivery_submission(uuid, text, text, jsonb) TO authenticated;

-- Stop disabled profiles from reading the legacy team metrics RPC.
CREATE OR REPLACE FUNCTION public.get_editor_team_ranking_v2_metrics(target_period_key text DEFAULT NULL)
RETURNS TABLE (
  organization_id uuid, editor_id uuid, editor_name text, period_key text,
  submitted_videos integer, approved_videos integer, late_videos integer,
  on_time_videos integer, correction_count integer, client_amount numeric,
  editor_amount numeric, net_profit numeric, assigned_videos integer,
  completed_videos integer, approved_without_correction_videos integer,
  corrected_approved_videos integer, correction_videos integer,
  first_pass_approval_rate numeric, v2_late_videos integer,
  v2_priority_late_videos integer, v2_corrected_approved_videos integer,
  v2_approved_without_correction_videos integer, v2_correction_count integer,
  productive_minutes numeric, activity_days integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor_role text;
  actor_organization_id uuid;
  actor_editor_id uuid;
BEGIN
  SELECT p.role::text, p.organization_id, p.editor_id
  INTO actor_role, actor_organization_id, actor_editor_id
  FROM public.profiles p WHERE p.id = auth.uid() AND p.active = true;
  IF actor_role IS NULL OR actor_organization_id IS NULL
     OR actor_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT metric.organization_id, metric.editor_id, metric.editor_name, metric.period_key,
    metric.submitted_videos, metric.approved_videos, metric.late_videos,
    metric.on_time_videos, metric.correction_count, 0::numeric, 0::numeric, 0::numeric,
    metric.assigned_videos, metric.completed_videos, metric.approved_without_correction_videos,
    metric.corrected_approved_videos, metric.correction_videos, metric.first_pass_approval_rate,
    metric.v2_late_videos, metric.v2_priority_late_videos,
    metric.v2_corrected_approved_videos, metric.v2_approved_without_correction_videos,
    metric.v2_correction_count, metric.productive_minutes, metric.activity_days
  FROM public.editorial_monthly_ranking_v2_metrics metric
  WHERE metric.organization_id = actor_organization_id
    AND (actor_role IN ('owner', 'admin') OR metric.editor_id = actor_editor_id)
    AND (target_period_key IS NULL OR metric.period_key = target_period_key)
  ORDER BY metric.editor_name;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_editor_team_ranking_v2_metrics(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_editor_team_ranking_v2_metrics(text) TO authenticated;

