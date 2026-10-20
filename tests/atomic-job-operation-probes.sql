-- Run after applying save_job_draft_atomic. No external requests, emails or
-- Auth accounts are created; all fixtures and trigger effects are rolled back.
begin;
set local statement_timeout = '20s';
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select id from public.profiles where active and role = 'owner' order by created_at limit 1),
  'role', 'authenticated'
)::text, true);
select set_config('negodigi_test.editor_user', (
  select id::text from public.profiles where active and role = 'editor' and editor_id is not null order by created_at limit 1
), true);
set local role authenticated;
do $test$
declare
  actor public.profiles%rowtype;
  target_editor uuid;
  target_client uuid;
  other_client uuid;
  probe_job_id uuid := gen_random_uuid();
  probe_item_id uuid := gen_random_uuid();
  probe_assignment_id uuid := gen_random_uuid();
  failed_job uuid := gen_random_uuid();
  failed_item uuid := gen_random_uuid();
  failed_assignment uuid := gen_random_uuid();
  history_job uuid := gen_random_uuid();
  history_item uuid := gen_random_uuid();
  history_assignment uuid := gen_random_uuid();
  planned_job uuid := gen_random_uuid();
  planned_item uuid := gen_random_uuid();
  pending_submission uuid;
  reviewed_submission uuid;
  reviewed_item uuid;
  payload jsonb;
  update_payload jsonb;
  result_id uuid;
  rejected boolean;
  observed integer;
  observed_quantity numeric;
  original_title text;
