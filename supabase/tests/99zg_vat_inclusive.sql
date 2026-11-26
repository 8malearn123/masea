-- Tests for 0108: the entered (trial) price is VAT-inclusive — VAT is extracted, never added —
-- with the managed rate; the same figures flow to the contract, document, payments/remaining,
-- tax invoice (header + lines + ZATCA QR), sales and the journal; list-price contracts and earlier
-- records are unchanged; VAT is never applied twice.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values ('a1080000-0000-0000-0000-000000000001', 'bm108@test') on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a1080000-0000-0000-0000-000000000001', 'مانع آل سدران', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into customers (id, full_name, phone, national_id, branch_id, city) values
  ('c1080000-0000-0000-0000-000000000001', 'حمد آل مسعود', '0551238001', '1081234567', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f1080000-0000-0000-0000-000000000001', 'ليزا مارتينيز', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f1080000-0000-0000-0000-000000000002', 'سانجا بيريرا', 'سريلانكا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f1080000-0000-0000-0000-000000000003', 'روز ماري', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
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
create or replace function pg_temp.fields(p_paid numeric) returns jsonb language sql as $$
  select jsonb_build_object('customer_nationality', 'سعودي', 'id_kind', 'بطاقة', 'id_number', '1081234567',
    'id_issue_date', '1442/01/10', 'id_issue_place', 'نجران', 'worker_kind', 'العاملة',
    'sponsor_name', 'سالم بن علي آل منصور', 'city', 'نجران', 'daily_wage', 70, 'paid_amount', p_paid,
    'address', 'نجران - حي الفهد', 'job', 'موظف', 'mobile', '0551238001')
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- 1) the split rule (managed rate, exact to the halala) ----------
do $$
declare s record; t numeric;
begin
  select * into s from vat_split_inclusive(1000);
  perform pg_temp.check(s.net = 869.57 and s.vat = 130.43 and s.total = 1000.00, '1,000 → 869.57 + 130.43');
  for t in select generate_series(1, 5000) / 7.0 loop   -- many awkward amounts
    select * into s from vat_split_inclusive(t);
    if s.net + s.vat <> round(t, 2) or s.vat < 0 or abs(s.vat - round(s.net * 0.15, 2)) > 0.01 then
      raise exception 'FAIL: split of % → % + %', t, s.net, s.vat;
    end if;
  end loop;
end $$;
begin;   -- the managed rate is used (no fixed 15% in the formula)
update pricing_config set vat_rate = 0.05 where id = 1;
select pg_temp.check((select net = 952.38 and vat = 47.62 from vat_split_inclusive(1000)), 'uses pricing_config.vat_rate');
rollback;

-- ---------- 2) trials: full / partial / no payment ----------
select pg_temp.login('a1080000-0000-0000-0000-000000000001');
create temp table t_full as select * from create_trial_agreement('c1080000-0000-0000-0000-000000000001',
  'f1080000-0000-0000-0000-000000000001', 'نجران', 1000, 10, current_date + 1, pg_temp.fields(1000));
create temp table t_part as select * from create_trial_agreement('c1080000-0000-0000-0000-000000000001',
  'f1080000-0000-0000-0000-000000000002', 'نجران', 1000, 10, current_date + 20, pg_temp.fields(400));
create temp table t_none as select * from create_trial_agreement('c1080000-0000-0000-0000-000000000001',
  'f1080000-0000-0000-0000-000000000003', 'نجران', 2500, 7, current_date + 40, pg_temp.fields(0));
select pg_temp.logout();
do $$
declare k contracts; t trial_agreements; d jsonb;
begin
  select * into t from t_full;
  select * into k from contracts where id = t.contract_id;
  perform pg_temp.check(k.total_amount = 1000 and k.base_amount = 869.57 and k.vat_amount = 130.43 and k.vat_inclusive
                        and k.gross_amount = 869.57 and k.discount_amount = 0, 'contract: total = entered, VAT extracted');
  perform pg_temp.check(t.price = 869.57 and t.vat_amount = 130.43 and t.total_amount = 1000, 'trial row = contract');
  d := trial_document(t.id);
  perform pg_temp.check((d->>'total_amount')::numeric = 1000 and (d->'fields'->>'paid_amount')::numeric = 1000,
                        'document: total 1,000, paid 1,000 (remaining 0)');
  select * into k from contracts where id = (select contract_id from t_none);
  perform pg_temp.check(k.total_amount = 2500 and k.base_amount = 2173.91 and k.vat_amount = 326.09, '2,500 → 2,173.91 + 326.09');
end $$;
-- the server refuses paid > the inclusive total (1,000 — not 1,150)
select pg_temp.login('a1080000-0000-0000-0000-000000000001');
do $$
begin
  perform create_trial_agreement('c1080000-0000-0000-0000-000000000001', 'f1080000-0000-0000-0000-000000000001',
    'نجران', 1000, 5, current_date + 60, pg_temp.fields(1150));
  raise exception 'FAIL: paid 1,150 > 1,000 accepted';
