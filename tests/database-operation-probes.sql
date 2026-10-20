-- Live-schema operation probes. Every change is rolled back.
-- Run as a database administrator in a session that supports transactions.
-- No Auth users are created or changed. Real authorization is exercised with
-- SET LOCAL ROLE authenticated; setting auth.uid alone would bypass RLS.
-- Requires an active owner, two active linked editors, one bonus and one delivery.

begin;
set local statement_timeout = '12s';
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select id from public.profiles where role = 'editor' and active and editor_id is not null order by created_at limit 1),
  'role', 'authenticated'
)::text, true);
select set_config('negodigi_test.other_editor', (
  select editor_id::text from public.profiles where role = 'editor' and active and editor_id is not null order by created_at offset 1 limit 1
), true);
set local role authenticated;
do $editor_test$
declare
  actor public.profiles%rowtype;
  task_id uuid;
  event_row public.editor_activity_events%rowtype;
  observed integer;
  denied boolean := false;
begin
  select * into strict actor from public.profiles where id = auth.uid();
  if coalesce(current_setting('negodigi_test.other_editor', true), '') = '' then
    raise exception 'Probe requires a second active editor';
  end if;
  select count(*) into observed from public.editors;
  if observed <> 1 then raise exception 'Expected one visible editor, found %', observed; end if;

  event_row := public.set_editor_presence_state(actor.editor_id, 'active', null, null, 'QA rollback only', null);
  select count(*) into observed from public.editor_activity_events
    where id = event_row.id and editor_id = actor.editor_id and status = 'active';
  if observed <> 1 then raise exception 'Editor presence write/read failed'; end if;

  insert into public.editor_planning_blocks
    (organization_id, editor_id, title, starts_at, ends_at, note, status, checklist, created_by, updated_at)
  values
    (actor.organization_id, actor.editor_id, 'QA rollback checklist', now(), now() + interval '1 hour',
     'QA rollback only', 'pending', '[{"id":"qa","text":"Verification","done":false}]', auth.uid(), now())
  returning id into task_id;

  update public.editor_planning_blocks
  set status = 'completed', checklist = '[{"id":"qa","text":"Verification","done":true}]', completed_at = now()
  where id = task_id;
  get diagnostics observed = row_count;
  if observed <> 1 then raise exception 'Checklist update affected % rows', observed; end if;
  select count(*) into observed from public.editor_planning_blocks
    where id = task_id and status = 'completed' and completed_at is not null and checklist -> 0 ->> 'done' = 'true';
  if observed <> 1 then raise exception 'Checklist reread failed'; end if;

  begin
    insert into public.editor_planning_blocks
      (organization_id, editor_id, title, starts_at, ends_at, status, created_by)
    values
      (actor.organization_id, current_setting('negodigi_test.other_editor')::uuid,
       'QA cross-editor denied', now(), now() + interval '1 hour', 'pending', auth.uid());
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Cross-editor checklist write was allowed'; end if;

  denied := false;
  begin
    perform public.set_editor_presence_state(current_setting('negodigi_test.other_editor')::uuid, 'inactive', null, null, 'QA denied', null);
  exception when others then
    if position('No puedes modificar este estado' in sqlerrm) > 0 then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'Cross-editor presence write was allowed'; end if;

  delete from public.editor_planning_blocks where id = task_id;
  get diagnostics observed = row_count;
  if observed <> 1 then raise exception 'Checklist delete failed'; end if;
end;
$editor_test$;
select 'PASS: editor presence; checklist create/update/read/delete; cross-editor writes denied' as result;
rollback;

begin;
set local statement_timeout = '15s';
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select id from public.profiles where role = 'owner' and active order by created_at limit 1),
  'role', 'authenticated'
)::text, true);
set local role authenticated;
do $admin_test$
declare
  actor public.profiles%rowtype;
  bonus_row public.bonus_accounts%rowtype;
  delivery_row public.job_deliveries%rowtype;
  task_id uuid;
  editor_id uuid;
  editor_user_id uuid;
  observed integer;
begin
  select * into strict actor from public.profiles where id = auth.uid();
  select * into strict bonus_row from public.bonus_accounts where organization_id = actor.organization_id order by created_at limit 1;
  update public.bonus_accounts
  set name = bonus_row.name || ' QA rollback', initial_amount = bonus_row.initial_amount + 1,
      declared_pending_amount = bonus_row.declared_pending_amount, paid_on = bonus_row.paid_on
  where id = bonus_row.id;
  get diagnostics observed = row_count;
  if observed <> 1 then raise exception 'Admin bonus update failed'; end if;
  select count(*) into observed from public.bonus_accounts
    where id = bonus_row.id and name = bonus_row.name || ' QA rollback' and initial_amount = bonus_row.initial_amount + 1;
  if observed <> 1 then raise exception 'Admin bonus reread failed'; end if;

  select * into strict delivery_row from public.job_deliveries where organization_id = actor.organization_id order by created_at desc limit 1;
  -- Same values deliberately: exercise UPDATE authorization and every accounting
  -- trigger without selecting a new commercial quantity or historical date.
  update public.job_deliveries set quantity = delivery_row.quantity, delivered_on = delivery_row.delivered_on where id = delivery_row.id;
  get diagnostics observed = row_count;
  if observed <> 1 then raise exception 'Admin historical delivery update failed'; end if;

  select e.id, e.user_id into strict editor_id, editor_user_id
  from public.editors e where e.organization_id = actor.organization_id and e.user_id is not null order by e.created_at limit 1;
  perform public.set_editor_presence_state(editor_id, 'available', null, null, 'QA admin preview rollback', editor_user_id);
  insert into public.editor_planning_blocks
    (organization_id, editor_id, title, starts_at, ends_at, status, created_by)
  values
    (actor.organization_id, editor_id, 'QA admin preview task rollback', now(), now() + interval '1 hour', 'pending', auth.uid())
  returning id into task_id;
  update public.editor_planning_blocks set status = 'completed', completed_at = now() where id = task_id;
  get diagnostics observed = row_count;
  if observed <> 1 then raise exception 'Admin preview checklist update failed'; end if;
end;
$admin_test$;
select 'PASS: admin bonus update/read; historical delivery update; editor preview presence/checklist' as result;
rollback;
