-- Tests for 0106: «نقل كفالة» → the company's trial contract (contract_final_black.pdf) as the
-- approved template (10 clauses verbatim, locked), creation with the template's fields
-- (validated; ID/mobile from the customer file — filled if empty, never replaced), the
-- document for staff (scope) and the public page (ID masked), acceptance, and the regulatory
-- path kept (acceptance ≠ transfer). Runs before 99s (which approves its own terms version).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a1060000-0000-0000-0000-000000000001', 'bm106@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a1060000-0000-0000-0000-000000000001', 'مانع آل سدران', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into customers (id, full_name, phone, national_id, branch_id, city) values
  ('c1060000-0000-0000-0000-000000000001', 'سالم آل حيدر', '0551236606', '1076543210', 'b0000000-0000-0000-0000-00000000000a', 'نجران'),
  ('c1060000-0000-0000-0000-000000000002', 'هادي آل جابر', null, null, 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f1060000-0000-0000-0000-000000000001', 'ماريا سانتوس', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f1060000-0000-0000-0000-000000000002', 'راجو كومار', 'الهند', 'سائق خاص', 'b0000000-0000-0000-0000-00000000000a')
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
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, anon;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create or replace function pg_temp.fields(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('customer_nationality', 'سعودي', 'id_kind', 'بطاقة', 'id_number', '1076543210',
    'id_issue_date', '1440/05/12', 'id_issue_place', 'الأحوال المدنية بنجران', 'worker_kind', 'العاملة',
    'sponsor_name', 'علي بن محمد آل مريح', 'city', 'نجران', 'daily_wage', 60, 'paid_amount', 1000,
    'address', 'نجران - حي الفيصلية', 'job', 'معلم', 'mobile', '0551236606', 'customer_no', '000231') || p_extra
$$;

-- ---------- 1) the official template ----------
do $$
declare d jsonb;
begin
  select doc into d from contract_templates where template_code = 'transfer_trial_terms' and status = 'approved';
  perform pg_temp.check(d->>'layout' = 'trial_contract_black_v1' and d->>'title' = 'عقد تجربة', 'approved = the PDF');
  perform pg_temp.check(jsonb_array_length(d->'clauses') = 10, 'ten clauses');
  perform pg_temp.check(d->'clauses'->>1 = 'أتعهد بالمعاملة الحسنة وحسب تعاليم الدين الإسلامي الحنيف', 'clause 2 verbatim');
  perform pg_temp.check(d->'clauses'->>5 = 'في حالة انتهاء مدة التجربة على الكفيل الجديد مراجعة المكتب لاستلام الجواز والإقامة خلال شهر من تاريخه والمكتب غير مسؤول عن أي جواز أو الإقامة بعد شهر من تاريخه', 'clause 6 verbatim');
  perform pg_temp.check(d->'clauses'->>9 = 'أقر بعدم وجود خادمة على اسمي وفي حال وجود أكثر من خادمة يدفع رسوم إضافية للمعقب', 'clause 10 verbatim');
  perform pg_temp.check(d->>'declaration' = 'بهذا أقر بأنني قد قرأت الشروط أعلاه وعلى ما جاء فيها من بنود وموافق عليها موافقة غير مشروطة', 'declaration verbatim');
  perform pg_temp.check(d->'letterhead_ar'->>0 = 'شركة ماسية الشرق للاستقدام' and d->'footer'->>1 like 'Kingdom of Saudi Arabia - Najran%', 'letterhead & footer');
  perform pg_temp.check((select locked from contract_templates where template_code = 'transfer_trial_terms' and status = 'approved'), 'locked');
end $$;
select pg_temp.rejects($$update contract_templates set clauses = '["تعديل"]'::jsonb
                         where template_code = 'transfer_trial_terms' and status = 'approved'$$, 'لا يُعدَّل', 'template text locked');

-- ---------- 2) create with the template fields ----------
select pg_temp.login('a1060000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select create_trial_agreement('c1060000-0000-0000-0000-000000000001', 'f1060000-0000-0000-0000-000000000001',
  'نجران', 2000, 15, current_date, pg_temp.fields('{"sponsor_name": ""}'))$$, 'sponsor_name', 'missing current sponsor');
select pg_temp.rejects($$select create_trial_agreement('c1060000-0000-0000-0000-000000000001', 'f1060000-0000-0000-0000-000000000001',
  'نجران', 2000, 15, current_date, pg_temp.fields('{"id_kind": "جواز"}'))$$, 'بطاقة أو إقامة', 'id kind');
select pg_temp.rejects($$select create_trial_agreement('c1060000-0000-0000-0000-000000000001', 'f1060000-0000-0000-0000-000000000001',
  'نجران', 2000, 15, current_date, pg_temp.fields('{"daily_wage": 0}'))$$, 'أجر اليوم', 'daily wage required');
select pg_temp.rejects($$select create_trial_agreement('c1060000-0000-0000-0000-000000000001', 'f1060000-0000-0000-0000-000000000001',
  'نجران', 2000, 15, current_date, pg_temp.fields('{"id_number": "1011111111"}'))$$, 'يختلف عن ملف العميل', 'ID differs from the file');
