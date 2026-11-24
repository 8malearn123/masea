-- Tests for 0097: one tax invoice per contract at signing (no second revenue entry),
-- ZATCA phase-1 QR, invoice paid status follows payments, manual credit/debit notes
-- with limits and postings, notes are immutable, permissions.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9700000-0000-0000-0000-000000000001', 'admin97@test'),
  ('a9700000-0000-0000-0000-000000000002', 'sales97@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9700000-0000-0000-0000-000000000001', 'عبدالله الشهراني', 'admin', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9700000-0000-0000-0000-000000000002', 'ريم آل حيدر', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9700000-0000-0000-0000-000000000001', 'مبارك آل سالم', '0551239710', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into company_tax_profile (id, seller_name, vat_number, city)
values (1, 'شركة ماسية الشرق للاستقدام', '310123456700003', 'نجران')
on conflict (id) do update set seller_name = excluded.seller_name, vat_number = excluded.vat_number;
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date)
values ('d9700000-0000-0000-0000-00000000000a', 'c9700000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
        'monthly_rental', 6000, 'approved', 'MR-97-A', current_date, current_date + 90)
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


select pg_temp.login('a9700000-0000-0000-0000-000000000001');
select pg_temp.rejects($q$ select issue_contract_invoice('d9700000-0000-0000-0000-00000000000a') $q$, 'بعد توقيع', 'invoice before signing');
select pg_temp.logout();
-- signing (its own flow) → the invoice is issued automatically
update contracts set status = 'signed' where id = 'd9700000-0000-0000-0000-00000000000a';
select pg_temp.login('a9700000-0000-0000-0000-000000000001');
do $$
declare v_c uuid := 'd9700000-0000-0000-0000-00000000000a'; v_inv invoices%rowtype; v_rev_entries int;
        v_cn uuid; v_dn uuid; v_qr bytea;
begin
  select * into v_inv from invoices where contract_id = v_c;
  perform pg_temp.check(v_inv.id is not null, 'auto invoice at signing');
  perform pg_temp.check(v_inv.total = 6900 and v_inv.vat_amount = 900 and v_inv.subtotal = 6000, 'invoice = contract amounts');
  perform pg_temp.check(v_inv.invoice_type = 'simplified', 'B2C simplified invoice');
  perform pg_temp.check((select count(*) from invoice_lines where invoice_id = v_inv.id) = 1, 'one line');
  -- QR TLV decodes to seller, VAT no., total, vat
  v_qr := decode(v_inv.zatca_qr, 'base64');
  perform pg_temp.check(position(convert_to('310123456700003', 'UTF8') in v_qr) > 0, 'QR carries VAT no.');
  perform pg_temp.check(position(convert_to('6900.00', 'UTF8') in v_qr) > 0, 'QR carries total');
  perform pg_temp.check(get_byte(v_qr, 0) = 1, 'QR starts with tag 1');
  -- idempotent, no second invoice, no second revenue entry
  perform pg_temp.check(issue_contract_invoice(v_c) = v_inv.id, 'second issue returns the same invoice');
  select count(*) into v_rev_entries from journal_entries where source_id in (v_c, v_inv.id) and source_type in ('contract','manual');
  perform pg_temp.check(v_rev_entries = 1, 'revenue posted once (contract only)');
  perform pg_temp.rejects($q$ select issue_contract_invoice_core('d9700000-0000-0000-0000-00000000000a') $q$,
    'permission denied', 'core function is not callable');

  -- payments drive the invoice status
  perform record_contract_payment(v_c, 3000, 'cash', current_date);
  perform pg_temp.check((select status from invoices where id = v_inv.id) = 'partial', 'invoice partial');
  perform record_contract_payment(v_c, 3900, 'cash', current_date);
  perform pg_temp.check((select status from invoices where id = v_inv.id) = 'paid', 'invoice paid');

  -- credit note: limits, posting, immutability
  perform pg_temp.rejects(format($q$ select issue_contract_note(%L, 'credit', 99999, 'خصم استثنائي معتمد') $q$, v_c),
    'يتجاوز', 'credit beyond invoice');
  perform pg_temp.rejects(format($q$ select issue_contract_note(%L, 'credit', 100, 'x') $q$, v_c), 'سبب', 'reason required');
  v_cn := issue_contract_note(v_c, 'credit', 1150, 'تعويض أيام غياب العاملة');
  perform pg_temp.check((select subtotal from sales_credit_notes where id = v_cn) = 1000
                     and (select vat_amount from sales_credit_notes where id = v_cn) = 150, 'credit split net/vat');
  perform pg_temp.check((select sum(l.debit) = sum(l.credit) from sales_credit_notes n
     join journal_entry_lines l on l.entry_id = n.journal_entry_id where n.id = v_cn), 'credit entry balanced');
  v_dn := issue_contract_note(v_c, 'debit', 230, 'رسوم نقل إضافية بطلب العميل');
  perform pg_temp.check((select total from sales_debit_notes where id = v_dn) = 230, 'debit note');
  perform pg_temp.check(invoice_net_total(v_inv.id) = 6900 - 1150 + 230, 'net after notes');
  perform pg_temp.check((select count(*) from contract_tax_documents(v_c)) = 3, 'contract tax documents');
end $$;

select pg_temp.logout();
select pg_temp.rejects($q$ update sales_debit_notes set reason = 'تعديل' $q$, 'لا يُعدَّل', 'debit note edited');
select pg_temp.rejects($q$ delete from sales_debit_notes $q$, 'لا يُحذف', 'debit note deleted');
select pg_temp.rejects($q$ insert into invoices (contract_id, subtotal, vat_amount, total, status)
                         values ('d9700000-0000-0000-0000-00000000000a', 1, 0, 1, 'issued') $q$,
  'invoices_one_per_contract', 'second active invoice for a contract');
-- the auto invoice can be switched off from settings
update app_config set value = 0 where key = 'contract_auto_invoice';
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date)
values ('d9700000-0000-0000-0000-00000000000b', 'c9700000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
        'daily_rental', 1000, 'approved', 'DR-97-B', current_date, current_date + 5);
update contracts set status = 'signed' where id = 'd9700000-0000-0000-0000-00000000000b';
select pg_temp.check(not exists (select 1 from invoices where contract_id = 'd9700000-0000-0000-0000-00000000000b'), 'auto invoice disabled');
update app_config set value = 1 where key = 'contract_auto_invoice';

select pg_temp.login('a9700000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select issue_contract_note('d9700000-0000-0000-0000-00000000000a', 'credit', 10, 'خصم بلا صلاحية') $$,
  'صلاحية', 'sales issues a credit note');
select pg_temp.rejects($$ select issue_contract_invoice('d9700000-0000-0000-0000-00000000000b') $$,
  'صلاحية', 'sales issues an invoice');
select pg_temp.logout();

select 'OK 99x_contract_tax_invoices' as result;
