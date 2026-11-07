-- Tests for 0074 (documents): staff + worker documents, branch scope, soft delete,
-- file-path ownership, renewal versioning, configurable alert window, cost posting.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-000000000001', 'gm7@test'),
  ('a7000000-0000-0000-0000-000000000002', 'hr7@test'),
  ('a7000000-0000-0000-0000-000000000003', 'bmj7@test'),
  ('a7000000-0000-0000-0000-000000000004', 'sales7@test'),
  ('a7000000-0000-0000-0000-000000000006', 'acc7@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a7000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('a7000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a7000000-0000-0000-0000-000000000003', 'فهد العسيري', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('a7000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a7000000-0000-0000-0000-000000000006', 'بدر المالكي', 'accountant', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into employees (id, full_name, branch_id, basic_salary, nationality, hire_date) values
  ('e7000000-0000-0000-0000-00000000000a', 'راجو كومار', 'b0000000-0000-0000-0000-00000000000a', 3500, 'الهند', '2023-03-01'),
  ('e7000000-0000-0000-0000-00000000000b', 'محمد رفيق', 'b0000000-0000-0000-0000-00000000000b', 3200, 'بنغلاديش', '2024-02-01')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f7000000-0000-0000-0000-00000000000a', 'ماري جوي سانتوس', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f7000000-0000-0000-0000-00000000000b', 'سيتي نورهاليزا', 'إندونيسيا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do nothing;

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

-- ---------- owner constraint ----------
select pg_temp.rejects($$ insert into employee_documents (type) values ('iqama') $$,
  'employee_documents_owner_chk', 'a document belongs to exactly one person');
select pg_temp.rejects($$ insert into employee_documents (employee_id, worker_id, type) values
  ('e7000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000a', 'iqama') $$,
  'employee_documents_owner_chk', 'not both an employee and a worker');

-- ---------- HR adds documents for staff and workers ----------
select pg_temp.login('a7000000-0000-0000-0000-000000000002');
insert into employee_documents (id, employee_id, type, doc_number, issue_date, expiry_date, file_path, file_name) values
  ('d7000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-00000000000a', 'iqama', '2412345678',
   current_date - 300, current_date + 20, 'employee/e7000000-0000-0000-0000-00000000000a/iqama.pdf', 'iqama.pdf');
insert into employee_documents (id, worker_id, type, doc_number, issue_date, expiry_date) values
  ('d7000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-00000000000a', 'iqama', '2498765432', current_date - 200, current_date + 45),
  ('d7000000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-00000000000b', 'visa', 'V-55120', current_date - 10, current_date + 80);
select pg_temp.rejects($$ insert into employee_documents (employee_id, type, file_path) values
  ('e7000000-0000-0000-0000-00000000000a', 'passport', 'employee/e7000000-0000-0000-0000-00000000000b/x.pdf') $$,
  'لا يخص صاحب', 'a file path must live under its owner');
select pg_temp.rejects($$ insert into employee_documents (employee_id, type, issue_date, expiry_date) values
  ('e7000000-0000-0000-0000-00000000000a', 'passport', '2026-05-01', '2026-01-01') $$,
  'employee_documents_dates_chk', 'expiry after issue');
select pg_temp.rejects($$ update employee_documents set employee_id = 'e7000000-0000-0000-0000-00000000000b'
  where id = 'd7000000-0000-0000-0000-000000000001' $$, 'شخص آخر', 'documents cannot move to another person');
-- hard delete is not allowed (no policy) → nothing removed
delete from employee_documents where id = 'd7000000-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from employee_documents where id = 'd7000000-0000-0000-0000-000000000002') = 1,
  'delete is blocked — soft delete only');
update employee_documents set is_active = false where id = 'd7000000-0000-0000-0000-000000000003';
select pg_temp.check(not (select is_active from employee_documents where id = 'd7000000-0000-0000-0000-000000000003'),
  'HR deactivates a document');
update employee_documents set is_active = true where id = 'd7000000-0000-0000-0000-000000000003';
select pg_temp.logout();

-- ---------- branch scope ----------
select pg_temp.login('a7000000-0000-0000-0000-000000000003');      -- Jazan BM
select pg_temp.check((select count(*) from employee_documents
  where id in ('d7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002')) = 0,
  'Jazan BM does not see Najran staff/worker documents');
select pg_temp.check((select count(*) from employee_documents where id = 'd7000000-0000-0000-0000-000000000003') = 1,
  'Jazan BM sees a Jazan worker document');
select pg_temp.check(hr_doc_path_visible('worker/f7000000-0000-0000-0000-00000000000b/visa.pdf'), 'storage read in branch');
select pg_temp.check(not hr_doc_path_visible('worker/f7000000-0000-0000-0000-00000000000a/iqama.pdf'), 'storage read blocked across branch');
select pg_temp.check(not hr_doc_path_writable('worker/f7000000-0000-0000-0000-00000000000b/visa.pdf'), 'BM has no hr.manage → no upload');
select pg_temp.rejects($$ insert into employee_documents (worker_id, type) values ('f7000000-0000-0000-0000-00000000000b', 'passport') $$,
  'row-level security', 'BM cannot add documents');