exception when others then
  if sqlerrm not like '%أكبر من المبلغ الإجمالي%' then raise; end if;
end $$;
select pg_temp.logout();

-- recorded payments → amount_paid / remaining
insert into payments (contract_id, amount, method, reference_no) values
  ((select contract_id from t_full), 1000, 'cash', 'VAT-T-1'),
  ((select contract_id from t_part), 400, 'cash', 'VAT-T-2');
select pg_temp.check((select amount_paid = 1000 and total_amount - amount_paid = 0 from contracts where id = (select contract_id from t_full)), 'full: remaining 0');
select pg_temp.check((select amount_paid = 400 and total_amount - amount_paid = 600 from contracts where id = (select contract_id from t_part)), 'partial: remaining 600');
select pg_temp.check((select amount_paid = 0 and total_amount - amount_paid = 2500 from contracts where id = (select contract_id from t_none)), 'unpaid: remaining 2,500');

-- ---------- 3) signing → tax invoice, lines, QR, sales, journal ----------
select pg_temp.login('a1080000-0000-0000-0000-000000000001');
select sign_contract_party((select contract_id from t_full), 'customer', 'حمد آل مسعود', '1081234567', 'data:image/png;base64,' || repeat('A', 300));
select sign_contract_party((select contract_id from t_full), 'company', null, null, 'data:image/png;base64,' || repeat('B', 300));
select pg_temp.logout();
do $$
declare k contracts; i invoices; l invoice_lines; v_cid uuid := (select contract_id from t_full);
begin
  select * into k from contracts where id = v_cid;
  perform pg_temp.check(k.status::text = 'signed' and k.total_amount = 1000, 'signed; amounts unchanged by signing');
  select * into i from invoices where contract_id = v_cid and status <> 'void';
  perform pg_temp.check(i.subtotal = 869.57 and i.vat_amount = 130.43 and i.total = 1000 and i.status = 'paid', 'invoice header = contract');
  select * into l from invoice_lines where invoice_id = i.id;
  perform pg_temp.check(l.unit_price = 869.57 and l.vat_rate = 0.15 and l.line_subtotal = 869.57 and l.line_vat = 130.43
                        and l.line_total = 1000.00, 'invoice line: 15% and the extracted VAT (not 130.44 / 1,000.01)');
  perform pg_temp.check((select sum(line_vat) from invoice_lines where invoice_id = i.id) = i.vat_amount, 'lines VAT = header VAT (ZATCA rule)');
  perform pg_temp.check(i.zatca_qr = zatca_qr_tlv(i.issued_at, 1000, 130.43), 'QR carries 1,000 / 130.43');
  perform pg_temp.check((select count(*) from sales where contract_id = v_cid and net_amount = 869.57 and vat_amount = 130.43
                           and total_amount = 1000) = 1 or not exists (select 1 from sales where contract_id = v_cid),
                        'sales record (if any) matches the contract');
  perform pg_temp.check(exists (select 1 from journal_entries where idempotency_key = 'CS-' || v_cid and status = 'posted'),
                        'signing posted a journal entry');
  perform pg_temp.check((select sum(jl.debit) = sum(jl.credit) and sum(jl.debit) = 1000 and bool_or(jl.debit = 1000)
                           from journal_entry_lines jl join journal_entries e on e.id = jl.entry_id
                          where e.idempotency_key = 'CS-' || v_cid), 'journal: 1,000 receivable = 869.57 revenue + 130.43 VAT (not 1,150)');
  perform pg_temp.check((select bool_or(jl.credit = 869.57) and bool_or(jl.credit = 130.43)
                           from journal_entry_lines jl join journal_entries e on e.id = jl.entry_id
                          where e.idempotency_key = 'CS-' || v_cid), 'journal revenue and VAT lines');
end $$;

-- ---------- 4) no double VAT on edits; list-price and earlier contracts unchanged ----------
update contracts set total_amount = 2000 where id = (select contract_id from t_part);
select pg_temp.check((select base_amount = 1739.13 and vat_amount = 260.87 and total_amount = 2000 from contracts
                       where id = (select contract_id from t_part)), 'editing the inclusive total re-extracts (no VAT on VAT)');
update contracts set vat_amount = 999 where id = (select contract_id from t_part);
select pg_temp.check((select vat_amount = 260.87 and total_amount = 2000 from contracts where id = (select contract_id from t_part)),
  'VAT cannot be overwritten by hand');
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date) values
  ('d1080000-0000-0000-0000-000000000009', 'c1080000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 1000, 'draft', 'MR-108-9', current_date, current_date + 30);
select pg_temp.check((select vat_amount = 150 and total_amount = 1150 and not vat_inclusive from contracts
                       where id = 'd1080000-0000-0000-0000-000000000009'), 'list-price contract: net 1,000 + VAT 150 (unchanged rule)');
select pg_temp.check(not exists (select 1 from invoice_lines where line_vat_fixed is null
                                   and line_vat <> round(qty * unit_price * vat_rate, 2)), 'earlier invoice lines compute as before');

select 'OK 99zg_vat_inclusive' as result;
