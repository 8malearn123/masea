-- Tests for 0096: packages through calc_price (no change to generic prices), bank account
-- options (masked IBAN), contract payments with receiving account/transaction no/status,
-- posting to the chosen bank account, bounce = reversal, installments allocation.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9600000-0000-0000-0000-000000000001', 'acc96@test'),
  ('a9600000-0000-0000-0000-000000000002', 'sales96@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9600000-0000-0000-0000-000000000001', 'فهد القحطاني', 'admin', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9600000-0000-0000-0000-000000000002', 'نورة اليامي', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9600000-0000-0000-0000-000000000001', 'حمد آل منصور', '0551239610', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date)
values ('d9600000-0000-0000-0000-00000000000a', 'c9600000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
        'monthly_rental', 6000, 'active', 'MR-96-A', current_date - 10, current_date + 80)
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


-- ---------- packages --------------------------------------------------------------
do $$
declare v_generic jsonb; v_pkg uuid; v_after jsonb; v_p jsonb;
begin
  v_generic := calc_price('monthly_rental', '{"nationality":"الفلبين","quantity":3}');
  insert into pricing_rules (service_code, nationality, duration_unit, base_price, min_price, package_name, duration_count)
  values ('monthly_rental', 'الفلبين', 'month', 1500, 1400, 'باقة ستة أشهر', 6) returning id into v_pkg;
  -- a cheaper package must not leak into the generic price
  v_after := calc_price('monthly_rental', '{"nationality":"الفلبين","quantity":3}');
  perform pg_temp.check(v_after->>'base' = v_generic->>'base', 'package changed the generic price');
  v_p := calc_price('monthly_rental', jsonb_build_object('nationality','الفلبين','quantity',1,'package_id',v_pkg));
  perform pg_temp.check((v_p->>'base')::numeric = 9000 and (v_p->>'quantity')::numeric = 6, 'package price = unit × duration');
  perform pg_temp.check(v_p->>'package_name' = 'باقة ستة أشهر', 'package name returned');
  perform pg_temp.check((select count(*) from pricing_packages('monthly_rental', 'الفلبين', null)) = 1, 'packages list');
  perform pg_temp.check((select count(*) from pricing_packages('monthly_rental', 'كينيا', null)) = 0, 'package nationality filter');
  begin
    perform calc_price('daily_rental', jsonb_build_object('quantity',1,'package_id',v_pkg));
    raise exception 'FAIL: package used for another service';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- ---------- bank accounts ------------------------------------------------------------
select pg_temp.rejects($$ insert into bank_accounts (name, account_code, iban) values ('خطأ', '1113', 'SA12') $$,
  'bank_accounts_iban_check', 'invalid IBAN accepted');

