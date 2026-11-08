-- RLS/logic tests for 0069 (employee file): numbering, Saudi validity rules,
-- branch manager vs HR on financial fields, terminate / reactivate.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000002', 'hr2@test'),
  ('a2000000-0000-0000-0000-000000000003', 'bm2.najran@test'),
  ('a2000000-0000-0000-0000-000000000009', 'staff.account@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a2000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a2000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a2000000-0000-0000-0000-000000000009', 'تركي العجمي', 'sales', 'b0000000-0000-0000-0000-00000000000a')
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
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- HR hires: number generated, rules enforced ----------
select pg_temp.login('a2000000-0000-0000-0000-000000000002');
insert into employees (id, full_name, role, job_title, branch_id, basic_salary, nationality, national_id, hire_date, user_id)
values ('e2000000-0000-0000-0000-00000000000a', 'تركي العجمي', 'sales', 'مندوب مبيعات',
        'b0000000-0000-0000-0000-00000000000a', 7500, 'السعودية', '1098765432', '2025-01-05',
        'a2000000-0000-0000-0000-000000000009');
insert into employee_details (employee_id, department, iban, bank_name, housing_allowance)
values ('e2000000-0000-0000-0000-00000000000a', 'المبيعات', 'SA4420000001234567891299', 'الراجحي', 1875);
select pg_temp.check((select employee_no from employees where id = 'e2000000-0000-0000-0000-00000000000a') ~ '^EMP-[0-9]{4,}$',
  'employee number generated automatically');
do $$ begin
  insert into employees (full_name, branch_id, national_id) values ('هوية خاطئة', 'b0000000-0000-0000-0000-00000000000a', '3123');
  raise exception 'FAIL: invalid national id accepted';
exception when check_violation then null;
end $$;
do $$ begin
  update employee_details set iban = 'SA12' where employee_id = 'e2000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: invalid IBAN accepted';
exception when check_violation then null;
end $$;
do $$ begin
  insert into employees (full_name, branch_id, user_id)
  values ('حساب مكرر', 'b0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000009');
  raise exception 'FAIL: one login account linked to two employees';
exception when unique_violation then null;
end $$;
select pg_temp.logout();

-- ---------- branch manager: non-financial yes, money/status no ----------
select pg_temp.login('a2000000-0000-0000-0000-000000000003');
update employee_details set department = 'المبيعات الميدانية', marital_status = 'متزوج'
 where employee_id = 'e2000000-0000-0000-0000-00000000000a';
do $$ begin
  update employee_details set iban = 'SA0000000000000000000000' where employee_id = 'e2000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: BM changed an IBAN';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update employee_details set employment_status = 'terminated' where employee_id = 'e2000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: BM terminated through the details row';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform terminate_employee('e2000000-0000-0000-0000-00000000000a', '2026-11-30', 'resignation');
  raise exception 'FAIL: BM terminated an employee';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();
select pg_temp.check((select department from employee_details where employee_id = 'e2000000-0000-0000-0000-00000000000a') = 'المبيعات الميدانية',
  'BM edited a non-financial field');
select pg_temp.check((select iban from employee_details where employee_id = 'e2000000-0000-0000-0000-00000000000a') = 'SA4420000001234567891299',
  'IBAN untouched by BM');

-- ---------- HR terminates, then corrects ----------
select pg_temp.login('a2000000-0000-0000-0000-000000000002');
do $$ begin
  perform terminate_employee('e2000000-0000-0000-0000-00000000000a', '2024-12-31', 'resignation');
  raise exception 'FAIL: termination before hire date accepted';
exception when raise_exception then
  if sqlerrm not like '%قبل تاريخ التعيين%' then raise; end if;
end $$;
select terminate_employee('e2000000-0000-0000-0000-00000000000a', '2026-11-30', 'resignation', 'استقالة مقدمة بخطاب');
select pg_temp.check((select not is_active and termination_reason = 'resignation' and termination_date = '2026-11-30'
                        from employees where id = 'e2000000-0000-0000-0000-00000000000a'), 'termination recorded');
select pg_temp.check((select employment_status from employee_details where employee_id = 'e2000000-0000-0000-0000-00000000000a') = 'terminated',
  'details status follows');
do $$ begin
  perform terminate_employee('e2000000-0000-0000-0000-00000000000a', '2026-12-01', 'resignation');
  raise exception 'FAIL: terminated twice';
exception when raise_exception then null;
end $$;
select reactivate_employee('e2000000-0000-0000-0000-00000000000a');
select pg_temp.check((select is_active and termination_date is null from employees where id = 'e2000000-0000-0000-0000-00000000000a'),
  'reactivated (correction path)');
do $$ begin
  update payroll_config set default_housing_pct = 150 where id = 1;
  raise exception 'FAIL: 150%% housing default accepted';
exception when check_violation then null;
end $$;
update payroll_config set default_housing_pct = 25, default_transport_pct = 10 where id = 1;
select pg_temp.logout();

select pg_temp.check(exists (select 1 from audit_log where table_name = 'employees' and action = 'update'
                              and record_id = 'e2000000-0000-0000-0000-00000000000a'
                              and new_data ? 'termination_reason'), 'termination audited');

-- ---------- account picker + display names ----------
select pg_temp.login('a2000000-0000-0000-0000-000000000002');
select pg_temp.check((select linked_employee from hr_account_options() where id = 'a2000000-0000-0000-0000-000000000009')
                     = 'e2000000-0000-0000-0000-00000000000a', 'HR sees accounts and which employee they belong to');
select pg_temp.check((select full_name from user_display_names(array['a2000000-0000-0000-0000-000000000003'::uuid])) = 'سعد آل مريح',
  'HR resolves a submitter name');
select pg_temp.logout();
select pg_temp.login('a2000000-0000-0000-0000-000000000009'); -- sales
do $$ begin
  perform * from hr_account_options();
  raise exception 'FAIL: sales listed login accounts';
exception when insufficient_privilege then null;
end $$;
select pg_temp.check((select count(*) from user_display_names(array['a2000000-0000-0000-0000-000000000003'::uuid])) = 0,
  'sales cannot resolve names');
select pg_temp.logout();