begin
  select * into strict actor from public.profiles where id = auth.uid();
  select e.id into strict target_editor from public.editors e
  where e.user_id = current_setting('negodigi_test.editor_user')::uuid;
  insert into public.clients(organization_id, name, status)
  values(actor.organization_id, 'QA atomic rollback client', 'active') returning id into target_client;
  insert into public.client_rates(organization_id, client_id, service, client_unit_price, editor_unit_cost, active)
  values(actor.organization_id, target_client, 'QA atomic service', 12, 5, true);

  payload := jsonb_build_object(
    'id', probe_job_id, 'mode', 'pending', 'client_id', target_client,
    'assigned_on', current_date, 'due_on', current_date + 1,
    'items', jsonb_build_array(jsonb_build_object('id', probe_item_id, 'is_new', true, 'service', 'QA atomic service', 'quantity', 3)),
    'assignments', jsonb_build_array(jsonb_build_object('id', probe_assignment_id, 'is_new', true, 'editor_id', target_editor, 'quantities', jsonb_build_object(probe_item_id::text, 3)))
  );
  result_id := public.save_job_draft_atomic(payload);
  if result_id <> probe_job_id then raise exception 'Atomic create returned a different ID'; end if;
  select count(*) into observed from public.job_assignment_items ai
  where ai.assignment_id = probe_assignment_id and ai.job_item_id = probe_item_id and ai.assigned_quantity = 3 and ai.editor_unit_cost = 5;
  if observed <> 1 then raise exception 'Atomic create did not persist the complete priced assignment'; end if;
  select j.title into original_title from public.jobs j where j.id = probe_job_id;

  update_payload := jsonb_build_object(
    'id', probe_job_id, 'mode', 'update', 'client_id', target_client,
    'items', jsonb_build_array(jsonb_build_object('id', probe_item_id, 'is_new', false, 'service', 'QA atomic service', 'quantity', 4)),
    'assignments', jsonb_build_array(jsonb_build_object('id', probe_assignment_id, 'is_new', false, 'editor_id', target_editor, 'quantities', jsonb_build_object(probe_item_id::text, 4))),
    'progress', jsonb_build_array(jsonb_build_object('id', probe_item_id, 'delivered', 999))
  );
  rejected := false;
  begin
    perform public.save_job_draft_atomic(update_payload);
  exception when others then
    if position('progreso supera' in sqlerrm) > 0 then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'Invalid progress did not fail after tentative writes'; end if;
  select count(*) into observed from public.jobs j join public.job_items i on i.job_id = j.id
  where j.id = probe_job_id and j.title = original_title and i.id = probe_item_id and i.quantity = 3;
  if observed <> 1 then raise exception 'A late failure left partial job/item changes'; end if;
  select ai.assigned_quantity into observed_quantity from public.job_assignment_items ai
  where ai.assignment_id = probe_assignment_id and ai.job_item_id = probe_item_id;
  if observed_quantity <> 3 then raise exception 'A late failure left a partial assignment change'; end if;

  -- A failed NEW job must also leave no parent or children behind.
  rejected := false;
  begin
    perform public.save_job_draft_atomic(jsonb_build_object(
      'id', failed_job, 'mode', 'pending', 'client_id', target_client,
      'items', jsonb_build_array(jsonb_build_object('id', failed_item, 'is_new', true, 'service', 'QA atomic service', 'quantity', 1)),
      -- The assignment date is cast only after the parent/items are inserted,
      -- exercising a genuine failure after tentative writes in the RPC.
      'assignments', jsonb_build_array(jsonb_build_object('id', failed_assignment, 'is_new', true, 'editor_id', target_editor,
        'due_on', 'not-a-date', 'quantities', jsonb_build_object(failed_item::text, 1)))
    ));
  exception when invalid_datetime_format then rejected := true;
  end;
  if not rejected or exists(select 1 from public.jobs j where j.id = failed_job)
    or exists(select 1 from public.job_items i where i.id = failed_item)
    or exists(select 1 from public.job_assignments a where a.id = failed_assignment) then
    raise exception 'Failed new job left partial rows';
  end if;

  update_payload := jsonb_set(update_payload, '{progress}', jsonb_build_array(jsonb_build_object('id', probe_item_id, 'delivered', 1)));
  perform public.save_job_draft_atomic(update_payload);
  perform public.save_job_draft_atomic(update_payload);
  select sum(d.quantity) into observed_quantity from public.job_deliveries d where d.assignment_id = probe_assignment_id and d.job_item_id = probe_item_id;
  if observed_quantity <> 1 then raise exception 'Retry duplicated manual delivery progress'; end if;

  insert into public.delivery_submissions
    (organization_id, assignment_id, job_id, job_item_id, submitted_by, quantity, approved_quantity, folder_url, status)
  values
    (actor.organization_id, probe_assignment_id, probe_job_id, probe_item_id,
     current_setting('negodigi_test.editor_user')::uuid, 3, 0, 'https://example.invalid/qa-rollback', 'pending_review')
  returning id into pending_submission;
  rejected := false;
  begin
    perform public.save_job_draft_atomic(
      jsonb_set(
        jsonb_set(update_payload, '{items,0,quantity}', '3'::jsonb),
        array['assignments', '0', 'quantities', probe_item_id::text], '3'::jsonb
      )
    );
  exception when others then
    if position('envíos para revisión' in sqlerrm) > 0 then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'Assignment was reduced below delivered plus pending-review quantity'; end if;
  rejected := false;
  begin
    perform public.save_job_draft_atomic(jsonb_set(update_payload, '{progress,0,delivered}', '2'::jsonb));
  exception when others then
    if position('revisión' in sqlerrm) > 0 then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'Manual progress consumed units already submitted for review'; end if;
  -- Submissions are intentionally not DELETE-authorized. Reduce this test's
  -- pending fixture so the following real review still has available capacity.
  update public.delivery_submissions set quantity = 1 where id = pending_submission;

  insert into public.clients(organization_id, name, status)
  values(actor.organization_id, 'QA atomic other client rollback', 'active') returning id into other_client;
  rejected := false;
  begin
    perform public.save_job_draft_atomic(jsonb_set(update_payload, '{client_id}', to_jsonb(other_client)));
  exception when others then
    if position('No puedes cambiar el cliente' in sqlerrm) > 0 then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'A delivered job was reassigned to another accounting client'; end if;

  reviewed_submission := public.submit_delivery_items(
    probe_assignment_id, probe_item_id,
    jsonb_build_array(jsonb_build_object('label', 'QA reviewed item', 'url', 'https://example.invalid/qa-reviewed')),
    current_setting('negodigi_test.editor_user')::uuid
  );
  select i.id into strict reviewed_item from public.delivery_submission_items i where i.submission_id = reviewed_submission;
  perform public.review_delivery_item(reviewed_submission, reviewed_item, 'approved');
  rejected := false;
  begin
    perform public.save_job_draft_atomic(jsonb_set(update_payload, '{progress,0,delivered}', '0'::jsonb));
  exception when others then
    if position('entregas aprobadas' in sqlerrm) > 0 then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'Manual progress removed an approved review delivery'; end if;
  select sum(d.quantity) into observed_quantity from public.job_deliveries d where d.assignment_id = probe_assignment_id and d.job_item_id = probe_item_id;
  if observed_quantity <> 2 then raise exception 'Failed progress reduction partially removed manual/approved deliveries'; end if;

  perform public.save_job_draft_atomic(jsonb_build_object(
    'id', planned_job, 'mode', 'planned', 'client_id', target_client, 'assigned_on', current_date + 5,
    'items', jsonb_build_array(jsonb_build_object('id', planned_item, 'is_new', true, 'service', 'QA atomic service', 'quantity', 2)),
    'assignments', '[]'::jsonb
  ));
  select count(*) into observed from public.jobs j where j.id = planned_job and j.status = 'planned' and j.planned_on = current_date + 5;
  if observed <> 1 then raise exception 'Planned job was not persisted correctly'; end if;

  rejected := false;
  begin
    perform public.save_job_draft_atomic(jsonb_set(update_payload, '{items}', jsonb_build_array(jsonb_build_object(
      'id', planned_item, 'is_new', false, 'service', 'QA foreign item', 'quantity', 4
    ))));
  exception when others then
    if position('no pertenece a este pedido' in sqlerrm) > 0 then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'Cross-job item was accepted'; end if;

  perform public.save_job_draft_atomic(jsonb_build_object(
    'id', history_job, 'mode', 'history', 'client_id', target_client, 'delivered_on', current_date,
    'items', jsonb_build_array(jsonb_build_object('id', history_item, 'is_new', true, 'service', 'QA atomic service', 'quantity', 2)),
    'assignments', jsonb_build_array(jsonb_build_object('id', history_assignment, 'is_new', true, 'editor_id', target_editor, 'quantities', jsonb_build_object(history_item::text, 2)))
  ));
  select count(*), sum(d.quantity) into observed, observed_quantity from public.job_deliveries d
  where d.assignment_id = history_assignment and d.job_item_id = history_item and not d.billable;
  if observed <> 1 or observed_quantity <> 2 then raise exception 'History import did not create non-billable deliveries'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('negodigi_test.editor_user'), 'role', 'authenticated')::text, true);
  rejected := false;
  begin
    perform public.save_job_draft_atomic(update_payload);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Editor was allowed to call administrator job mutation'; end if;
end;
$test$;
select 'PASS atomic jobs: complete create/update, no partial writes after failure, retry-safe progress, planned/history creation, cross-job and editor denials' as result;
rollback;
