-- Tests for 0078 (worker file): private details, the closed public leak, bank data
-- permission, validation, auto barcode, link to the operational record, banks list.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ab000000-0000-0000-0000-000000000002', 'hr11@test'),
  ('ab000000-0000-0000-0000-000000000003', 'bmn11@test'),
  ('ab000000-0000-0000-0000-000000000005', 'bmj11@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ab000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('ab000000-0000-0000-0000-000000000003', 'فيصل القحطاني', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('ab000000-0000-0000-0000-000000000005', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;

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
create or replace function pg_temp.rejects(p_sql text, p_like text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL (accepted): %', p_msg;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%' || p_like || '%' then raise exception 'FAIL: % — got «%»', p_msg, sqlerrm; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- the public leak is closed ----------
select pg_temp.check(not exists (select 1 from information_schema.columns
  where table_name = 'worker_profiles' and column_name in ('passport_no','iqama_no')),
  'identity numbers no longer in the public catalog table');
select pg_temp.check((select count(*) from worker_profiles) = (select count(*) from worker_details),
  'every catalog worker has a details row');
select pg_temp.check((select count(*) from worker_details where ops_worker_id is null) = 0,
  'existing workers linked to an operational record');

-- ---------- HR adds a worker: details + barcode + operational record ----------
select pg_temp.login('ab000000-0000-0000-0000-000000000002');
insert into worker_profiles (id, full_name, nationality, profession, monthly_salary, branch_id)
values ('fb000000-0000-0000-0000-00000000000a', 'جوي ماري ديلا كروز', 'الفلبين', 'عاملة منزلية', 1500,
        'b0000000-0000-0000-0000-00000000000a');
select pg_temp.check((select barcode like 'MAS-W-%' from worker_details where worker_id = 'fb000000-0000-0000-0000-00000000000a'),
  'barcode generated');
update worker_details set passport_no = 'P8812345', iqama_no = '2490011223', border_no = '3012345678',
  arrival_date = '2026-09-01', birth_date = '1994-05-10', phone = '0551234567',
  bank_name = 'مصرف الراجحي', iban = 'SA0380000000608010167519', account_holder = 'JOY MARIE DELA CRUZ'
 where worker_id = 'fb000000-0000-0000-0000-00000000000a';
select pg_temp.check((select w.barcode = d.barcode and w.iqama_no = '2490011223' and w.phone = '0551234567'
  and w.branch_id = 'b0000000-0000-0000-0000-00000000000a'
  from worker_details d join workers w on w.id = d.ops_worker_id
  where d.worker_id = 'fb000000-0000-0000-0000-00000000000a'),
  'operational record follows (barcode scannable in housing)');
select pg_temp.rejects($$ update worker_details set iban = 'SA12' where worker_id = 'fb000000-0000-0000-0000-00000000000a' $$,
  'worker_details_iban_chk', 'IBAN format');
select pg_temp.rejects($$ update worker_details set phone = '12345' where worker_id = 'fb000000-0000-0000-0000-00000000000a' $$,
  'worker_details_phone_chk', 'phone format');
select pg_temp.rejects($$ update worker_details set barcode = 'X1' where worker_id = 'fb000000-0000-0000-0000-00000000000a' $$,
  'آليًا', 'barcode is system-managed');
update worker_profiles set status = 'on_service' where id = 'fb000000-0000-0000-0000-00000000000a';
select pg_temp.logout();
select pg_temp.check((select w.status = 'on_service' from worker_details d join workers w on w.id = d.ops_worker_id
  where d.worker_id = 'fb000000-0000-0000-0000-00000000000a'), 'status flows to the operational record');

-- ---------- branch manager: own branch, no bank data ----------
select pg_temp.login('ab000000-0000-0000-0000-000000000003');      -- Najran BM
select pg_temp.check((select phone from worker_details where worker_id = 'fb000000-0000-0000-0000-00000000000a') = '0551234567',
  'BM reads his branch worker file');
update worker_details set phone = '0559999999' where worker_id = 'fb000000-0000-0000-0000-00000000000a';
select pg_temp.check((select phone from worker_details where worker_id = 'fb000000-0000-0000-0000-00000000000a') = '0559999999',
  'BM edits contact data');
select pg_temp.rejects($$ update worker_details set iban = 'SA4420000001234567891234' where worker_id = 'fb000000-0000-0000-0000-00000000000a' $$,
  'البنكية', 'bank data needs hr.manage');
select pg_temp.logout();
select pg_temp.login('ab000000-0000-0000-0000-000000000005');      -- Jazan BM
select pg_temp.check((select count(*) from worker_details where worker_id = 'fb000000-0000-0000-0000-00000000000a') = 0,
  'another branch cannot read her file');
select pg_temp.logout();
-- a visitor (anon) still sees the catalog, never the private file
set role anon;
select pg_temp.check((select count(*) from worker_details) = 0, 'anon reads no private details');
reset role;

-- ---------- banks list ----------
select pg_temp.check((select count(*) from hr_lookups where kind = 'bank') >= 10, 'banks seeded as a managed list');
select pg_temp.check(exists (select 1 from audit_log where table_name = 'worker_details'), 'worker file audited');
\echo 'OK 99g_worker_file'