select pg_temp.login('a9600000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select * from bank_account_options() $$, 'صلاحية', 'sales without payments perm sees accounts');
select pg_temp.rejects($$ select upsert_bank_account(null, 'حساب', 'بنك', null, null, null, 'SAR', null, '1112') $$,
  'صلاحية', 'sales manages bank accounts');

select pg_temp.login('a9600000-0000-0000-0000-000000000001');
do $$
declare v_bank uuid;
begin
  perform pg_temp.check((select count(*) from bank_account_options() where not is_cash) >= 2, 'bank options listed');
  v_bank := upsert_bank_account(null, 'حساب التحصيل - نجران', 'مصرف الإنماء', 'شركة ماسية الشرق للاستقدام',
                                'sa 05 0500 0068 2010 0000 1234', '68201000001234', 'sar', 'نجران', null);
  perform pg_temp.check((select a.parent_id = (select id from chart_of_accounts where code = '1110')
     from bank_accounts b join chart_of_accounts a on a.code = b.account_code where b.id = v_bank), 'chart leaf created under 1110');
  perform pg_temp.check((select iban from bank_accounts where id = v_bank) = 'SA0505000068201000001234', 'IBAN normalized');
  perform pg_temp.check((select branch_id from bank_accounts where id = v_bank) = 'b0000000-0000-0000-0000-00000000000a', 'branch resolved');
  perform pg_temp.rejects(format($q$ select upsert_bank_account(%L, 'حساب', 'بنك', null, 'SA1', null, 'SAR', null, '1113') $q$, v_bank),
    'الآيبان', 'bad IBAN on update');
  perform upsert_bank_account(v_bank, 'حساب التحصيل - نجران', 'مصرف الإنماء', 'شركة ماسية الشرق للاستقدام',
                              'SA0505000068201000001234', '68201000001234', 'SAR', 'نجران', (select account_code from bank_accounts where id = v_bank), false);
  perform pg_temp.check(not exists (select 1 from bank_account_options() where id = v_bank), 'disabled account hidden');
  perform upsert_bank_account(v_bank, 'حساب التحصيل - نجران', 'مصرف الإنماء', null,
                              'SA0505000068201000001234', null, 'SAR', 'نجران', (select account_code from bank_accounts where id = v_bank), true);
end $$;

-- ---------- installments + payments -------------------------------------------------
do $$
declare v_c uuid := 'd9600000-0000-0000-0000-00000000000a'; v_bank uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
        v_total numeric;
begin
  select total_amount into v_total from contracts where id = v_c;  -- 6900
  perform pg_temp.rejects(format($q$ select set_contract_installments(%L, '[{"due_date":"2030-01-01","amount":100}]') $q$, v_c),
    'لا يساوي', 'installments must sum to the total');
  perform set_contract_installments(v_c, jsonb_build_array(
    jsonb_build_object('due_date', current_date - 10, 'amount', 2300),
    jsonb_build_object('due_date', current_date + 20, 'amount', 2300),
    jsonb_build_object('due_date', current_date + 50, 'amount', 2300)));
  perform pg_temp.check((select count(*) from contract_installments_v where contract_id = v_c and status = 'overdue') = 1, 'first installment overdue');

  select id into v_bank from bank_accounts where name = 'حساب التحصيل - نجران';
  perform pg_temp.rejects(format($q$ select record_contract_payment(%L, 100, 'transfer', current_date) $q$, v_c),
    'الحساب البنكي', 'transfer without receiving account');
  perform pg_temp.rejects(format($q$ select record_contract_payment(%L, 100, 'transfer', current_date, %L) $q$, v_c, v_bank),
    'رقم عملية', 'transfer without transaction no');
  perform pg_temp.rejects(format($q$ select record_contract_payment(%L, 99999, 'cash', current_date) $q$, v_c),
    'يتجاوز', 'over the remaining');

  v_p1 := record_contract_payment(v_c, 3000, 'transfer', current_date, v_bank, 'TRX-778812', null, 'received');
  perform pg_temp.check((select amount_paid from contracts where id = v_c) = 3000, 'paid updated');
  -- posted on the chosen account (1113), not the method default (1112)
  perform pg_temp.check(exists (select 1 from journal_entries e join journal_entry_lines l on l.entry_id = e.id
     join chart_of_accounts a on a.id = l.account_id
     join bank_accounts b on b.account_code = a.code
     where e.idempotency_key = 'PR-' || v_p1 and b.id = v_bank and l.debit = 3000), 'posted to chosen bank account');
  perform pg_temp.check((select status from contract_installments_v where contract_id = v_c and seq = 1) = 'paid', 'oldest first: #1 paid');
  perform pg_temp.check((select paid_amount from contract_installments where contract_id = v_c and seq = 2) = 700, 'oldest first: #2 partial');

  -- cheque pending clearance: not counted, not posted
  v_p2 := record_contract_payment(v_c, 1000, 'cash', current_date, null, null, 'شيك 5521', 'pending_clearance');
  perform pg_temp.check((select amount_paid from contracts where id = v_c) = 3000, 'pending not counted');
  perform pg_temp.check(not exists (select 1 from journal_entries where idempotency_key = 'PR-' || v_p2), 'pending not posted');
  perform pg_temp.rejects(format($q$ select record_contract_payment(%L, 2950, 'cash', current_date) $q$, v_c),
    'يتجاوز', 'pending counted against the remaining');
  perform set_payment_status(v_p2, 'received');
  perform pg_temp.check((select amount_paid from contracts where id = v_c) = 4000, 'cleared counted');
  perform pg_temp.check(exists (select 1 from journal_entries where idempotency_key = 'PR-' || v_p2), 'cleared posted');

  -- bounce: reversal entry, paid reduced, final
  perform pg_temp.rejects(format($q$ select set_payment_status(%L, 'bounced') $q$, v_p2), 'سبب', 'bounce needs a reason');
  perform set_payment_status(v_p2, 'bounced', 'الشيك بدون رصيد');
  perform pg_temp.check((select amount_paid from contracts where id = v_c) = 3000, 'bounced removed from paid');
  perform pg_temp.check((select sum(l.debit) - sum(l.credit) from journal_entries e join journal_entry_lines l on l.entry_id = e.id
     where e.idempotency_key in ('PR-' || v_p2, 'PRB-' || v_p2)) = 0, 'reversal balances the original');
  perform pg_temp.rejects(format($q$ select set_payment_status(%L, 'received') $q$, v_p2), 'لا يمكن', 'bounced is final');
  perform pg_temp.rejects(format($q$ delete from payments where id = %L $q$, v_p1), 'لا تُحذف', 'posted payment deleted');
  perform pg_temp.check((select paid_amount from contract_installments where contract_id = v_c and seq = 2) = 700, 'allocation follows bounce');
end $$;

select pg_temp.login('a9600000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select record_contract_payment('d9600000-0000-0000-0000-00000000000a', 10, 'cash', current_date) $$,
  'صلاحية', 'sales records a payment');
select pg_temp.logout();

select 'OK 99w_packages_payments' as result;