select pg_temp.rejects($$select create_trial_agreement('c1060000-0000-0000-0000-000000000001', 'f1060000-0000-0000-0000-000000000001',
  'نجران', 2000, 15, current_date, pg_temp.fields('{"paid_amount": 99999}'))$$, 'أكبر من المبلغ الإجمالي', 'paid > total');
select pg_temp.logout();
select pg_temp.check(not exists (select 1 from trial_agreements where customer_id = 'c1060000-0000-0000-0000-000000000001'), 'refused saves left nothing');
select pg_temp.login('a1060000-0000-0000-0000-000000000001');
insert into t_ctx values ('trial', (select id::text from create_trial_agreement('c1060000-0000-0000-0000-000000000001',
  'f1060000-0000-0000-0000-000000000001', 'نجران', 2000, 15, current_date, pg_temp.fields())));
-- a customer with no ID/mobile in the file: filled from the contract (never replaced afterwards)
insert into t_ctx values ('trial2', (select id::text from create_trial_agreement('c1060000-0000-0000-0000-000000000002',
  'f1060000-0000-0000-0000-000000000002', 'نجران', 1500, 7, current_date,
  pg_temp.fields('{"id_number": "2234567890", "id_kind": "إقامة", "mobile": "0559876543", "worker_kind": "السائق", "paid_amount": 0}'))));
select pg_temp.logout();
do $$
declare t trial_agreements; k contracts; d jsonb;
begin
  select * into t from trial_agreements where id = pg_temp.ctx('trial')::uuid;
  select * into k from contracts where id = t.contract_id;
  perform pg_temp.check(k.service_code = 'transfer_trial' and k.status = 'draft' and t.end_date = current_date + 14, 'contract + trial dates');
  perform pg_temp.check(t.terms_snapshot->>'layout' = 'trial_contract_black_v1', 'snapshot = the official template');
  perform pg_temp.check(t.document_fields->>'sponsor_name' = 'علي بن محمد آل مريح' and (t.document_fields->>'daily_wage')::numeric = 60
                        and (t.document_fields->>'paid_amount')::numeric = 1000 and t.document_fields->>'customer_no' = '000231', 'fields stored');
  perform pg_temp.check((select national_id = '2234567890' and phone = '0559876543' from customers
                          where id = 'c1060000-0000-0000-0000-000000000002'), 'empty ID/mobile filled from the contract');
  perform pg_temp.check((select document_fields->>'worker_kind' from trial_agreements where id = pg_temp.ctx('trial2')::uuid) = 'السائق', 'driver');
  d := trial_document(t.id);
  perform pg_temp.check(d->>'contract_no' = k.contract_no and d->'template'->>'layout' = 'trial_contract_black_v1'
                        and d->'fields'->>'city' = 'نجران' and d->>'customer_national_id' = '1076543210'
                        and d->>'worker_name' = 'ماريا سانتوس' and d->>'nationality' = 'الفلبين', 'document data');
end $$;

-- ---------- 3) staff document (scope) + public page (masked) + acceptance ----------
select pg_temp.login('a1060000-0000-0000-0000-000000000001');
select pg_temp.check((trial_document_for(pg_temp.ctx('trial')::uuid)->'fields'->>'job') = 'معلم', 'staff reads the document');
insert into t_ctx values ('token', (select issue_trial_link(pg_temp.ctx('trial')::uuid)->>'token'));
select pg_temp.logout();
select pg_temp.rejects($$select trial_document_for(pg_temp.ctx('trial')::uuid)$$, 'صلاحية', 'anonymous staff document');
do $$
declare v jsonb;
begin
  set local role anon;
  v := trial_public_view(pg_temp.ctx('token'));
  perform pg_temp.check(v->>'customer_national_id' = '••••••3210' and v->>'customer_phone' like '%6606', 'ID masked on the public page');
  perform pg_temp.check(v->'template'->>'layout' = 'trial_contract_black_v1' and v->'fields'->>'sponsor_name' is not null, 'public document');
  perform pg_temp.check((trial_accept(pg_temp.ctx('token'), '3210', '6606', null, 'test')->>'ok')::boolean, 'accepted');
end $$;
select pg_temp.check((select status = 'awaiting_handover' and accepted_at is not null from trial_agreements where id = pg_temp.ctx('trial')::uuid), 'accepted → awaiting the regulatory handover requirements');
select pg_temp.check((select document->'fields'->>'sponsor_name' = 'علي بن محمد آل مريح' and document->'template'->>'layout' = 'trial_contract_black_v1'
                        from trial_acceptances where trial_id = pg_temp.ctx('trial')::uuid), 'accepted document saved with fields');
-- acceptance ≠ transfer: no handover before the regulatory checklist, no transfer contract yet
select pg_temp.login('a1060000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select trial_step(pg_temp.ctx('trial')::uuid, 'start')$$, 'المتطلبات النظامية', 'regulatory checklist still required');
select pg_temp.logout();
select pg_temp.check((select transfer_contract_id is null from trial_agreements where id = pg_temp.ctx('trial')::uuid), 'no transfer yet');

select 'OK 99rb_trial_contract_template' as result;
