-- Tests for 0107: e-signature on every contract type through sign_contract_party — approval first
-- (internal), per-party permissions, customer identity vs. file (or documented agent), one signature
-- per party, content fingerprint shared by both, automatic «signed», audit, no direct inserts, signed
-- content frozen, Musaned contracts keep their track, trial in-person signing = acceptance.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a1070000-0000-0000-0000-000000000001', 'bm107@test'),
  ('a1070000-0000-0000-0000-000000000002', 'sales107@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a1070000-0000-0000-0000-000000000001', 'مانع آل سدران', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a1070000-0000-0000-0000-000000000002', 'لمى آل سالم', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into customers (id, full_name, phone, national_id, branch_id, city) values
  ('c1070000-0000-0000-0000-000000000001', 'سعيد آل منصور', '0551237001', '1087654321', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f1070000-0000-0000-0000-000000000001', 'آنا ريس', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do nothing;
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date) values
  ('d1070000-0000-0000-0000-000000000001', 'c1070000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'monthly_rental', 3000, 'draft', 'MR-107-1', current_date, current_date + 30),
  ('d1070000-0000-0000-0000-000000000002', 'c1070000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'daily_rental', 500, 'approved', 'DR-107-2', current_date, current_date + 3),
  ('d1070000-0000-0000-0000-000000000003', 'c1070000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'recruitment', 15000, 'draft', 'RC-107-3', current_date, current_date + 720),
  ('d1070000-0000-0000-0000-000000000004', 'c1070000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'hourly_rental', 200, 'approved', 'HR-107-4', current_date, current_date),
  ('d1070000-0000-0000-0000-000000000005', 'c1070000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'monthly_rental', 3000, 'awaiting_signature', 'MR-107-5', current_date, current_date + 30)
on conflict (id) do nothing;
insert into contract_clauses (contract_id, sort_order, body) values
  ('d1070000-0000-0000-0000-000000000001', 1, 'البند الأول كما هو في القالب المعتمد.'),
  ('d1070000-0000-0000-0000-000000000002', 1, 'البند الأول كما هو في القالب المعتمد.')
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
create or replace function pg_temp.png(p text default 'A') returns text language sql as
$$ select 'data:image/png;base64,' || repeat(p, 400) $$;
create or replace function pg_temp.st(p uuid) returns text language sql as $$ select status::text from contracts where id = p $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- 1) internal: approval first, then per party ----------
select pg_temp.login('a1070000-0000-0000-0000-000000000002');   -- sales: contracts.edit, no approve
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000001', 'customer', 'سعيد آل منصور', '1087654321', pg_temp.png())$$,
  'بعد اعتماده', 'a draft is not signed before approval');
select pg_temp.rejects($$insert into contract_signatures (contract_id, signer_type, signer_name) values ('d1070000-0000-0000-0000-000000000002', 'customer', 'x')$$,
  'row-level security', 'no direct inserts');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000002', 'customer', 'سعيد آل منصور', '1087654321', 'data:image/png;base64,AA')$$,
  'ارسم التوقيع', 'an empty pad is refused');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000002', 'customer', 'شخص آخر', '1011111111', pg_temp.png())$$,
  'لا يطابق ملف العميل', 'staff cannot sign for the customer with another ID');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000002', 'customer', 'شخص آخر', '1011111111', pg_temp.png(), null, null, 'agent', '')$$,
  'رقم الوكالة', 'an agent needs a documented power of attorney');
select pg_temp.check((sign_contract_party('d1070000-0000-0000-0000-000000000002', 'customer', 'سعيد آل منصور', '1087654321', pg_temp.png('C'),
                      '203.0.113.7', 'Mozilla/5.0 (iPhone)')->>'complete')::boolean = false, 'customer signed; company pending');
select pg_temp.check(pg_temp.st('d1070000-0000-0000-0000-000000000002') = 'awaiting_signature', 'approved → awaiting signature on the first signature');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000002', 'customer', 'سعيد آل منصور', '1087654321', pg_temp.png())$$,
  'سبق توقيع هذا الطرف', 'one signature per party');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000002', 'company', null, null, pg_temp.png())$$,
  'صلاحية اعتماد', 'the company signature needs contracts.approve');
select pg_temp.login('a1070000-0000-0000-0000-000000000001');   -- branch manager
select pg_temp.check((sign_contract_party('d1070000-0000-0000-0000-000000000002', 'company', 'يُتجاهل', null, pg_temp.png('D'), '203.0.113.8')->>'complete')::boolean,
  'both signed');
