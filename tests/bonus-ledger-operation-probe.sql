-- Ledger integration probe using isolated fixtures and the real authenticated
-- owner role. Everything is rolled back; no Auth account is created.
-- A client-generated job UUID mirrors the app, avoiding INSERT RETURNING's
-- SELECT check against the new job before a self-lookup policy sees it.
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='owner' and active order by created_at limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $ledger_test$
declare
 actor public.profiles%rowtype; editor uuid; client uuid; bonus uuid; job uuid:=gen_random_uuid(); item uuid; assignment uuid; delivery uuid; n integer; amount numeric; available numeric;
begin
select * into strict actor from public.profiles where id=auth.uid();
select e.id into strict editor from public.editors e where e.organization_id=actor.organization_id and e.user_id is not null order by e.created_at limit 1;
insert into public.clients(organization_id,name,status) values(actor.organization_id,'QA ledger rollback only','active') returning id into client;
insert into public.client_rates(organization_id,client_id,service,client_unit_price,editor_unit_cost,active) values(actor.organization_id,client,'QA ledger',30,10,true);
insert into public.bonus_accounts(organization_id,client_id,name,initial_amount,declared_pending_amount,status,paid_on) values(actor.organization_id,client,'QA ledger rollback credit',100,0,'active',current_date) returning id into bonus;
insert into public.jobs(id,organization_id,client_id,editor_id,title,status,assigned_on,due_on) values(job,actor.organization_id,client,editor,'QA ledger rollback','pending',current_date,current_date+1);
insert into public.job_items(organization_id,job_id,service,quantity) values(actor.organization_id,job,'QA ledger',10) returning id into item;
insert into public.job_assignments(organization_id,job_id,editor_id,status,assigned_on,due_on) values(actor.organization_id,job,editor,'pending',current_date,current_date+1) returning id into assignment;
insert into public.job_assignment_items(organization_id,assignment_id,job_item_id,assigned_quantity,delivered_quantity,editor_unit_cost) values(actor.organization_id,assignment,item,10,0,10);
insert into public.job_deliveries(organization_id,assignment_id,job_item_id,quantity,delivered_on,client_unit_price,billable) values(actor.organization_id,assignment,item,2,current_date,30,true) returning id into delivery;
select count(*),sum(bm.amount) into n,amount from public.bonus_movements bm where bm.job_id=job and bm.detail @> '{"source":"delivery_auto"}';
if n<>1 or amount<>60 then raise exception 'Initial usage expected 1x60, got %/%',n,amount;end if;
update public.job_deliveries set quantity=2 where id=delivery;
select count(*),sum(bm.amount) into n,amount from public.bonus_movements bm where bm.job_id=job and bm.detail @> '{"source":"delivery_auto"}';
if n<>1 or amount<>60 then raise exception 'Repeated write doubled usage';end if;
update public.job_deliveries set quantity=4 where id=delivery;
select r.amount into amount from public.receivables r where r.bonus_id=bonus and r.source='bonus_excess' and r.status='open';
if amount is distinct from 20 then raise exception 'Overage expected 20 got %',amount;end if;
select available_amount into available from public.bonus_balances where id=bonus;
if available is distinct from 0 then raise exception 'Overage credit expected zero got %',available;end if;
update public.job_deliveries set quantity=1 where id=delivery;
select count(*) into n from public.receivables r where r.bonus_id=bonus and r.source='bonus_excess' and r.status='open';
if n<>0 then raise exception 'Correcting delivery failed to remove overage';end if;
select available_amount into available from public.bonus_balances where id=bonus;
if available is distinct from 70 then raise exception 'Corrected available expected 70 got %',available;end if;
delete from public.job_deliveries where id=delivery;
select count(*) into n from public.bonus_movements bm where bm.job_id=job and bm.detail @> '{"source":"delivery_auto"}';
if n<>0 then raise exception 'Removing delivery left automatic usage';end if;
select available_amount into available from public.bonus_balances where id=bonus;
if available is distinct from 100 then raise exception 'Deleted delivery available expected100 got %',available;end if;
end;$ledger_test$;
select 'PASS ledger: billable delivery consumes once; retries idempotent; excess opens receivable; corrections reconcile; removal restores credit' result;
rollback;
