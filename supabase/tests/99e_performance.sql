-- Tests for 0076 (performance): criteria per role, weighted score on the server,
-- sales vs targets, attendance discipline, bands, edit/archive, guards, targets RLS.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000002', 'hr9@test'),
  ('a9000000-0000-0000-0000-000000000003', 'bmj9@test'),
  ('a9000000-0000-0000-0000-000000000004', 'sales9@test'),
  ('a9000000-0000-0000-0000-000000000005', 'cc9@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9000000-0000-0000-0000-000000000002', 'خالد الدوسري', 'hr', null),
  ('a9000000-0000-0000-0000-000000000003', 'سعد آل مريح', 'branch_manager', 'b0000000-0000-0000-0000-00000000000b'),
  ('a9000000-0000-0000-0000-000000000004', 'نورة العتيبي', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9000000-0000-0000-0000-000000000005', 'هيا الغامدي', 'call_center', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into employees (id, full_name, branch_id, basic_salary, nationality, hire_date, role, user_id) values
  ('e9000000-0000-0000-0000-00000000000a', 'نورة العتيبي', 'b0000000-0000-0000-0000-00000000000a', 7000, 'السعودية', '2024-01-01', 'sales', 'a9000000-0000-0000-0000-000000000004'),
  ('e9000000-0000-0000-0000-00000000000b', 'أحمد الزهراني', 'b0000000-0000-0000-0000-00000000000a', 5000, 'السعودية', '2024-01-01', 'driver', null),
  ('e9000000-0000-0000-0000-00000000000c', 'خالد الدوسري', 'b0000000-0000-0000-0000-00000000000a', 9000, 'السعودية', '2023-01-01', 'hr', 'a9000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

-- real sales (as the contract trigger would create them): 6 sold, 1 cancelled
alter table sales disable trigger user;
insert into sales (contract_id, branch_id, net_amount, total_amount, sold_at, sold_by, status)
select c.id, 'b0000000-0000-0000-0000-00000000000a', 4000, 4600,
       ('2026-10-' || lpad((10 + c.n)::text, 2, '0') || ' 10:00+03')::timestamptz,
       'a9000000-0000-0000-0000-000000000004', case when c.n = 7 then 'cancelled' else 'confirmed' end
  from (select id, row_number() over (order by id) n from contracts
         where id not in (select contract_id from sales)) c
 where c.n <= 7;
alter table sales enable trigger user;
-- attendance: 18 present, 2 late, 2 absent → (18 + 2×0.5)/22 = 86.36
insert into attendance (employee_id, date, status)
select 'e9000000-0000-0000-0000-00000000000a', d::date,
       case when n <= 18 then 'present' when n <= 20 then 'late' else 'absent' end::attendance_status
  from (select d, row_number() over (order by d) n
          from generate_series('2026-10-01'::date, '2026-10-22'::date, interval '1 day') d) x
on conflict do nothing;

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

select pg_temp.check((select count(*) from sales where sold_by = 'a9000000-0000-0000-0000-000000000004' and status <> 'cancelled') = 6,
  'fixture: 6 sales');

-- ---------- targets: HR sets them; the seller reads her own ----------
select pg_temp.login('a9000000-0000-0000-0000-000000000002');
insert into targets (user_id, branch_id, month, year, contracts_target, sales_amount_target)
values ('a9000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000a', 10, 2026, 8, 30000);
select pg_temp.rejects($$ insert into targets (user_id, month, year, contracts_target) values
  ('a9000000-0000-0000-0000-000000000005', 10, 2026, -1) $$, 'targets_values_chk', 'no negative target');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from targets where user_id = 'a9000000-0000-0000-0000-000000000004') = 1, 'seller sees her target');
select pg_temp.rejects($$ insert into targets (user_id, month, year, contracts_target) values
  ('a9000000-0000-0000-0000-000000000004', 11, 2026, 1) $$, 'row-level security', 'seller cannot set targets');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000005');
-- call-center holds targets.view (the shared leaderboard): reads, never writes
update targets set contracts_target = 1 where user_id = 'a9000000-0000-0000-0000-000000000004';
select pg_temp.logout();
select pg_temp.check((select contracts_target from targets where user_id = 'a9000000-0000-0000-0000-000000000004') = 8,
  'a colleague cannot change a target');

-- ---------- automatic scores ----------
select pg_temp.login('a9000000-0000-0000-0000-000000000002');
create temp table t_auto as select perf_auto_scores('e9000000-0000-0000-0000-00000000000a', '2026-10-01', '2026-10-31') a;
select pg_temp.check((select (a->'sales_count'->>'achieved')::numeric = 6 and (a->'sales_count'->>'score')::numeric = 75 from t_auto),
  'contracts 6 / 8 = 75%');
select pg_temp.check((select (a->'sales_amount'->>'achieved')::numeric = 24000 and (a->'sales_amount'->>'score')::numeric = 80 from t_auto),
  'sales 24,000 / 30,000 = 80% (cancelled excluded)');
select pg_temp.check((select (a->'attendance'->>'score')::numeric = 86.36 from t_auto), 'discipline (18 + 2×0.5)/22');

