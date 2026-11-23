-- Tests for 0089 (contract foundations): worker link + overlap guard, worker availability,
-- live idempotent postings on signing and payment, amount_paid, frozen signed text.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a8900000-0000-0000-0000-000000000001', 'gm89@test'),
  ('a8900000-0000-0000-0000-000000000004', 'driver89@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a8900000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('a8900000-0000-0000-0000-000000000004', 'مبارك آل منصور', 'driver', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c8900000-0000-0000-0000-000000000001', 'سعد آل مريح', '0551234501', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f8900000-0000-0000-0000-000000000001', 'سيتي نورحليزة', 'إندونيسيا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f8900000-0000-0000-0000-000000000002', 'ماريا سانتوس', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

-- three draft monthly-rental contracts; A and B overlap, C is later
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date) values
  ('d8900000-0000-0000-0000-00000000000a', 'c8900000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 3000, 'draft', 'MR-89-A', '2026-12-01', '2026-12-30'),
  ('d8900000-0000-0000-0000-00000000000b', 'c8900000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 3000, 'draft', 'MR-89-B', '2026-12-15', '2027-01-14'),
  ('d8900000-0000-0000-0000-00000000000c', 'c8900000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 3000, 'draft', 'MR-89-C', '2027-02-01', '2027-02-28')
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
create or replace function pg_temp.sign(p_id uuid) returns void language plpgsql as $$
begin
  perform transition_contract(p_id, 'pending_approval');
  perform transition_contract(p_id, 'approved');
  perform transition_contract(p_id, 'awaiting_signature');
  insert into contract_signatures (contract_id, signer_type, signer_name)
  values (p_id, 'customer', 'سعد آل مريح'), (p_id, 'company', 'منصور المكرمي');
  perform transition_contract(p_id, 'signed');
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- 1) worker link + overlap ----------
select pg_temp.login('a8900000-0000-0000-0000-000000000004');
select pg_temp.rejects($$select set_contract_worker('d8900000-0000-0000-0000-00000000000a', 'f8900000-0000-0000-0000-000000000001')$$,
  'صلاحية', 'a driver has no contracts.edit');
select pg_temp.logout();

select pg_temp.login('a8900000-0000-0000-0000-000000000001');
select set_contract_worker('d8900000-0000-0000-0000-00000000000a', 'f8900000-0000-0000-0000-000000000001');
select set_contract_worker('d8900000-0000-0000-0000-00000000000b', 'f8900000-0000-0000-0000-000000000001');
select set_contract_worker('d8900000-0000-0000-0000-00000000000c', 'f8900000-0000-0000-0000-000000000001');
-- drafts never reserve: all three may name her
select pg_temp.sign('d8900000-0000-0000-0000-00000000000a');
select pg_temp.logout();
select pg_temp.check((select status from worker_profiles where id = 'f8900000-0000-0000-0000-000000000001') = 'reserved',
  'signing reserves the worker');

select pg_temp.login('a8900000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select transition_contract('d8900000-0000-0000-0000-00000000000b', 'pending_approval')$$,
  'contracts_worker_no_overlap', 'an overlapping contract cannot go live');
select pg_temp.rejects($$select set_contract_worker('d8900000-0000-0000-0000-00000000000a', 'f8900000-0000-0000-0000-000000000002')$$,
  'استبدال', 'after the draft the worker changes only through replacement');
-- a non-overlapping period is fine
select transition_contract('d8900000-0000-0000-0000-00000000000c', 'pending_approval');
select pg_temp.check((worker_contract_conflict('f8900000-0000-0000-0000-000000000001', '2026-12-20', '2026-12-25')).id = 'd8900000-0000-0000-0000-00000000000a',
  'conflict lookup finds contract A');
select pg_temp.check((worker_contract_conflict('f8900000-0000-0000-0000-000000000001', '2027-01-01', '2027-01-20')).id is null,
  'no conflict in a free window');

-- ---------- 2) posting on signing — exactly once ----------
select pg_temp.logout();
select pg_temp.check((select count(*) from journal_entries
                       where idempotency_key = 'CS-d8900000-0000-0000-0000-00000000000a' and status = 'posted') = 1,
  'signing posts one contract entry');
select pg_temp.check((select sum(debit) = sum(credit) and sum(debit) = 3450 from journal_entry_lines l
                        join journal_entries e on e.id = l.entry_id
                       where e.idempotency_key = 'CS-d8900000-0000-0000-0000-00000000000a'),
  'entry is balanced at total incl. VAT (3,000 + 450)');
select pg_temp.check(exists (select 1 from journal_entry_lines l join journal_entries e on e.id = l.entry_id
                              join chart_of_accounts a on a.id = l.account_id
                             where e.idempotency_key = 'CS-d8900000-0000-0000-0000-00000000000a'
                               and a.code = '4200' and l.credit = 3000),
  'monthly rental revenue goes to 4200 from service_code');
select post_contract_signed('d8900000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from journal_entries
                       where source_type = 'contract' and source_id = 'd8900000-0000-0000-0000-00000000000a'
                         and status <> 'void') = 1, 're-posting is idempotent');

