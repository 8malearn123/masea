-- Tests for 0091: replacement policy snapshot (no retroactive effect), quota counting,
-- contractual exceptions (البند الثاني/4), approved exceptions, availability and
-- assignment swap without allocation conflicts, the old worker's return path.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9100000-0000-0000-0000-000000000001', 'bm91@test'),
  ('a9100000-0000-0000-0000-000000000002', 'ops91@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9100000-0000-0000-0000-000000000001', 'سعيد آل منصور', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9100000-0000-0000-0000-000000000002', 'عبدالمنعم الصيعري', 'operations_manager', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9100000-0000-0000-0000-000000000001', 'منيرة آل حارث', '0551234610', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f9100000-0000-0000-0000-000000000001', 'سيتي رحمة', 'إندونيسيا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f9100000-0000-0000-0000-000000000002', 'ليلى بيغوم', 'بنغلاديش', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f9100000-0000-0000-0000-000000000003', 'روزا مندوزا', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f9100000-0000-0000-0000-000000000004', 'فاطمة نامبي', 'أوغندا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
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
create or replace function pg_temp.activate(p_id uuid) returns void language plpgsql as $$
begin
  perform transition_contract(p_id, 'pending_approval');
  perform transition_contract(p_id, 'approved');
  perform transition_contract(p_id, 'awaiting_signature');
  insert into contract_signatures (contract_id, signer_type, signer_name)
  values (p_id, 'customer', 'العميل'), (p_id, 'company', 'الشركة');
  perform transition_contract(p_id, 'signed');
  perform transition_contract(p_id, 'active');
end $$;
create or replace function pg_temp.live_rp(p_contract uuid) returns uuid language sql as
$$ select id from contract_replacements where contract_id = p_contract
     and status in ('requested','pending_exception','eligible','scheduled') $$;
grant execute on all functions in schema pg_temp to authenticated;

-- contract OLD was signed before the policy was switched on; NEW after (limit 2)
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no,
                       start_date, end_date, worker_profile_id) values
  ('d9100000-0000-0000-0000-00000000000a', 'c9100000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 3000, 'draft', 'MR-91-OLD', current_date - 40, current_date - 11, null),
  ('d9100000-0000-0000-0000-00000000000b', 'c9100000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 9000, 'draft', 'MR-91-NEW', current_date - 10, current_date + 80, 'f9100000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
select pg_temp.login('a9100000-0000-0000-0000-000000000002');
select pg_temp.activate('d9100000-0000-0000-0000-00000000000a');
select pg_temp.logout();
update app_config set value = 1 where key = 'replacement_policy_active';
select pg_temp.login('a9100000-0000-0000-0000-000000000002');
select pg_temp.activate('d9100000-0000-0000-0000-00000000000b');
select pg_temp.logout();

select pg_temp.check((select replacement_policy->>'active' = 'false' from contracts
                       where id = 'd9100000-0000-0000-0000-00000000000a'), 'the policy is not applied retroactively');
select pg_temp.check((select (replacement_policy->>'active')::boolean and (replacement_policy->>'max')::int = 2
                        from contracts where id = 'd9100000-0000-0000-0000-00000000000b'),
  'a contract signed after activation carries {active, max 2}');
select pg_temp.check((replacement_quota('d9100000-0000-0000-0000-00000000000b')->>'remaining')::int = 2, '2 remaining');

-- ---------- replacement #1: performance (counts) ----------
select pg_temp.login('a9100000-0000-0000-0000-000000000001');
select request_worker_replacement('d9100000-0000-0000-0000-00000000000b', 'performance', 'بطء في الإنجاز');
select pg_temp.rejects($$select request_worker_replacement('d9100000-0000-0000-0000-00000000000b', 'performance')$$,
  'قائم', 'one live replacement at a time');
select pg_temp.rejects($$select schedule_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
                          'f9100000-0000-0000-0000-000000000001', current_date, current_date)$$,
  'غير العاملة الحالية', 'cannot replace her with herself');
select schedule_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
  'f9100000-0000-0000-0000-000000000002', current_date, current_date);
select pg_temp.check((select status from worker_profiles where id = 'f9100000-0000-0000-0000-000000000002') = 'reserved',
  'the substitute is reserved once scheduled');
select complete_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
  current_date, current_date, 'good', 'استُلمت في المقر');
select pg_temp.logout();

select pg_temp.check((select worker_profile_id from contracts where id = 'd9100000-0000-0000-0000-00000000000b')
  = 'f9100000-0000-0000-0000-000000000002', 'the contract now holds the substitute');
select pg_temp.check((select status from worker_profiles where id = 'f9100000-0000-0000-0000-000000000002') = 'on_service',
  'substitute on service');
select pg_temp.check((select status from worker_profiles where id = 'f9100000-0000-0000-0000-000000000001') = 'returning',
  'the previous worker is NOT available yet');
