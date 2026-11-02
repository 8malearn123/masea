-- Phase 3: customer insights from real operations + unified contact log, branch-scoped.
-- Depends on fixtures of 10/40/50.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_msg; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- the customer created by the quote conversion (40) whose contract completed (50)
create temp table t_cu as select l.customer_id as id from leads l where l.id = 'e0000000-0000-0000-0000-000000000010';
grant select on t_cu to authenticated;
insert into payments (contract_id, amount)
  select c.id, 2000 from contracts c where c.customer_id = (select id from t_cu);

-- ---------- sales rep logs a contact on the customer ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
insert into lead_activities (customer_id, kind, note)
  select id, 'call', 'اتصال للتهنئة بانتهاء العقد وعرض التجديد' from t_cu;
select pg_temp.logout();

-- ---------- Najran branch manager ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from customer_insights where branch_id is distinct from 'b0000000-0000-0000-0000-00000000000a') = 0,
  'insights limited to the branch');
select pg_temp.check((
  select count(*) from customer_insights i, t_cu
   where i.id = t_cu.id and i.purchases = 1 and i.active_contracts = 0 and i.total_paid = 2000
     and i.sales_value > 0 and i.last_purchase_at is not null and i.days_since_purchase = 0
     and i.last_contact_at is not null and i.days_since_contact = 0) = 1,
  'insights computed from the sold contract, payments and the contact log');
-- the website daily-rental customer (signed, running) has a worker now
select pg_temp.check((select active_contracts from customer_insights where phone = '0552000002') = 1,
  'running signed contract = customer with a worker now');
select pg_temp.check((select count(*) from lead_activities where customer_id = (select id from t_cu)) = 1,
  'BM reads the contact log of a branch customer');
-- soft delete
update customers set is_active = false where phone = '0551000010';
select pg_temp.check((select is_active from customer_insights where phone = '0551000010') = false, 'customer disabled, not deleted');
select pg_temp.logout();

-- ---------- other branch / other roles ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from customer_insights where id = (select id from t_cu)) = 0, 'Jazan BM cannot see the Najran customer');
select pg_temp.check((select count(*) from lead_activities where customer_id = (select id from t_cu)) = 0, 'nor its contact log');
do $$ begin
  insert into lead_activities (customer_id, kind, note) select id, 'note', 'محاولة' from t_cu;
  raise exception 'FAIL: Jazan BM logged a contact on a Najran customer';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

select pg_temp.login('a0000000-0000-0000-0000-000000000006');
select pg_temp.check((select count(*) from customer_insights) = 0, 'housing supervisor sees no customer insights');
select pg_temp.logout();

select 'customer crm: all checks passed' as result;
