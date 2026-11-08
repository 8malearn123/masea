-- Tests for 0075 (HR reference lists): seeds, permissions, soft delete, system
-- items, the locked Saudi name, rename cascading into records, usage counts.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a8000000-0000-0000-0000-000000000002', 'hr8@test'),
  ('a8000000-0000-0000-0000-000000000003', 'bm8@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a8000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a8000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into employees (id, full_name, branch_id, basic_salary, nationality, hire_date, job_title) values
  ('e8000000-0000-0000-0000-00000000000a', 'تركي القحطاني', 'b0000000-0000-0000-0000-00000000000a', 6000, 'السعودية', '2024-01-01', 'مندوب استقدام')
on conflict (id) do nothing;
insert into employee_details (employee_id, department) values ('e8000000-0000-0000-0000-00000000000a', 'العمليات')
on conflict (employee_id) do update set department = excluded.department;
insert into worker_profiles (id, full_name, nationality, profession, skills, languages, branch_id) values
  ('f8000000-0000-0000-0000-00000000000a', 'ديوي أنغرايني', 'إندونيسيا', 'طباخة', '{تجيد الطبخ,التنظيف}', '{الإندونيسية,العربية}',
   'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;
insert into pricing_rules (service_code, nationality, profession, duration_unit, base_price)
select code, 'إندونيسيا', 'طباخة', 'month', 2900 from services limit 1;

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

-- ---------- seeds ----------
select pg_temp.check((select count(*) from hr_lookups where kind = 'department') >= 7, 'departments seeded');
select pg_temp.check(exists (select 1 from hr_lookups where kind = 'doc_type' and code = 'iqama' and is_system), 'iqama is a system doc type');
select pg_temp.check((select scope from hr_lookups where kind = 'nationality' and code = 'SA') = 'staff', 'Saudi = staff only');
select pg_temp.check((select scope from hr_lookups where kind = 'nationality' and name_ar = 'كينيا') = 'worker', 'Kenya = labour source');

-- ---------- permissions ----------
select pg_temp.login('a8000000-0000-0000-0000-000000000003');            -- BM: read only
select pg_temp.check((select count(*) from hr_lookups) > 30, 'everyone reads the lists');
select pg_temp.rejects($$ insert into hr_lookups (kind, name_ar) values ('department', 'التسويق') $$,
  'row-level security', 'BM cannot add');
update hr_lookups set name_ar = 'X' where kind = 'department' and code = 'ops';
select pg_temp.check((select name_ar from hr_lookups where kind = 'department' and code = 'ops') = 'العمليات', 'BM cannot rename');
select pg_temp.logout();

select pg_temp.login('a8000000-0000-0000-0000-000000000002');            -- HR manages
insert into hr_lookups (kind, name_ar, sort_order) values ('department', '  التسويق ', 8);
select pg_temp.check(exists (select 1 from hr_lookups where kind = 'department' and name_ar = 'التسويق' and length(code) = 10),
  'HR adds; name trimmed; code generated');
select pg_temp.rejects($$ insert into hr_lookups (kind, name_ar) values ('department', 'التسويق') $$,
  'hr_lookups_name_uq', 'no duplicate names in a list');
select pg_temp.rejects($$ insert into hr_lookups (kind, name_ar) values ('religion', 'x') $$,
  'hr_lookups_kind_check', 'unknown list kind');
select pg_temp.rejects($$ insert into hr_lookups (kind, name_ar, is_system) values ('skill', 'الخياطة', true) $$,
  'نظامية', 'system items cannot be added from the UI');
delete from hr_lookups where kind = 'department' and name_ar = 'التسويق';
select pg_temp.check(exists (select 1 from hr_lookups where kind = 'department' and name_ar = 'التسويق'), 'no hard delete');
update hr_lookups set is_active = false where kind = 'department' and name_ar = 'التسويق';
select pg_temp.check(not (select is_active from hr_lookups where kind = 'department' and name_ar = 'التسويق'), 'soft delete');

-- ---------- system items & the Saudi name ----------
select pg_temp.rejects($$ update hr_lookups set is_active = false where kind = 'doc_type' and code = 'iqama' $$,
  'لا يُعطَّل', 'system doc type cannot be disabled');
update hr_lookups set name_ar = 'الإقامة (هوية مقيم)' where kind = 'doc_type' and code = 'iqama';
select pg_temp.check((select name_ar from hr_lookups where kind = 'doc_type' and code = 'iqama') = 'الإقامة (هوية مقيم)',
  'system items can still be renamed');
select pg_temp.rejects($$ update hr_lookups set name_ar = 'سعودي' where kind = 'nationality' and code = 'SA' $$,
  'ثابت', 'the Saudi nationality name is locked');
select pg_temp.rejects($$ update hr_lookups set is_system = false where kind = 'nationality' and code = 'SA' $$,
  'لا تُعدَّل', 'system flag is not editable');
select pg_temp.rejects($$ update hr_lookups set code = 'zz' where kind = 'department' and code = 'ops' $$,
  'رمزه', 'codes are stable');

-- ---------- rename cascades into records ----------
update hr_lookups set name_ar = 'التشغيل والعمليات' where kind = 'department' and code = 'ops';
update hr_lookups set name_ar = 'مندوب استقدام أول' where kind = 'job_title' and name_ar = 'مندوب استقدام';
update hr_lookups set name_ar = 'جمهورية إندونيسيا' where kind = 'nationality' and code = 'ID';
update hr_lookups set name_ar = 'طاهية منزلية' where kind = 'profession' and code = 'cook';
update hr_lookups set name_ar = 'الطبخ السعودي' where kind = 'skill' and code = 'cooking';
update hr_lookups set name_ar = 'اللغة العربية' where kind = 'language' and code = 'ar';
select pg_temp.logout();
select pg_temp.check((select department from employee_details where employee_id = 'e8000000-0000-0000-0000-00000000000a') = 'التشغيل والعمليات', 'department renamed in the file');
select pg_temp.check((select job_title from employees where id = 'e8000000-0000-0000-0000-00000000000a') = 'مندوب استقدام أول', 'job title renamed');
select pg_temp.check((select nationality = 'جمهورية إندونيسيا' and profession = 'طاهية منزلية'
  and skills = '{الطبخ السعودي,التنظيف}' and languages = '{الإندونيسية,اللغة العربية}'
  from worker_profiles where id = 'f8000000-0000-0000-0000-00000000000a'), 'worker profile follows the lists');
select pg_temp.check(exists (select 1 from pricing_rules where nationality = 'جمهورية إندونيسيا' and profession = 'طاهية منزلية'),
  'pricing rules follow too');

-- ---------- usage ----------
select pg_temp.login('a8000000-0000-0000-0000-000000000002');
select pg_temp.check((select uses from hr_lookup_usage('profession') where name_ar = 'طاهية منزلية') >= 1, 'usage counts records');
select pg_temp.logout();
select pg_temp.check(exists (select 1 from audit_log where table_name = 'hr_lookups'), 'list changes are audited');

\echo 'OK 99d_hr_lookups'