select pg_temp.check((select status = 'received' and replacement_id is not null from worker_returns
                       where worker_profile_id = 'f9100000-0000-0000-0000-000000000001'
                         and contract_id = 'd9100000-0000-0000-0000-00000000000b'),
  'her return is opened as «received»');
select pg_temp.check((replacement_quota('d9100000-0000-0000-0000-00000000000b')->>'remaining')::int = 1, '1 remaining');
select pg_temp.check((select contract_no from contracts where id = 'd9100000-0000-0000-0000-00000000000b') = 'MR-91-NEW',
  'the original contract is kept (no new contract, text untouched)');

-- readiness of the previous worker → available
select pg_temp.login('a9100000-0000-0000-0000-000000000001');
select worker_return_step((select id from worker_returns where worker_profile_id = 'f9100000-0000-0000-0000-000000000001'
                             and contract_id = 'd9100000-0000-0000-0000-00000000000b'), 'ready');
select pg_temp.logout();
select pg_temp.check((select status from worker_profiles where id = 'f9100000-0000-0000-0000-000000000001') = 'available',
  'the previous worker is available after readiness');

-- ---------- replacement #2: worker refused (البند الثاني/4) — does NOT count ----------
select pg_temp.login('a9100000-0000-0000-0000-000000000001');
select request_worker_replacement('d9100000-0000-0000-0000-00000000000b', 'worker_refused');
select pg_temp.check((select status = 'eligible' and not counts_toward_limit and exception_basis = 'contract_clause'
                        from contract_replacements where id = pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b')),
  'a contractual reason is eligible and outside the quota');
select schedule_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
  'f9100000-0000-0000-0000-000000000003', current_date, current_date);
select complete_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'), current_date, current_date, 'complaint');
select pg_temp.logout();
select pg_temp.check((replacement_quota('d9100000-0000-0000-0000-00000000000b')->>'remaining')::int = 1,
  'still 1 remaining after a contractual replacement');

-- ---------- replacement #3 (ordinary) uses the last slot; #4 ordinary is refused ----------
select pg_temp.login('a9100000-0000-0000-0000-000000000001');
select request_worker_replacement('d9100000-0000-0000-0000-00000000000b', 'customer_preference');
select schedule_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
  'f9100000-0000-0000-0000-000000000004', current_date, current_date);
select complete_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'), current_date, current_date, 'good');
select pg_temp.rejects($$select request_worker_replacement('d9100000-0000-0000-0000-00000000000b', 'compatibility')$$,
  'استُنفد', 'the third ordinary replacement is blocked by the approved policy');

-- … unless an exception is requested and approved by someone else
select request_worker_replacement('d9100000-0000-0000-0000-00000000000b', 'compatibility', null, current_date, null,
  'management', 'قرار الإدارة لظروف الأسرة');
select pg_temp.rejects($$select replacement_step(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'), 'approve_exception')$$,
  'أربع أعين', 'the requester cannot approve their own exception');
select pg_temp.rejects($$select schedule_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
                          'f9100000-0000-0000-0000-000000000001', current_date, current_date)$$,
  'غير مؤهل', 'no scheduling before the exception is approved');
select pg_temp.logout();
select pg_temp.login('a9100000-0000-0000-0000-000000000002');
select replacement_step(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'), 'approve_exception');
select pg_temp.logout();
select pg_temp.check((select status = 'eligible' and not counts_toward_limit from contract_replacements
                       where id = pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b')), 'approved exception is eligible');

-- ---------- allocation conflicts ----------
-- the substitute must be free for the remaining period of the contract
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no,
                       start_date, end_date, worker_profile_id) values
  ('d9100000-0000-0000-0000-00000000000c', 'c9100000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 3000, 'draft', 'MR-91-OTHER', current_date + 5, current_date + 34, 'f9100000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
select pg_temp.login('a9100000-0000-0000-0000-000000000002');
select transition_contract('d9100000-0000-0000-0000-00000000000c', 'pending_approval');
select pg_temp.logout();
select pg_temp.login('a9100000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select schedule_worker_replacement(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'),
                          'f9100000-0000-0000-0000-000000000001', current_date, current_date)$$,
  'سيتي رحمة', 'a worker booked on another live contract cannot be the substitute');
-- the overlap check itself (status bypassed): the remaining period collides with MR-91-OTHER
select pg_temp.check((worker_contract_conflict('f9100000-0000-0000-0000-000000000001', current_date,
                       current_date + 80, 'd9100000-0000-0000-0000-00000000000b')).contract_no = 'MR-91-OTHER',
  'the remaining-period conflict is detected');
select replacement_step(pg_temp.live_rp('d9100000-0000-0000-0000-00000000000b'), 'cancel');
select pg_temp.logout();

-- the operations log carries every replacement step
select pg_temp.check((select count(*) >= 10 from contract_ops_events
                       where contract_id = 'd9100000-0000-0000-0000-00000000000b' and entity = 'replacement'),
  'every replacement step is logged');
update app_config set value = 0 where key = 'replacement_policy_active';

select 'OK 99r_replacements' as result;