-- ---------- weighted review (sales role: 6 criteria) ----------
-- quality 90×25 + discipline 86.36×20 + teamwork 80×15 + customers 70×15 + contracts 75×15 + value 80×10 = 8152.2 / 100
create temp table t_rev as select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000a', 'أكتوبر 2026',
  '2026-10-01', '2026-10-31', '{"quality":90,"teamwork":80,"customers":70}', 'تحسّن ملحوظ في المتابعة') id;
select pg_temp.check((select score from performance_reviews where id = (select id from t_rev)) = 81.52, 'weighted total 81.52');
select pg_temp.check((select jsonb_array_length(criteria) from performance_reviews where id = (select id from t_rev)) = 6,
  'sales role gets the sales criteria');
select pg_temp.check(perf_rating(81.52) = 'جيد جدًا', 'band: جيد جدًا');
select pg_temp.check((select reviewer_name from performance_reviews where id = (select id from t_rev)) = 'خالد الدوسري', 'reviewer recorded');

-- a driver: no sales criteria, no attendance → manual ones only
create temp table t_rev2 as select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000b', 'أكتوبر 2026',
  '2026-10-01', '2026-10-31', '{"quality":70,"teamwork":90,"customers":80}') id;
select pg_temp.check((select jsonb_array_length(criteria) = 4 and score = round((70*25 + 90*15 + 80*15)::numeric / 55, 2)
  from performance_reviews where id = (select id from t_rev2)), 'driver: 4 criteria, discipline skipped (no attendance)');

-- guards
select pg_temp.rejects($$ select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000b', 'x', '2026-10-01', '2026-10-31', '{"quality":70,"teamwork":90}') $$,
  'أدخل درجة', 'every manual criterion is required');
select pg_temp.rejects($$ select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000b', 'x', '2026-10-01', '2026-10-31', '{"quality":170,"teamwork":90,"customers":1}') $$,
  'بين 0 و100', 'score bounds');
select pg_temp.rejects($$ select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000b', 'x', '2026-11-01', '2026-10-31', '{}') $$,
  'غير صحيحة', 'period order');
select pg_temp.rejects($$ select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000c', 'x', '2026-10-01', '2026-10-31', '{"quality":100,"teamwork":100,"customers":100}') $$,
  'نفسه', 'no self-review');
select pg_temp.rejects($$ update performance_reviews set score = 100 where id = (select id from t_rev) $$,
  'نموذج التقييم', 'scores are not editable directly');
select pg_temp.rejects($$ insert into performance_reviews (employee_id, period, score) values ('e9000000-0000-0000-0000-00000000000b', 'x', 99) $$,
  'نموذج التقييم', 'no direct insert');

-- edit keeps the original criteria even if settings change later
update perf_criteria set weight = 50 where code = 'quality';
select save_performance_review((select id from t_rev), null, 'أكتوبر 2026', '2026-10-01', '2026-10-31',
  '{"quality":100,"teamwork":80,"customers":70}', null);
select pg_temp.check((select score from performance_reviews where id = (select id from t_rev)) = 84.02
  and (select (criteria->0->>'weight')::numeric from performance_reviews where id = (select id from t_rev)) = 25,
  'edit recomputes with the snapshot weights (quality 100 → 84.02)');
update perf_criteria set weight = 25 where code = 'quality';

-- archive / restore; archived cannot be edited
update performance_reviews set is_active = false where id = (select id from t_rev2);
select pg_temp.rejects($$ select save_performance_review((select id from t_rev2), null, 'x', '2026-10-01', '2026-10-31', '{"quality":1,"teamwork":1,"customers":1}') $$,
  'مؤرشف', 'archived review is frozen');
update performance_reviews set is_active = true where id = (select id from t_rev2);
select pg_temp.logout();

-- ---------- scope ----------
select pg_temp.login('a9000000-0000-0000-0000-000000000003');      -- Jazan BM
select pg_temp.rejects($$ select save_performance_review(null, 'e9000000-0000-0000-0000-00000000000b', 'x', '2026-10-01', '2026-10-31', '{"quality":1,"teamwork":1,"customers":1}') $$,
  'صلاحية', 'BM cannot review another branch');
select pg_temp.rejects($$ select perf_auto_scores('e9000000-0000-0000-0000-00000000000a', '2026-10-01', '2026-10-31') $$,
  'غير مصرّح', 'BM cannot read another branch achievements');
update perf_criteria set weight = 99 where code = 'quality';
select pg_temp.logout();
select pg_temp.check((select weight from perf_criteria where code = 'quality') = 25, 'BM cannot change criteria');
select pg_temp.login('a9000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from performance_reviews where employee_id = 'e9000000-0000-0000-0000-00000000000a') = 1,
  'the employee reads her own review');
select pg_temp.check((select count(*) from performance_reviews where employee_id = 'e9000000-0000-0000-0000-00000000000b') = 0,
  'but not colleagues');
select pg_temp.logout();

select pg_temp.check(exists (select 1 from audit_log where table_name = 'performance_reviews'), 'reviews audited');
select pg_temp.check(exists (select 1 from audit_log where table_name = 'perf_criteria'), 'criteria audited');
\echo 'OK 99e_performance'
