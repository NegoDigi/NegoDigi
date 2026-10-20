-- Production end-to-end verification against the real schema.
-- Every fixture and state transition is enclosed in one transaction and rolled
-- back. A successful final SELECT means every assertion in the DO block passed.

begin;

do $production_test$
declare
  owner_user uuid;
  editor_user uuid := gen_random_uuid();
  organization uuid;
  auth_instance uuid;
  test_client uuid := gen_random_uuid();
  test_editor uuid := gen_random_uuid();
  test_job uuid := gen_random_uuid();
  test_job_item uuid := gen_random_uuid();
  test_assignment uuid := gen_random_uuid();
  first_submission uuid;
  correction_submission uuid;
  correction_item uuid;
  sibling_item uuid;
  test_correction_id uuid;
  payload jsonb;
  observed integer;
  pending_units numeric;
  capacity_blocked boolean := false;
  editor_review_blocked boolean := false;
  august_snapshot_before jsonb;
  august_snapshot_after jsonb;
  item_row record;
begin
  select p.id, p.organization_id, u.instance_id
    into owner_user, organization, auth_instance
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.active and p.role = 'owner'::public.app_role
  order by p.created_at
  limit 1;

  if owner_user is null or organization is null then
    raise exception 'TEST: no hay un propietario activo para ejecutar la prueba';
  end if;

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (auth_instance, editor_user, 'authenticated', 'authenticated',
     format('production-e2e-%s@example.invalid', editor_user), '', now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now());

  insert into public.editors
    (id, organization_id, user_id, name, role_label, status, base_cost)
  values
    (test_editor, organization, editor_user, 'Editor prueba transaccional',
     'Editor', 'active', 40);

  insert into public.profiles
    (id, organization_id, role, display_name, editor_id, active)
  values
    (editor_user, organization, 'editor'::public.app_role,
     'Editor prueba transaccional', test_editor, true);

  insert into public.clients (id, organization_id, name, status)
  values (test_client, organization, 'Cliente prueba transaccional', 'active');

  insert into public.client_rates
    (organization_id, client_id, service, client_unit_price, editor_unit_cost, active)
  values (organization, test_client, 'Vídeo largo', 100, 40, true);

  insert into public.jobs
    (id, organization_id, client_id, editor_id, title, status, assigned_on, due_on)
  values
    (test_job, organization, test_client, test_editor,
     'Pedido transaccional 30 vídeos', 'pending'::public.job_status,
     (now() at time zone 'Europe/Madrid')::date,
     (now() at time zone 'Europe/Madrid')::date + 1);

  insert into public.job_items (id, organization_id, job_id, service, quantity)
  values (test_job_item, organization, test_job, 'Vídeo largo', 30);

  insert into public.job_assignments
    (id, organization_id, job_id, editor_id, assigned_on, due_on, status)
  values
    (test_assignment, organization, test_job, test_editor,
     (now() at time zone 'Europe/Madrid')::date,
     (now() at time zone 'Europe/Madrid')::date + 1, 'pending');

  insert into public.job_assignment_items
    (organization_id, assignment_id, job_item_id, assigned_quantity,
     delivered_quantity, editor_unit_cost)
  values (organization, test_assignment, test_job_item, 30, 0, 40);

  perform set_config('request.jwt.claim.sub', editor_user::text, true);
  select jsonb_agg(
    jsonb_build_object(
      'label', format('Vídeo %s', number),
      'url', format('https://drive.google.com/file/d/negodigi-e2e-%s/view', number)
    ) order by number
  ) into payload
  from generate_series(1, 10) as series(number);

  first_submission := public.submit_delivery_items(test_assignment, test_job_item, payload);

  select count(*) into observed
  from public.delivery_submission_items
  where submission_id = first_submission and status = 'pending_review';
  if observed <> 10 then
    raise exception 'TEST 1: se esperaban 10 vídeos pendientes de revisar, hay %', observed;
  end if;

  select count(*) into observed
  from public.delivery_submission_items
  where submission_id = first_submission and video_number between 1 and 10;
  if observed <> 10 then
    raise exception 'TEST 1: la numeración individual 1..10 no es estable';
  end if;

  select assigned_quantity - delivered_quantity - coalesce((
    select sum(greatest(0, s.quantity - s.approved_quantity))
    from public.delivery_submissions s
    where s.assignment_id = test_assignment
      and s.job_item_id = test_job_item
      and s.status in ('pending_review', 'changes_requested')
  ), 0)
  into pending_units
  from public.job_assignment_items
  where assignment_id = test_assignment and job_item_id = test_job_item;
  if pending_units <> 20 then
    raise exception 'TEST 1: después de entregar 10/30 deben quedar 20 disponibles, quedan %', pending_units;
  end if;

  begin
    select jsonb_agg(jsonb_build_object(
      'label', format('Exceso %s', number),
      'url', format('https://drive.google.com/file/d/negodigi-overflow-%s/view', number)
    )) into payload
    from generate_series(1, 21) as series(number);
    perform public.submit_delivery_items(test_assignment, test_job_item, payload);
  exception when others then
    if position('supera las unidades pendientes' in sqlerrm) > 0 then
      capacity_blocked := true;
    else
      raise;
    end if;
  end;
  if not capacity_blocked then
    raise exception 'TEST 1: se aceptó una entrega superior a la capacidad disponible';
  end if;

  begin
    select id into correction_item
    from public.delivery_submission_items
    where submission_id = first_submission
    order by video_number
    limit 1;
    perform public.review_delivery_item(first_submission, correction_item, 'approved');
  exception when others then
    if position('Solo administración' in sqlerrm) > 0 then
      editor_review_blocked := true;
    else
      raise;
    end if;
  end;
  if not editor_review_blocked then
    raise exception 'TEST 16: un editor pudo aprobar un vídeo';
  end if;

  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  for item_row in
    select id
    from public.delivery_submission_items
    where submission_id = first_submission
    order by video_number
  loop
    perform public.review_delivery_item(first_submission, item_row.id, 'approved');
  end loop;

  select delivered_quantity into pending_units
  from public.job_assignment_items
  where assignment_id = test_assignment and job_item_id = test_job_item;
  if pending_units <> 10 then
    raise exception 'TEST 3: el progreso esperado era 10/30 y es %/30', pending_units;
  end if;

  select count(*) into observed
  from public.production_video_history
  where job_id = test_job;
  if observed <> 10 then
    raise exception 'TEST 4: Historial debía contener 10 vídeos y contiene %', observed;
  end if;

  select 30 - delivered_quantity into pending_units
  from public.job_assignment_items
  where assignment_id = test_assignment and job_item_id = test_job_item;
  if pending_units <> 20 then
    raise exception 'TEST 5: después de aprobar 10/30 deben quedar 20, quedan %', pending_units;
  end if;

  select count(*) into observed from public.jobs where id = test_job and status = 'pending';
  if observed <> 1 then
    raise exception 'TEST 5: el pedido completo terminó antes de aprobar 30/30';
  end if;

  select count(*) into observed
  from public.production_video_history
  where job_id = test_job
    and client_total = 100 and editor_total = 40 and net_profit = 60;
  if observed <> 10 then
    raise exception 'TEST 3: los pagos o beneficios de las 10 aprobaciones no quedaron congelados';
  end if;

  perform public.ensure_due_job_notifications();
  select count(*) into observed
  from public.notifications
  where organization_id = organization
    and action_url like format('%%job=%s%%type=upcoming', test_job);
  if observed < 2 then
    raise exception 'TEST 15: faltan notificaciones de trabajo próximo a vencer';
  end if;

  update public.job_assignments
  set due_on = (now() at time zone 'Europe/Madrid')::date - 1
  where id = test_assignment;
  update public.jobs
  set due_on = (now() at time zone 'Europe/Madrid')::date - 1
  where id = test_job;
  perform public.ensure_due_job_notifications();
  select count(*) into observed
  from public.notifications
  where organization_id = organization
    and action_url like format('%%job=%s%%type=overdue', test_job);
  if observed < 2 then
    raise exception 'TEST 15: faltan notificaciones de vídeo retrasado';
  end if;

  perform set_config('request.jwt.claim.sub', editor_user::text, true);
  payload := jsonb_build_array(
    jsonb_build_object('label', 'Vídeo 11', 'url', 'https://drive.google.com/file/d/negodigi-e2e-11/view'),
    jsonb_build_object('label', 'Vídeo 12', 'url', 'https://drive.google.com/file/d/negodigi-e2e-12/view')
  );
  correction_submission := public.submit_delivery_items(test_assignment, test_job_item, payload);

  select id into correction_item
  from public.delivery_submission_items
  where submission_id = correction_submission and video_number = 11;
  select id into sibling_item
  from public.delivery_submission_items
  where submission_id = correction_submission and video_number = 12;
  if correction_item is null or sibling_item is null then
    raise exception 'TEST 6: la segunda entrega no conservó los números 11 y 12';
  end if;

  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  perform public.review_delivery_item(correction_submission, correction_item, 'changes_requested');
  insert into public.delivery_corrections
    (id, organization_id, submission_item_id, created_by, body, status)
  values
    (gen_random_uuid(), organization, correction_item, owner_user,
     'Ajustar el cierre del vídeo', 'pending')
  returning id into test_correction_id;

  select count(*) into observed
  from public.delivery_submission_items
  where id = correction_item and status = 'changes_requested';
  if observed <> 1 then
    raise exception 'TEST 6: el vídeo seleccionado no quedó pendiente de corregir';
  end if;

  perform set_config('request.jwt.claim.sub', editor_user::text, true);
  update public.delivery_corrections
  set editor_response = 'Cierre corregido y nueva versión preparada',
      status = 'responded', responded_at = now()
  where id = test_correction_id;
  insert into public.delivery_review_comments
    (organization_id, submission_item_id, author_id, body, correction_id)
  values
    (organization, correction_item, editor_user,
     'Respuesta del editor verificada', test_correction_id);

  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  insert into public.delivery_review_comments
    (organization_id, submission_item_id, author_id, body, correction_id)
  values
    (organization, correction_item, owner_user,
     'Respuesta del administrador verificada', test_correction_id);

  select count(*) into observed
  from public.delivery_review_comments c
  where c.correction_id = test_correction_id;
  if observed <> 2 then
    raise exception 'TEST 7-8: no se conservaron ambas respuestas';
  end if;

  perform set_config('request.jwt.claim.sub', editor_user::text, true);
  perform public.replace_delivery_item_version(
    correction_item,
    'https://drive.google.com/file/d/negodigi-e2e-11-v2/view'
  );
  select count(*) into observed
  from public.delivery_item_versions
  where submission_item_id = correction_item;
  if observed <> 2 then
    raise exception 'TEST 9: la nueva versión no generó el historial v1/v2';
  end if;
  select count(*) into observed
  from public.delivery_submission_items
  where id = correction_item and status = 'pending_review';
  if observed <> 1 then
    raise exception 'TEST 9: la nueva versión no quedó pendiente de revisar';
  end if;

  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  perform public.review_delivery_item(correction_submission, correction_item, 'approved');

  select count(*) into observed
  from public.delivery_submission_items
  where id = sibling_item and status = 'pending_review';
  if observed <> 1 then
    raise exception 'TEST 10: aprobar el vídeo corregido modificó también el vídeo hermano';
  end if;
  select count(*) into observed
  from public.production_video_history
  where job_id = test_job;
  if observed <> 11 then
    raise exception 'TEST 11: el Historial debía contener 11 vídeos tras la aprobación individual, contiene %', observed;
  end if;
  select count(*) into observed
  from public.delivery_corrections
  where id = test_correction_id and status = 'closed';
  if observed <> 1 then
    raise exception 'TEST 10: la corrección aprobada no se cerró';
  end if;

  select count(*) into observed
  from public.notifications
  where organization_id = organization
    and action_url like format('%%job=%s%%event=version-2', test_job);
  if observed < 1 then
    raise exception 'TEST 15: el administrador no recibió la notificación de nueva versión';
  end if;
  select count(*) into observed
  from public.notifications
  where organization_id = organization
    and action_url like format('%%job=%s%%event=%%approved%%', test_job);
  if observed < 11 then
    raise exception 'TEST 15: faltan notificaciones de aprobación individual';
  end if;
  select count(*) into observed
  from public.notifications
  where organization_id = organization
    and action_url like format('%%job=%s%%event=%%changes_requested%%', test_job);
  if observed < 1 then
    raise exception 'TEST 15: falta la notificación de correcciones solicitadas';
  end if;

  perform private.roll_production_periods('2026-09-01 00:07:00+00'::timestamptz);
  select count(*) into observed
  from public.production_periods
  where organization_id = organization and period_start = date '2026-08-01' and status = 'closed';
  if observed <> 1 then
    raise exception 'TEST 17: agosto de 2026 no quedó como periodo cerrado';
  end if;
  select count(*) into observed
  from public.production_periods
  where organization_id = organization and period_start = date '2026-09-01' and status = 'active';
  if observed <> 1 then
    raise exception 'TEST 17: septiembre de 2026 no quedó como único periodo activo';
  end if;
  select s.metrics into august_snapshot_before
  from public.production_period_snapshots s
  join public.production_periods p on p.id = s.period_id
  where p.organization_id = organization and p.period_start = date '2026-08-01';
  if august_snapshot_before is null then
    raise exception 'TEST 17: no se creó la instantánea de agosto';
  end if;

  perform private.roll_production_periods('2026-09-01 00:07:00+00'::timestamptz);
  select s.metrics into august_snapshot_after
  from public.production_period_snapshots s
  join public.production_periods p on p.id = s.period_id
  where p.organization_id = organization and p.period_start = date '2026-08-01';
  if august_snapshot_after is distinct from august_snapshot_before then
    raise exception 'TEST 17: ejecutar el cierre dos veces reescribió la instantánea';
  end if;
  select count(*) into observed
  from public.production_periods
  where organization_id = organization and period_start = date '2026-09-01';
  if observed <> 1 then
    raise exception 'TEST 17: ejecutar el cierre dos veces duplicó septiembre';
  end if;

  select count(*) into observed
  from pg_policies
  where schemaname = 'public'
    and tablename in ('delivery_submissions', 'delivery_submission_items',
                      'delivery_corrections', 'delivery_review_comments')
    and roles @> array['authenticated']::name[];
  if observed < 4 then
    raise exception 'TEST 16: faltan políticas autenticadas en el flujo de Producción';
  end if;
end;
$production_test$;

rollback;

select jsonb_build_object(
  'status', 'passed',
  'fixture_persisted', false,
  'jobs_after_rollback', (select count(*) from public.jobs),
  'deliveries_after_rollback', (select count(*) from public.job_deliveries),
  'submission_items_after_rollback', (select count(*) from public.delivery_submission_items),
  'notifications_after_rollback', (select count(*) from public.notifications)
) as production_e2e_result;