-- ---------- 3) payments: amount_paid + posting + freeze ----------
insert into payments (id, contract_id, amount, method, reference_no) values
  ('98900000-0000-0000-0000-000000000001', 'd8900000-0000-0000-0000-00000000000a', 2000, 'transfer', 'TRF-8901'),
  ('98900000-0000-0000-0000-000000000002', 'd8900000-0000-0000-0000-00000000000a', 1450, 'mada', 'MADA-8902');
select pg_temp.check((select amount_paid from contracts where id = 'd8900000-0000-0000-0000-00000000000a') = 3450,
  'amount_paid follows payments');
select pg_temp.check((select count(*) from journal_entries
                       where idempotency_key in ('PR-98900000-0000-0000-0000-000000000001',
                                                 'PR-98900000-0000-0000-0000-000000000002')) = 2,
  'each payment posts once');
select pg_temp.rejects($$delete from payments where id = '98900000-0000-0000-0000-000000000001'$$,
  'استرداد', 'a posted payment cannot be deleted');
select pg_temp.rejects($$update payments set amount = 1 where id = '98900000-0000-0000-0000-000000000001'$$,
  'محمية', 'a posted payment cannot be edited');

-- ---------- 4) the signed text is frozen ----------
select pg_temp.rejects($$insert into contract_clauses (contract_id, sort_order, body)
                         values ('d8900000-0000-0000-0000-00000000000a', 99, 'بند مضاف')$$,
  'محمية', 'no clause added after signing');
select pg_temp.rejects($$delete from contract_signatures where contract_id = 'd8900000-0000-0000-0000-00000000000a'$$,
  'غير قابل', 'signatures cannot be deleted');
select pg_temp.rejects($$delete from contracts where id = 'd8900000-0000-0000-0000-00000000000a'$$,
  'لا يُحذف', 'a signed contract cannot be deleted');

-- ---------- 5) availability through the lifecycle ----------
select pg_temp.login('a8900000-0000-0000-0000-000000000001');
select transition_contract('d8900000-0000-0000-0000-00000000000a', 'active');
select pg_temp.logout();
select pg_temp.check((select status from worker_profiles where id = 'f8900000-0000-0000-0000-000000000001') = 'on_service',
  'active → on service');
select pg_temp.login('a8900000-0000-0000-0000-000000000001');
select transition_contract('d8900000-0000-0000-0000-00000000000a', 'completed');
select pg_temp.logout();
select pg_temp.check((select status from worker_profiles where id = 'f8900000-0000-0000-0000-000000000001') = 'returning',
  'after a delivered contract ends she awaits physical return');
select pg_temp.login('a8900000-0000-0000-0000-000000000001');
select transition_contract('d8900000-0000-0000-0000-00000000000c', 'cancelled');
select pg_temp.logout();
select pg_temp.check((select status from worker_profiles where id = 'f8900000-0000-0000-0000-000000000001') = 'returning',
  'cancelling another contract does not release a worker who has not been received');

select 'OK 99p_contract_foundations' as result;
