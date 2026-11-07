-- Tests for 0073 (end of service): the award rules (م84/85/87/80), leave payout,
-- م77 compensation, settlement four-eyes + freeze, posting, payment, monthly provision.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a6000000-0000-0000-0000-000000000001', 'gm6@test'),
  ('a6000000-0000-0000-0000-000000000002', 'hr6@test'),
  ('a6000000-0000-0000-0000-000000000004', 'sales6@test'),
  ('a6000000-0000-0000-0000-000000000006', 'acc6@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a6000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('a6000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a6000000-0000-0000-0000-000000000004', 'نايف اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a6000000-0000-0000-0000-000000000006', 'بدر المالكي', 'accountant', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into employees (id, full_name, branch_id, basic_salary, transport_allowance, nationality, hire_date) values
  ('e6000000-0000-0000-0000-00000000000a', 'عبدالرحمن القحطاني', 'b0000000-0000-0000-0000-00000000000a', 8000, 0, 'السعودية', '2021-07-01'),
  ('e6000000-0000-0000-0000-00000000000b', 'سلمان الشهراني', 'b0000000-0000-0000-0000-00000000000a', 6000, 500, 'السعودية', '2024-01-01')
on conflict (id) do nothing;
insert into employee_details (employee_id, housing_allowance) values
  ('e6000000-0000-0000-0000-00000000000a', 2000), ('e6000000-0000-0000-0000-00000000000b', 1500)
on conflict (employee_id) do nothing;

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
create or replace function pg_temp.aw(y numeric, r text) returns numeric language sql as
$$ select (eos_award(y, 10000, r)->>'award')::numeric $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- the law (wage 10,000) ----------
select pg_temp.check(pg_temp.aw(8, 'employer_termination') = 55000, 'م84: 5 × ½ + 3 × 1 = 5.5 months');
select pg_temp.check(pg_temp.aw(1.5, 'resignation') = 0, 'م85: resignation under 2 years → nothing');
select pg_temp.check(pg_temp.aw(3, 'resignation') = 5000, 'م85: 2–5 years → a third (15,000 ÷ 3)');
select pg_temp.check(pg_temp.aw(7, 'resignation') = 30000, 'م85: 5–10 years → two thirds (45,000 × ⅔)');
select pg_temp.check(pg_temp.aw(12, 'resignation') = 95000, 'م85: 10+ years → full');
select pg_temp.check(pg_temp.aw(3, 'resignation_art87') = 15000, 'م87: full award despite resignation');
select pg_temp.check(pg_temp.aw(8, 'article_80') = 0, 'م80: no award');
select pg_temp.check(eos_service_years('2021-07-01', '2026-06-30') = 5, '1,825 days = 5 years');

-- ---------- a settlement ----------
select pg_temp.login('a6000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select prepare_eos_settlement('e6000000-0000-0000-0000-00000000000a')$$,
  'إنهاء خدمة', 'a settlement for an active employee');
select terminate_employee('e6000000-0000-0000-0000-00000000000a', '2026-06-30', 'employer_termination', 'إعادة هيكلة');
select terminate_employee('e6000000-0000-0000-0000-00000000000b', '2026-06-30', 'resignation', null);
select pg_temp.rejects($$select prepare_eos_settlement('e6000000-0000-0000-0000-00000000000b', true)$$,
  'المادة 77', 'م77 compensation on a resignation');
select pg_temp.rejects($$select prepare_eos_settlement('e6000000-0000-0000-0000-00000000000a', true, 0, 1500, '')$$,
  'سبب', 'a deduction without a reason');
select prepare_eos_settlement('e6000000-0000-0000-0000-00000000000a', true, 0, 1500, 'سلفة غير مستردة');
select prepare_eos_settlement('e6000000-0000-0000-0000-00000000000b');
select pg_temp.logout();

create temp view s as select * from eos_settlements where status <> 'cancelled';
grant select on s to authenticated;
select pg_temp.check((select award from s where employee_id = 'e6000000-0000-0000-0000-00000000000a') = 25000,
  'A: 5 years × ½ × 10,000');
select pg_temp.check((select art77_amount from s where employee_id = 'e6000000-0000-0000-0000-00000000000a') = 25000,
  'A: م77 = max(15 days × 5 years, 2 months) = 25,000');
select pg_temp.check((select leave_days between 104 and 106 and leave_amount = round(10000 / 30.0 * leave_days, 2)
                        from s where employee_id = 'e6000000-0000-0000-0000-00000000000a'),
  'A: ~105 unused leave days paid at the full daily wage (م111)');
select pg_temp.check((select net = award + leave_amount + art77_amount - 1500 from s
                       where employee_id = 'e6000000-0000-0000-0000-00000000000a'), 'A: net = all − deductions');
select pg_temp.check((select award_ratio = 0.3333 and abs(award - award_full / 3) < 0.01
                        from s where employee_id = 'e6000000-0000-0000-0000-00000000000b'),
  'B resigned after 2.49 years (2–5) → a third of the award (م85)');

-- ---------- four eyes, freeze ----------
select pg_temp.login('a6000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select approve_eos_settlement((select id from s where employee_id = 'e6000000-0000-0000-0000-00000000000a'))$$,
  'الأربع أعين', 'the preparer approved');
select pg_temp.logout();
select pg_temp.login('a6000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from eos_settlements where employee_id::text like 'e6000000%') = 0, 'sales cannot read settlements');
select pg_temp.logout();
select pg_temp.login('a6000000-0000-0000-0000-000000000001');
select approve_eos_settlement((select id from s where employee_id = 'e6000000-0000-0000-0000-00000000000a'));
select pg_temp.logout();
select pg_temp.login('a6000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select prepare_eos_settlement('e6000000-0000-0000-0000-00000000000a')$$, 'معتمدة', 're-prepared an approved settlement');
select pg_temp.rejects($$select post_eos_settlement((select id from s where employee_id = 'e6000000-0000-0000-0000-00000000000a'))$$,
  'صلاحية المحاسبة', 'HR posted to the ledger');
select pg_temp.logout();
select pg_temp.rejects($$update eos_settlements set net = 1 where employee_id = 'e6000000-0000-0000-0000-00000000000a' and status = 'approved'$$,
  'مجمّدة', 'an approved settlement was edited');

-- ---------- accounting: post + pay + provision ----------
select pg_temp.login('a6000000-0000-0000-0000-000000000006');
select pg_temp.check((select count(*) from eos_settlements where employee_id::text like 'e6000000%') = 2, 'accountant reads settlements');
select post_eos_settlement((select id from s where employee_id = 'e6000000-0000-0000-0000-00000000000a'));
select pay_eos_settlement((select id from s where employee_id = 'e6000000-0000-0000-0000-00000000000a'), '2026-07-05', '1112');
select post_eos_provision('2026-11');
select pg_temp.rejects($$select post_eos_provision('2026-11')$$, 'بالفعل', 'provision posted twice');
select pg_temp.logout();

select pg_temp.check((select sum(debit) = sum(credit) from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                       where j.source_id = (select id from s where employee_id = 'e6000000-0000-0000-0000-00000000000a')
                         and j.reference like 'EOS-%' and j.reference not like 'EOS-PAY-%'), 'settlement entry balanced');
select pg_temp.check(exists (select 1 from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                              where j.reference like 'EOS-%' and j.reference not like 'EOS-P%'
                                and l.account_id = acc_id('2210') and l.debit = 25000), 'award drawn from the provision 2210');
select pg_temp.check((select status from s where employee_id = 'e6000000-0000-0000-0000-00000000000a') = 'paid', 'settlement paid');
select pg_temp.check((select coalesce(sum(l.credit - l.debit), 0) from journal_entry_lines l join journal_entries j on j.id = l.entry_id
                       where l.account_id = acc_id('2210') and j.status = 'posted' and j.entry_date <= '2026-11-30')
                     = round(eos_provision_target('2026-11-30'), 2),
  'after the true-up the provision equals the liability of current employees');
select pg_temp.login('a6000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select post_eos_provision('2026-12')$$, 'صلاحية المحاسبة', 'HR posted the provision');
select pg_temp.rejects($$select eos_wages('e6000000-0000-0000-0000-00000000000a')$$, 'permission denied', 'eos_wages callable directly');
select pg_temp.logout();
