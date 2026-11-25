-- Tests for 0090: cancellation & settlement (contract terms, four-eyes, credit note once),
-- worker return (no availability before receipt + readiness), refunds (allocation to the
-- original payments, partial/full payout, no over-refund, no duplicate transfer).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001', 'bm90@test'),
  ('a9000000-0000-0000-0000-000000000002', 'ops90@test'),
  ('a9000000-0000-0000-0000-000000000003', 'acc90@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9000000-0000-0000-0000-000000000001', 'حمد آل زمانان', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9000000-0000-0000-0000-000000000002', 'عبدالمنعم الصيعري', 'operations_manager', null),
  ('a9000000-0000-0000-0000-000000000003', 'بدر المالكي', 'accountant', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9000000-0000-0000-0000-000000000001', 'فيصل آل سالم', '0551234590', 'b0000000-0000-0000-0000-00000000000a', 'نجران'),
  ('c9000000-0000-0000-0000-000000000002', 'هيلة اليامي', '0551234591', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f9000000-0000-0000-0000-000000000001', 'نورما ديلا كروز', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f9000000-0000-0000-0000-000000000002', 'أمينة عبدي', 'كينيا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;

-- the rental template v1 carries «200 ﷼/يوم» (البند الثالث/10); approve the monthly copy
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000002', false);
select approve_contract_template(id) from contract_templates
 where template_code = 'rental_labor_services' and service_code = 'monthly_rental' and status = 'pending_review';
select set_config('request.jwt.claim.sub', '', false);
insert into contracts (id, customer_id, branch_id, service_code, template_id, base_amount, status, contract_no,
                       start_date, end_date, worker_profile_id)
select v.id::uuid, v.cust::uuid, 'b0000000-0000-0000-0000-00000000000a', 'monthly_rental',
       (select id from contract_templates where template_code = 'rental_labor_services'
           and service_code = 'monthly_rental' and status = 'approved' order by version desc limit 1),
       v.amt, 'draft', v.no, v.s::date, v.e::date, v.w::uuid
from (values
  ('d9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-000000000001', 6000, 'MR-90-A',
   '2026-10-01', '2026-11-29', 'f9000000-0000-0000-0000-000000000001'),
  ('d9000000-0000-0000-0000-00000000000b', 'c9000000-0000-0000-0000-000000000002', 3000, 'MR-90-B',
   '2027-01-01', '2027-01-30', 'f9000000-0000-0000-0000-000000000002')
) v(id, cust, amt, no, s, e, w)
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
  perform sign_contract_party(p_id, 'customer', 'عميل التجربة',
    coalesce((select regexp_replace(c.national_id, '\D', '', 'g') from contracts k join customers c on c.id = k.customer_id
               where k.id = p_id and nullif(c.national_id, '') is not null), '1000000001'),
    'data:image/png;base64,' || repeat('A', 300));   -- 0107: signing via the server function
  perform sign_contract_party(p_id, 'company', null, null, 'data:image/png;base64,' || repeat('B', 300));
end $$;
create or replace function pg_temp.sid(p_contract uuid) returns uuid language sql as
$$ select id from contract_settlements where contract_id = p_contract and status not in ('rejected','cancelled') $$;
create or replace function pg_temp.rid(p_contract uuid) returns uuid language sql as
$$ select id from refunds where contract_id = p_contract and status <> 'rejected' $$;
grant execute on all functions in schema pg_temp to authenticated;

-- contracts A (delivered, 6,900 incl. VAT) and B (signed only, 3,450)
select pg_temp.login('a9000000-0000-0000-0000-000000000002');
select pg_temp.sign('d9000000-0000-0000-0000-00000000000a');
select transition_contract('d9000000-0000-0000-0000-00000000000a', 'active');
select pg_temp.sign('d9000000-0000-0000-0000-00000000000b');
select pg_temp.logout();
insert into payments (contract_id, amount, method, reference_no, paid_at) values
  ('d9000000-0000-0000-0000-00000000000a', 4000, 'transfer', 'TRF-9001', '2026-10-01'),
  ('d9000000-0000-0000-0000-00000000000a', 2900, 'mada', 'MADA-9002', '2026-10-02'),
  ('d9000000-0000-0000-0000-00000000000b', 3450, 'transfer', 'TRF-9003', '2026-12-20');
select pg_temp.check((select template_version from contracts where id = 'd9000000-0000-0000-0000-00000000000a') = 1,
  'contract A is pinned to rental template v1');

select pg_temp.login('a9000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$select transition_contract('d9000000-0000-0000-0000-00000000000a', 'cancelled')$$,
  'وتسويته', 'an active paid contract cannot be cancelled directly');
select pg_temp.logout();

-- ================= scenario: cancel BEFORE the service starts (B) =================
select pg_temp.login('a9000000-0000-0000-0000-000000000001');
select pg_temp.check((compute_contract_settlement('d9000000-0000-0000-0000-00000000000b', '2026-12-25')->>'kind')
  = 'cancel_before_start', 'B was never delivered');
select prepare_contract_settlement('d9000000-0000-0000-0000-00000000000b', '2026-12-25', 'customer_travel');
select pg_temp.check((select service_due = 0 and balance = 3450 and due_basis = 'none' from contract_settlements
                       where id = pg_temp.sid('d9000000-0000-0000-0000-00000000000b')),
  'before start: nothing is due, the full payment is refundable');
select pg_temp.rejects($$select prepare_contract_settlement('d9000000-0000-0000-0000-00000000000b', '2026-12-25', 'customer_travel')$$,
  'قائمة', 'one live settlement per contract');
select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000b'), 'submit');
select pg_temp.rejects($$select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000b'), 'review')$$,
  'أربع أعين', 'the preparer cannot review their own settlement');
select pg_temp.logout();

select pg_temp.login('a9000000-0000-0000-0000-000000000002');
select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000b'), 'review', 'مطابق للعقد');
select pg_temp.rejects($$select settle_contract_settlement(pg_temp.sid('d9000000-0000-0000-0000-00000000000b'))$$,
  'اعتمادها مالياً', 'cannot execute before the financial approval');
select pg_temp.logout();

select pg_temp.login('a9000000-0000-0000-0000-000000000003');
select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000b'), 'approve');
select settle_contract_settlement(pg_temp.sid('d9000000-0000-0000-0000-00000000000b'));
select pg_temp.logout();

select pg_temp.check((select status from contracts where id = 'd9000000-0000-0000-0000-00000000000b') = 'cancelled',
  'B is cancelled — the original row is kept');
select pg_temp.check((select status from worker_profiles where id = 'f9000000-0000-0000-0000-000000000002') = 'available',
  'an undelivered worker is released at once');
select pg_temp.check((select sum(l.credit) = 3450 from journal_entry_lines l join journal_entries e on e.id = l.entry_id
                       join chart_of_accounts a on a.id = l.account_id
                      where e.idempotency_key = 'ST-' || pg_temp.sid('d9000000-0000-0000-0000-00000000000b')
                        and a.code = '1120'),
  'credit note reverses the whole receivable (3,450)');
select pg_temp.check((select sum(debit) = sum(credit) from journal_entry_lines l join journal_entries e on e.id = l.entry_id
                      where e.idempotency_key = 'ST-' || pg_temp.sid('d9000000-0000-0000-0000-00000000000b')),
  'credit note is balanced');
select pg_temp.check((select amount = 3450 and status = 'draft' and due_by is not null from refunds
                       where id = pg_temp.rid('d9000000-0000-0000-0000-00000000000b')),
  'a refund request for 3,450 is created, due within 7 days (البند الثالث/12)');
select pg_temp.check((select sum(amount) = 3450 from refund_allocations
                       where refund_id = pg_temp.rid('d9000000-0000-0000-0000-00000000000b')),
  'the refund is allocated to the original payment');

-- refund cycle → FULL payout
select pg_temp.login('a9000000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select update_refund_details(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 'transfer', 'هيلة اليامي', 'SA12', 'الراجحي')$$,
  'الآيبان', 'an invalid IBAN is rejected');
select update_refund_details(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 'transfer', 'هيلة اليامي',
  'SA03 8000 0000 6080 1016 7519', 'مصرف الراجحي');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 'submit');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000002');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 'review');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000003');
select pg_temp.rejects($$select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 3450, 'RF-TRF-1', current_date)$$,
  'معتمد', 'no payout before approval');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 'approve');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 'queue');
