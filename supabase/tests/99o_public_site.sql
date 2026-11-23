-- Tests for 0086: public site — managed company profile, visitor service request → lead.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000071', 'admin19@test'),
  ('ad000000-0000-0000-0000-000000000072', 'sales19@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000071', 'منصور المكرمي', 'admin', null),
  ('ad000000-0000-0000-0000-000000000072', 'نورة العتيبي', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
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
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;

-- ---- visitor: reads the public info, cannot edit the profile
select pg_temp.as_anon();
select pg_temp.check((select (public_site_info()->'company'->>'display_name') = 'ماسية الشرق للاستقدام'), 'public info has the company name');
select pg_temp.check((select (public_site_info()->>'hourly_min_hours')::numeric = 4 and (public_site_info()->>'hourly_max_hours')::numeric = 12),
  'hourly limits come from app_config');
select pg_temp.check((select public_site_info()->'company'->>'phone') is null, 'no invented phone');
update company_profile set phone = '0551234567';
select pg_temp.check((select phone from company_profile) is null, 'visitor update filtered by RLS');

-- ---- visitor request → lead
select pg_temp.rejects($$ select submit_web_lead('ع', '0551234567', 'recruitment', 'نجران') $$, 'الاسم مطلوب', 'name required');
select pg_temp.rejects($$ select submit_web_lead('عبدالله الحربي', '1234', 'recruitment', 'نجران') $$, '05xxxxxxxx', 'phone format');
select pg_temp.rejects($$ select submit_web_lead('عبدالله الحربي', '0551234567', 'nope', 'نجران') $$, 'اختر الخدمة', 'service must exist');
select pg_temp.rejects($$ select submit_web_lead('عبدالله الحربي', '0551234567', 'recruitment', 'الرياض') $$, 'أقرب فرع', 'branch must exist');
create temp table _r1 as select submit_web_lead('عبدالله الحربي', '+966 55 999 1101', 'recruitment', 'نجران', 'عاملة فلبينية') as r;
create temp table _r2 as select submit_web_lead('عبدالله الحربي', '0559991101', 'recruitment', 'نجران') as r;
create temp table _r3 as select submit_web_lead('روبوت', '0559991102', 'recruitment', 'نجران', null, 'http://spam') as r;
select pg_temp.logout();
select pg_temp.check((select (r->>'ok')::boolean and r->>'ref' is not null from _r1), 'request accepted with a reference');
select pg_temp.check((select (r->>'duplicate')::boolean and r->>'ref' = (select r->>'ref' from _r1) from _r2), 'same phone+service within 24h → same reference');
select pg_temp.check(not exists (select 1 from leads where phone = '0559991102'), 'honeypot request not saved');
select pg_temp.check((select source_code = 'website' and stage_code = 'new' and branch_id = 'b0000000-0000-0000-0000-00000000000a'
                             and assigned_to is null and notes = 'عاملة فلبينية'
                        from leads where phone = '0559991101'), 'lead in the pipeline: website / new / branch');

-- ---- admin manages the profile (validated, audited); sales cannot
select pg_temp.login('ad000000-0000-0000-0000-000000000071');
update company_profile set phone = '920012345', whatsapp = '+966 55 000 1122', email = ' Info@Masiat.SA ', instagram_url = 'https://instagram.com/masiat' where id = 1;
select pg_temp.rejects($$ update company_profile set instagram_url = 'javascript:alert(1)' where id = 1 $$, 'company_urls_chk', 'only https links');
select pg_temp.rejects($$ update company_profile set whatsapp = '0551234567' where id = 1 $$, 'company_whatsapp_chk', 'whatsapp in international format');
select pg_temp.logout();
select pg_temp.check((select phone = '920012345' and whatsapp = '966550001122' and email = 'info@masiat.sa' from company_profile),
  'profile normalised');
select pg_temp.login('ad000000-0000-0000-0000-000000000072');
update company_profile set phone = '0500000000' where id = 1;
select pg_temp.logout();
select pg_temp.check((select phone = '920012345' from company_profile), 'sales update filtered by RLS');
select pg_temp.check(exists (select 1 from audit_log where table_name = 'company_profile'), 'profile changes audited');
update company_profile set phone = null, whatsapp = null, email = null, instagram_url = null where id = 1;
\echo 'OK 99o_public_site'
