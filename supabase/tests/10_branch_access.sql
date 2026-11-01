-- RLS tests for 0061: branch isolation (read + write) and the audit trail.
-- Runs as the real `authenticated` role with a simulated JWT subject.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- fixtures (as the table owner) ----------
insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'gm@test'),
  ('a0000000-0000-0000-0000-000000000002', 'bm.najran@test'),
  ('a0000000-0000-0000-0000-000000000003', 'bm.jazan@test'),
  ('a0000000-0000-0000-0000-000000000004', 'sales.najran@test'),
  ('a0000000-0000-0000-0000-000000000005', 'driver.najran@test'),
  ('a0000000-0000-0000-0000-000000000006', 'housing.najran@test')
on conflict (id) do nothing;

insert into user_profiles (id, full_name, role, branch_id) values
  ('a0000000-0000-0000-0000-000000000001', 'سلمان الغامدي', 'admin', null),
  ('a0000000-0000-0000-0000-000000000002', 'فهد آل منصور', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000003', 'ماجد الحازمي', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('a0000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000005', 'راشد الصيعري', 'driver', 'b0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-000000000006', 'نورة القحطاني', 'housing_supervisor', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;

insert into customers (id, full_name, phone, branch_id, city) values
  ('c0000000-0000-0000-0000-00000000000a', 'محمد آل مرضمة', '0551000001', 'b0000000-0000-0000-0000-00000000000a', 'نجران'),
  ('c0000000-0000-0000-0000-00000000000b', 'علي حكمي',       '0551000002', 'b0000000-0000-0000-0000-00000000000b', 'جازان'),
  ('c0000000-0000-0000-0000-0000000000ff', 'عميل بلا فرع',   '0551000003', null, null);

insert into contracts (id, customer_id, branch_id, service_code, base_amount, status) values
  ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'recruitment', 16000, 'draft'),
  ('d0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'recruitment', 15500, 'draft'),
  ('d0000000-0000-0000-0000-0000000000ff', 'c0000000-0000-0000-0000-0000000000ff', null, 'monthly_rental', 3000, 'draft');

insert into payments (contract_id, amount) values
  ('d0000000-0000-0000-0000-00000000000a', 5000),
  ('d0000000-0000-0000-0000-00000000000b', 4000);

-- a website order for a Jazan customer with no branch → routed by city
insert into service_requests (service_code, customer_name, customer_phone, customer_city)
values ('daily_rental', 'هيا الدوسري', '0551000009', 'جازان');

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

-- ---------- routing ----------
select pg_temp.check(
  (select branch_id from service_requests where customer_phone = '0551000009') = 'b0000000-0000-0000-0000-00000000000b',
  'website order routed to the branch of the customer city');

-- ---------- branch manager (Najran) ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from customers) = 1, 'BM sees only own-branch customers (no other branch, no orphan)');
select pg_temp.check((select count(*) from contracts) = 1, 'BM sees only own-branch contracts');
select pg_temp.check((select count(*) from payments) = 1, 'BM sees only payments of own-branch contracts');
select pg_temp.check((select count(*) from service_requests) = 0, 'BM does not see the Jazan order');

-- cannot touch the other branch: updates silently match nothing
update customers set phone = '0000000000' where id = 'c0000000-0000-0000-0000-00000000000b';
update contracts set base_amount = 1 where id = 'd0000000-0000-0000-0000-00000000000b';
delete from contracts where id = 'd0000000-0000-0000-0000-00000000000b';

-- cannot write into the other branch
do $$ begin
  insert into customers (full_name, branch_id) values ('اختراق', 'b0000000-0000-0000-0000-00000000000b');
  raise exception 'FAIL: BM inserted a customer into another branch';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into payments (contract_id, amount) values ('d0000000-0000-0000-0000-00000000000b', 1);
  raise exception 'FAIL: BM recorded a payment on another branch contract';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update customers set branch_id = 'b0000000-0000-0000-0000-00000000000b'
   where id = 'c0000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: BM moved a customer to another branch';
exception when insufficient_privilege then null;
end $$;

-- own branch works; branch is filled in automatically
insert into customers (full_name, phone) values ('سعيد آل هتيلة', '0551000010');
select pg_temp.check((select branch_id from customers where phone = '0551000010') = 'b0000000-0000-0000-0000-00000000000a',
  'BM insert defaults to own branch');
update customers set city = 'نجران' where id = 'c0000000-0000-0000-0000-00000000000a';

-- audit is not forgeable from a session
do $$ begin
  insert into audit_log (action, table_name) values ('fake', 'contracts');
  raise exception 'FAIL: audit_log accepted a direct insert';
exception when insufficient_privilege then null;
end $$;
-- the BM reads the audit trail of their own branch only
select pg_temp.check((select count(*) from audit_log where branch_id is distinct from 'b0000000-0000-0000-0000-00000000000a') = 0,
  'BM audit view limited to own branch');
select pg_temp.check((select count(*) from audit_log where table_name = 'customers' and action = 'update'
                       and record_id = 'c0000000-0000-0000-0000-00000000000a') = 1,
  'BM sees the audit row of their own change');
select pg_temp.logout();

-- ---------- the other branch manager's data really is untouched ----------
select pg_temp.check((select phone from customers where id = 'c0000000-0000-0000-0000-00000000000b') = '0551000002',
  'other-branch customer unchanged');
select pg_temp.check((select base_amount from contracts where id = 'd0000000-0000-0000-0000-00000000000b') = 15500,
  'other-branch contract unchanged and not deleted');

-- ---------- branch manager (Jazan) sees the routed order ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from service_requests) = 1, 'Jazan BM sees the order routed to Jazan');
select pg_temp.check((select count(*) from customers) = 1, 'Jazan BM sees only Jazan customers');
select pg_temp.logout();

-- ---------- sales (Najran) ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from customers) = 2, 'sales sees the customers of own branch');
select pg_temp.check((select count(*) from audit_log) = 0, 'sales has no audit access');
do $$ begin
  delete from customers where id = 'c0000000-0000-0000-0000-00000000000a';
  if found then raise exception 'FAIL: sales deleted a customer'; end if;
end $$;
select pg_temp.logout();

-- ---------- roles without a customer module ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000006');
select pg_temp.check((select count(*) from customers) = 0, 'housing supervisor cannot read customers');
do $$ begin
  insert into campaigns (name, type) values ('حملة', 'general');
  raise exception 'FAIL: a role without loyalty.manage created a campaign';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

-- ---------- general manager ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from customers) = 4, 'GM sees every branch + unassigned customers');
select pg_temp.check((select count(*) from contracts) = 3, 'GM sees every contract');
select pg_temp.check(has_perm('customers','delete') and has_perm('sales_ops','export') and has_perm('audit','view'),
  'GM holds the new modules');
update contracts set base_amount = 15000 where id = 'd0000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from audit_log where table_name = 'contracts' and action = 'update'
                       and record_id = 'd0000000-0000-0000-0000-00000000000b'
                       and (old_data->>'base_amount')::numeric = 15500 and (new_data->>'base_amount')::numeric = 15000
                       and not (new_data ? 'customer_id')
                       and actor_name = 'سلمان الغامدي'
                       and branch_id = 'b0000000-0000-0000-0000-00000000000b') = 1,
  'contract change audited with the changed field only, actor and branch');
select pg_temp.logout();

-- ---------- audit rows are immutable even for the owner ----------
do $$ begin
  delete from audit_log;
  raise exception 'FAIL: audit_log rows were deleted';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

select 'branch access: all checks passed' as result;