select pg_temp.rejects($$select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 3451, 'RF-TRF-1', current_date)$$,
  'يتجاوز', 'cannot pay more than the refund');
select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 3450, 'RF-TRF-1', current_date);
select pg_temp.rejects($$select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000b'), 1, 'RF-TRF-2', current_date)$$,
  'لا يُصرف', 'a fully refunded request cannot be paid again');
select pg_temp.logout();
select pg_temp.check((select status = 'refunded' and paid_total = 3450 from refunds
                       where id = pg_temp.rid('d9000000-0000-0000-0000-00000000000b')), 'fully refunded');
select pg_temp.check((select count(*) = 1 from journal_entries e join refund_payouts p on e.id = p.journal_entry_id
                       where p.refund_id = pg_temp.rid('d9000000-0000-0000-0000-00000000000b')),
  'one payout entry');

-- ================= scenario: return + cancel AFTER start (A) =================
-- delivered 2026-10-01, returned on 2026-10-10 → 10 days × 200 = 2,000 (البند الثالث/10)
select pg_temp.login('a9000000-0000-0000-0000-000000000001');
select request_worker_return('d9000000-0000-0000-0000-00000000000a', '2026-10-10', 'early_cancel', 'رغبة العميل');
select pg_temp.rejects($$select worker_return_step((select id from worker_returns where contract_id = 'd9000000-0000-0000-0000-00000000000a'), 'ready')$$,
  'بعد الاستلام', 'readiness only after physical receipt');
select worker_return_step((select id from worker_returns where contract_id = 'd9000000-0000-0000-0000-00000000000a'),
  'receive', '2026-10-10', 'good', 'استُلمت في مقر الشركة');