select pg_temp.logout();
do $$
declare c contract_signatures; k contract_signatures;
begin
  perform pg_temp.check(pg_temp.st('d1070000-0000-0000-0000-000000000002') = 'signed', 'auto → signed');
  select * into c from contract_signatures where contract_id = 'd1070000-0000-0000-0000-000000000002' and signer_type = 'customer';
  select * into k from contract_signatures where contract_id = 'd1070000-0000-0000-0000-000000000002' and signer_type = 'company';
  perform pg_temp.check(c.document_sha256 = k.document_sha256 and length(c.document_sha256) = 64, 'same content fingerprint');
  perform pg_temp.check(c.document_sha256 = contract_content_sha256('d1070000-0000-0000-0000-000000000002'), 'fingerprint = signed content');
  perform pg_temp.check(c.signer_capacity = 'العميل (الطرف الثاني)' and c.method = 'in_person' and c.national_id = '1087654321'
                        and c.ip_address = '203.0.113.7' and c.user_agent like 'Mozilla%' and c.signature_image like 'data:image/png;base64,%'
                        and c.signed_by = 'a1070000-0000-0000-0000-000000000002' and c.image_sha256 is not null, 'customer record');
  perform pg_temp.check(k.signer_name = 'مانع آل سدران' and k.signer_capacity like 'ممثل الشركة (الطرف الأول)%' and k.national_id is null, 'company record = the signing manager');
  perform pg_temp.check((select count(*) from audit_log where action = 'contract.sign' and record_id = 'd1070000-0000-0000-0000-000000000002') = 2, 'each signature audited');
  perform pg_temp.check((select count(*) from contract_status_history where contract_id = 'd1070000-0000-0000-0000-000000000002' and to_status = 'signed') = 1, 'status history');
  perform pg_temp.check((select count(*) from audit_log where action = 'contract.transition' and record_id = 'd1070000-0000-0000-0000-000000000002') = 2, 'transitions audited');
  -- another contract has another fingerprint: a signature can't stand for a different contract
  perform pg_temp.check(contract_content_sha256('d1070000-0000-0000-0000-000000000001') <> c.document_sha256, 'per-contract fingerprint');
end $$;

-- ---------- 2) signed = frozen ----------
select pg_temp.rejects($$update contracts set base_amount = 1 where id = 'd1070000-0000-0000-0000-000000000002'$$, 'نسخة جديدة', 'signed amounts frozen (even as owner)');
select pg_temp.rejects($$update contract_clauses set body = 'تعديل' where contract_id = 'd1070000-0000-0000-0000-000000000002'$$, 'نسخة جديدة', 'signed clauses frozen');
select pg_temp.rejects($$delete from contract_signatures where contract_id = 'd1070000-0000-0000-0000-000000000002'$$, 'غير قابل', 'signatures cannot be deleted');
select pg_temp.login('a1070000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000002', 'company', null, null, pg_temp.png())$$, 'العقد موقّع', 'no signing a signed contract');
select pg_temp.logout();

-- ---------- 3) content changed between the two signatures → refused ----------
select pg_temp.login('a1070000-0000-0000-0000-000000000002');
select sign_contract_party('d1070000-0000-0000-0000-000000000005', 'customer', 'وكيل العميل', '1099999999', pg_temp.png('E'), null, null, 'agent', 'وكالة 4410123');
select pg_temp.logout();
select pg_temp.check((select signer_capacity like 'وكيل عن العميل%' and poa_no = 'وكالة 4410123' and method = 'agent'
                        from contract_signatures where contract_id = 'd1070000-0000-0000-0000-000000000005'), 'agent signature recorded with the POA');
update contracts set base_amount = 3100 where id = 'd1070000-0000-0000-0000-000000000005';
select pg_temp.login('a1070000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select sign_contract_party('d1070000-0000-0000-0000-000000000005', 'company', null, null, pg_temp.png())$$,
  'تغيّر محتوى العقد', 'content changed after the first signature');
select pg_temp.check(pg_temp.st('d1070000-0000-0000-0000-000000000005') = 'awaiting_signature', 'not signed');

-- ---------- 4) every type: hourly (internal), recruitment (Musaned), trial ----------
select sign_contract_party('d1070000-0000-0000-0000-000000000004', 'customer', 'سعيد آل منصور', '1087654321', pg_temp.png());
select sign_contract_party('d1070000-0000-0000-0000-000000000004', 'company', null, null, pg_temp.png('F'));
select pg_temp.check(pg_temp.st('d1070000-0000-0000-0000-000000000004') = 'signed', 'hourly signed');
select sign_contract_party('d1070000-0000-0000-0000-000000000003', 'customer', 'سعيد آل منصور', '1087654321', pg_temp.png());
select sign_contract_party('d1070000-0000-0000-0000-000000000003', 'company', null, null, pg_temp.png('G'));
select pg_temp.check(pg_temp.st('d1070000-0000-0000-0000-000000000003') = 'draft'
                     and (select count(*) from contract_signatures where contract_id = 'd1070000-0000-0000-0000-000000000003') = 2,
  'recruitment: office copy signed, the Musaned track is untouched');
create temp table t_tr as select id, contract_id from create_trial_agreement('c1070000-0000-0000-0000-000000000001',
  'f1070000-0000-0000-0000-000000000001', 'نجران', 1800, 10, current_date + 40);
select sign_contract_party((select contract_id from t_tr), 'customer', 'سعيد آل منصور', '1087654321', pg_temp.png());
select sign_contract_party((select contract_id from t_tr), 'company', null, null, pg_temp.png('H'));
select pg_temp.logout();
select pg_temp.check(pg_temp.st((select contract_id from t_tr)) = 'signed'
                     and (select status = 'awaiting_handover' and accepted_at is not null from trial_agreements where id = (select id from t_tr)),
  'trial: in-person signing = acceptance → awaiting the regulatory handover');

select 'OK 99zf_contract_esignature' as result;