select pg_temp.logout();
select pg_temp.login('a7000000-0000-0000-0000-000000000004');      -- sales
select pg_temp.check((select count(*) from employee_documents where id::text like 'd7000000%') = 0, 'sales sees no documents');
select pg_temp.check(not hr_doc_path_visible('employee/e7000000-0000-0000-0000-00000000000a/iqama.pdf'), 'sales cannot read files');
select pg_temp.logout();
select pg_temp.check((hr_doc_path_owner('employee/../x')).p_employee is null, 'malformed path → no owner');
select pg_temp.check((hr_doc_path_owner('employee/e7000000-0000-0000-0000-00000000000a/')).p_employee is null, 'path needs a file name');

-- ---------- alert window is configurable ----------
select pg_temp.check(hr_doc_status(current_date + 45) = 'expiring', 'default 60 days → 45 days left is expiring');
select pg_temp.login('a7000000-0000-0000-0000-000000000002');
update app_config set value = 30 where key = 'doc_expiry_alert_days';
select pg_temp.check((select value from app_config where key = 'doc_expiry_alert_days') = 30, 'HR edits the alert window');
update app_config set value = 99 where key = 'vat_rate';
select pg_temp.check((select value from app_config where key = 'vat_rate') = 15, 'HR cannot touch non-HR settings');
select pg_temp.rejects($$ update app_config set value = 0 where key = 'doc_expiry_alert_days' $$,
  'app_config_doc_alert_chk', 'alert window 1..365');
select pg_temp.logout();
select pg_temp.check(hr_doc_status(current_date + 45) = 'valid', '30 days → 45 days left is valid');
select pg_temp.check(hr_doc_status(current_date + 20) = 'expiring', '30 days → 20 days left is expiring');
select pg_temp.check(hr_doc_status(current_date - 1) = 'expired', 'past → expired');
update app_config set value = 60 where key = 'doc_expiry_alert_days';

-- ---------- renewal = new version with its cost ----------
select pg_temp.login('a7000000-0000-0000-0000-000000000003');
select pg_temp.rejects($$ select renew_document('d7000000-0000-0000-0000-000000000003', null, current_date, current_date + 365, 0) $$,
  'إدارة الموارد البشرية', 'BM cannot renew');
select pg_temp.logout();
select pg_temp.login('a7000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select renew_document('d7000000-0000-0000-0000-000000000002', null, current_date, current_date + 10, 0) $$,
  'بعد الحالي', 'renewal must extend the expiry');
select pg_temp.rejects($$ select renew_document('d7000000-0000-0000-0000-000000000002', null, current_date, current_date + 400, -5) $$,
  'سالبة', 'no negative cost');
create temp table t_renew as
  select renew_document('d7000000-0000-0000-0000-000000000002', null, current_date, current_date + 410, 650) as id;
select pg_temp.check((select superseded_by from employee_documents where id = 'd7000000-0000-0000-0000-000000000002') = (select id from t_renew),
  'old version points to the new one');
select pg_temp.check((select doc_number = '2498765432' and renewal_cost = 650 and worker_id = 'f7000000-0000-0000-0000-00000000000a'
  from employee_documents where id = (select id from t_renew)), 'new version keeps number/owner and records the cost');
select pg_temp.rejects($$ select renew_document('d7000000-0000-0000-0000-000000000002', null, current_date, current_date + 800, 0) $$,
  'جُدِّدت سابقًا', 'an archived version cannot be renewed twice');
select pg_temp.rejects($$ select post_document_cost((select id from t_renew), current_date, '1112') $$,
  'صلاحية المحاسبة', 'HR cannot post to the ledger');
select pg_temp.logout();

-- ---------- cost → ledger (accountant) ----------
select pg_temp.login('a7000000-0000-0000-0000-000000000006');
select pg_temp.check((select count(*) from pending_document_costs() p where p.id = (select id from t_renew) and p.cost_entry_id is null) = 1,
  'accountant sees the pending renewal cost');
select pg_temp.rejects($$ select post_document_cost((select id from t_renew), current_date, '4100') $$,
  'بنك أو صندوق', 'credit must be a bank/cash account');
select pg_temp.rejects($$ select post_document_cost('d7000000-0000-0000-0000-000000000001', current_date, '1112') $$,
  'لا توجد تكلفة', 'nothing to post without a cost');
create temp table t_entry as select post_document_cost((select id from t_renew), current_date, '1112') as id;
select pg_temp.check(post_document_cost((select id from t_renew), current_date, '1112') = (select id from t_entry), 'idempotent');
select pg_temp.logout();
select pg_temp.check((select sum(debit) from journal_entry_lines where entry_id = (select id from t_entry) and account_id = acc_id('5160')) = 650,
  'DR government fees 650');
select pg_temp.check((select sum(credit) from journal_entry_lines where entry_id = (select id from t_entry) and account_id = acc_id('1112')) = 650,
  'CR bank 650');
select pg_temp.check((select branch_id from journal_entries where id = (select id from t_entry)) = 'b0000000-0000-0000-0000-00000000000a',
  'entry carries the worker branch');
select pg_temp.login('a7000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ update employee_documents set renewal_cost = 10 where id = (select id from t_renew) $$,
  'مُرحَّلة', 'posted cost is frozen');
update employee_documents set notes = 'جُدّدت عبر مكتب العمل' where id = (select id from t_renew);
select pg_temp.check((select notes is not null from employee_documents where id = (select id from t_renew)), 'other fields stay editable');
select pg_temp.logout();

-- ---------- audit ----------
select pg_temp.check((select count(*) from audit_log where table_name = 'employee_documents'
  and record_id = 'd7000000-0000-0000-0000-000000000003') >= 2, 'document changes are audited');

\echo 'OK 99c_documents'