select pg_temp.check((select status from worker_profiles where id = 'f9000000-0000-0000-0000-000000000001') = 'returning',
  'received but not yet available');
select pg_temp.rejects($$select worker_return_step((select id from worker_returns where contract_id = 'd9000000-0000-0000-0000-00000000000a'), 'ready')$$,
  'سوِّ العقد', 'not available while the contract is still active');

select prepare_contract_settlement('d9000000-0000-0000-0000-00000000000a', '2026-10-10', 'customer_request', null,
  '[{"label":"رسوم توصيل العاملة","amount":50,"clause_ref":"البند الثالث/11"}]'::jsonb,
  (select id from worker_returns where contract_id = 'd9000000-0000-0000-0000-00000000000a'));
select pg_temp.check((select kind = 'return' and days_used = 10 and service_due = 2000 and fees_total = 50
                         and balance = 4850 and due_basis = 'contract_term' and due_basis_ref = 'البند الثالث/10'
                        from contract_settlements where id = pg_temp.sid('d9000000-0000-0000-0000-00000000000a')),
  'after start: 10 days × 200 from the contract term + a 50 fee with its clause → 4,850 back');
select pg_temp.rejects($$select compute_contract_settlement('d9000000-0000-0000-0000-00000000000a', '2026-10-10',
                          '[{"label":"غرامة","amount":100}]'::jsonb)$$,
  'بند', 'a fee without a clause is refused');
select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000a'), 'submit');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000002');
select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000a'), 'review');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000003');
select settlement_step(pg_temp.sid('d9000000-0000-0000-0000-00000000000a'), 'approve');
select settle_contract_settlement(pg_temp.sid('d9000000-0000-0000-0000-00000000000a'));
select pg_temp.logout();
-- obligation 2,050 of 6,900 → credit note 4,850
select pg_temp.check((select sum(l.credit) = 4850 from journal_entry_lines l join journal_entries e on e.id = l.entry_id
                       join chart_of_accounts a on a.id = l.account_id
                      where e.idempotency_key = 'ST-' || pg_temp.sid('d9000000-0000-0000-0000-00000000000a') and a.code = '1120'),
  'credit note = contract value − (service due + fees)');
select pg_temp.check((select count(*) = 1 from journal_entries
                      where idempotency_key = 'ST-' || pg_temp.sid('d9000000-0000-0000-0000-00000000000a')),
  'no duplicate settlement entry');

-- readiness is now allowed → available
select pg_temp.login('a9000000-0000-0000-0000-000000000001');
select worker_return_step((select id from worker_returns where contract_id = 'd9000000-0000-0000-0000-00000000000a'), 'ready');
select pg_temp.logout();
select pg_temp.check((select status from worker_profiles where id = 'f9000000-0000-0000-0000-000000000001') = 'available',
  'available only after receipt + readiness + settlement');

-- PARTIAL refund then the rest; duplicate transfer reference refused
select pg_temp.login('a9000000-0000-0000-0000-000000000001');
select update_refund_details(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 'transfer', 'فيصل آل سالم',
  'SA4420000001234567891234', 'البنك الأهلي');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 'submit');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000002');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 'review');
select pg_temp.logout();
select pg_temp.login('a9000000-0000-0000-0000-000000000003');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 'approve');
select refund_step(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 'queue');
select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 2000, 'RF-TRF-3', current_date);
select pg_temp.check((select status from refunds where id = pg_temp.rid('d9000000-0000-0000-0000-00000000000a'))
  = 'partially_refunded', 'partial payout');
select pg_temp.rejects($$select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 100, 'rf-trf-3 ', current_date)$$,
  'مسجّل مسبقاً', 'the same transfer reference cannot be used twice');
select record_refund_payout(pg_temp.rid('d9000000-0000-0000-0000-00000000000a'), 2850, 'RF-TRF-4', current_date);
select pg_temp.logout();
select pg_temp.check((select status = 'refunded' and paid_total = 4850 from refunds
                       where id = pg_temp.rid('d9000000-0000-0000-0000-00000000000a')), 'refunded in two transfers');

-- ledgers are frozen; nothing beyond what was collected
select pg_temp.rejects($$delete from refund_payouts$$, 'لا تُعدَّل', 'payout rows are frozen');
select pg_temp.rejects($$insert into refunds (settlement_id, contract_id, customer_id, amount)
                         values (pg_temp.sid('d9000000-0000-0000-0000-00000000000a'), 'd9000000-0000-0000-0000-00000000000a',
                                 'c9000000-0000-0000-0000-000000000001', 100)$$,
  'ux_refund_live', 'a second refund for the same settlement is refused');
select pg_temp.rejects($$update contract_ops_events set note = 'x'$$, 'لا يُعدَّل', 'the operations log is append-only');
select pg_temp.check((select count(*) >= 10 from contract_ops_events where contract_id = 'd9000000-0000-0000-0000-00000000000a'),
  'every step of A is in the operations log');

select 'OK 99q_settlements_refunds' as result;
