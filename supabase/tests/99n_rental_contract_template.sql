-- Tests for 0087: «عقد تأجير خدمات عمالية» — versioned, locked, approved before use.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000071', 'sales18@test'),
  ('ad000000-0000-0000-0000-000000000072', 'bm18@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000071', 'هند القحطاني', 'sales', 'b0000000-0000-0000-0000-00000000000a'),
  ('ad000000-0000-0000-0000-000000000072', 'فهد آل سالم', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c0000000-0000-0000-0000-000000000181', 'نورة سعد آل منصور', '0551234870',
   'b0000000-0000-0000-0000-00000000000a', 'نجران')
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

-- ---- the seed: one pending template per rental service, full original structure
select pg_temp.check(
  (select count(*) from contract_templates
    where template_code = 'rental_labor_services' and status = 'pending_review' and not locked
      and service_code in ('monthly_rental', 'daily_rental')) = 2,
  'v1 seeded pending_review for monthly + daily rental');
select pg_temp.check(
  (select jsonb_array_length(doc->'sections') from contract_templates
    where template_code = 'rental_labor_services' and service_code = 'daily_rental') = 12,
  'all 12 original sections present (title … signatures)');
select pg_temp.check(
  (select string_agg(s->>'id', ',' order by o) from contract_templates t,
     jsonb_array_elements(t.doc->'sections') with ordinality as x(s, o)
    where t.template_code = 'rental_labor_services' and t.service_code = 'daily_rental')
  = 'title,first_party,second_party,preamble,worker_term,clause_1,clause_2,clause_3,clause_4,clause_5,clause_6,signatures',
  'sections keep the original order');
select pg_temp.check(
  (select count(*) from contract_templates t,
     jsonb_array_elements(t.doc->'sections') s, jsonb_array_elements(s->'blocks') b
    where t.template_code = 'rental_labor_services' and t.service_code = 'daily_rental'
      and b->>'t' = 'clause') = 21,
  '21 clause paragraphs (3 + 4 + 12 + 1 + 1, as in the original)');
select pg_temp.check(
  (select content_sha256 from contract_templates
    where template_code = 'rental_labor_services' and service_code = 'daily_rental')
  = '2c17375e788419775a8cca949f6d139fcb110c216bad981b899c9739446c1243',
  'fingerprint stored with the template');

-- ---- a contract can NOT be issued on a template that is not approved yet
select pg_temp.rejects(
  $q$insert into contracts (customer_id, service_code, branch_id, template_id, status)
     values ('c0000000-0000-0000-0000-000000000181', 'daily_rental', 'b0000000-0000-0000-0000-00000000000a',
             (select id from contract_templates where template_code = 'rental_labor_services'
                and service_code = 'daily_rental'), 'draft')$q$,
  'لم يُعتمد', 'pending template blocks contract creation');

-- ---- sales reads the first-party profile but may not approve or edit it
select pg_temp.login('ad000000-0000-0000-0000-000000000071');
select pg_temp.check(contract_company_profile()->>'vat_number' = '311499536700003', 'sales reads company profile');
select pg_temp.check(contract_company_profile()->>'mol_license_no' = '4018961', 'MoL licence seeded from original');
select pg_temp.rejects(
  $q$select approve_contract_template((select id from contract_templates
       where template_code = 'rental_labor_services' and service_code = 'daily_rental'))$q$,
  'لا تملك صلاحية', 'sales cannot approve the template');
select pg_temp.rejects($q$select update_contract_company_profile('{"phone":"0170000000"}')$q$,
  'لا تملك صلاحية', 'sales cannot edit the first-party data');
select pg_temp.check(
  (select value from app_config where key = 'replacement_max_proposed') = 2,
  'proposed replacement policy is a separate operational setting (2)');
select pg_temp.logout();

-- ---- the branch manager (contracts.approve) approves → locked + audited
select pg_temp.login('ad000000-0000-0000-0000-000000000072');
select approve_contract_template(id) from contract_templates
 where template_code = 'rental_labor_services' and service_code = 'daily_rental';
select pg_temp.check(
  (select status = 'approved' and locked and is_active and approved_by = 'ad000000-0000-0000-0000-000000000072'
     from contract_templates where template_code = 'rental_labor_services' and service_code = 'daily_rental'),
  'approval locks the template and records who approved it');
select pg_temp.check(
  (select update_contract_company_profile('{"email":"info@masiat.sa"}')->>'email') = 'info@masiat.sa',
  'approver edits first-party data');
select pg_temp.logout();
select pg_temp.check(
  exists (select 1 from audit_log where action = 'contract_template.approve'), 'approval is audited');
select pg_temp.check(
  exists (select 1 from audit_log where action = 'company_profile.update'), 'profile edit is audited');

-- ---- the approved legal text is frozen
select pg_temp.rejects(
  $q$update contract_templates set doc = jsonb_set(doc, '{title}', '"عقد معدّل"')
     where template_code = 'rental_labor_services' and service_code = 'daily_rental'$q$,
  'لا يُعدَّل', 'approved template text cannot be edited in place');
select pg_temp.rejects(
  $q$delete from contract_templates where template_code = 'rental_labor_services' and service_code = 'daily_rental'$q$,
  'لا يُحذف', 'approved template cannot be deleted');
-- the other (still pending) template stays editable — only approval freezes
update contract_templates set name = name
 where template_code = 'rental_labor_services' and service_code = 'monthly_rental';

-- ---- a contract on the approved template pins its version + fingerprint
insert into contracts (id, customer_id, service_code, branch_id, template_id, status, work_location)
values ('cc000000-0000-0000-0000-000000000181', 'c0000000-0000-0000-0000-000000000181', 'daily_rental',
        'b0000000-0000-0000-0000-00000000000a',
        (select id from contract_templates where template_code = 'rental_labor_services'
           and service_code = 'daily_rental'), 'draft', 'نجران - حي الفيصلية');
select pg_temp.check(
  (select template_version = 1
      and template_sha256 = '2c17375e788419775a8cca949f6d139fcb110c216bad981b899c9739446c1243'
     from contracts where id = 'cc000000-0000-0000-0000-000000000181'),
  'contract pins template version and fingerprint');

-- ---- party data is frozen on the draft (sales, own branch) and locked after
select pg_temp.login('ad000000-0000-0000-0000-000000000071');
select set_contract_doc_fields('cc000000-0000-0000-0000-000000000181',
  '{"customer_name":"نورة سعد آل منصور","customer_id_no":"1048823571","worker_name":"MARIA LOURDES SANTOS","work_location":"نجران - حي الخالدية"}');
select pg_temp.logout();
select pg_temp.check(
  (select doc_fields->>'customer_id_no' = '1048823571' and work_location = 'نجران - حي الخالدية'
     from contracts where id = 'cc000000-0000-0000-0000-000000000181'),
  'draft stores the frozen party data');
update contracts set status = 'signed' where id = 'cc000000-0000-0000-0000-000000000181';
select pg_temp.login('ad000000-0000-0000-0000-000000000071');
select pg_temp.rejects(
  $q$select set_contract_doc_fields('cc000000-0000-0000-0000-000000000181', '{"customer_name":"x"}')$q$,
  'المسودة فقط', 'signed contract data cannot be changed');
select pg_temp.logout();

-- ---- legacy (unstructured) templates and old contracts are untouched
select pg_temp.check(
  (select count(*) from contract_templates where doc is null and status = 'approved' and not locked) > 0,
  'legacy templates keep working (approved, unlocked)');
update contract_templates set name = name where doc is null;

\echo OK 99n_rental_contract_template
