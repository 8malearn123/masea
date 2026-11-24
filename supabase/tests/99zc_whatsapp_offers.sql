-- Tests for 0102: WhatsApp offers — approved template required, eligibility, daily limit,
-- dedup, provider claim/submit, Meta statuses never downgrade, retry, inbound reply,
-- documented contract link, campaign report, permissions.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000e', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-000000000001', 'mkt102@test'),
  ('ac000000-0000-0000-0000-000000000002', 'sales102@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ac000000-0000-0000-0000-000000000001', 'أمل آل فايع', 'admin', 'b0000000-0000-0000-0000-00000000000e'),
  ('ac000000-0000-0000-0000-000000000002', 'عبير آل عامر', 'sales', 'b0000000-0000-0000-0000-00000000000e')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
insert into customers (id, full_name, phone, branch_id, city, marketing_consent, consent_channels, consent_at, consent_source) values
  ('cc000000-0000-0000-0000-000000000001', 'ماجد آل منيع', '0551232001', 'b0000000-0000-0000-0000-00000000000e', 'جازان', true, '{whatsapp}', now(), 'موافقة مكتوبة'),
  ('cc000000-0000-0000-0000-000000000002', 'فهد آل غانم',  '0551232002', 'b0000000-0000-0000-0000-00000000000e', 'جازان', true, '{whatsapp}', now(), 'موافقة مكتوبة'),
  ('cc000000-0000-0000-0000-000000000003', 'سالم آل حسن',  '0551232003', 'b0000000-0000-0000-0000-00000000000e', 'جازان', false, '{}', null, null),
  ('cc000000-0000-0000-0000-000000000004', 'علي آل داهم',  '12345',      'b0000000-0000-0000-0000-00000000000e', 'جازان', true, '{whatsapp}', now(), 'موافقة مكتوبة')
on conflict (id) do nothing;
insert into campaigns (id, name, type, start_at, end_at, platform_code) values
  ('ec000000-0000-0000-0000-000000000001', 'عرض العملاء الخاملين — جازان', 'seasonal', now() - interval '1 day', now() + interval '10 days', 'whatsapp')
on conflict (id) do nothing;
insert into whatsapp_templates (id, name_ar, provider_name, body, meta_status) values
  ('dc000000-0000-0000-0000-000000000001', 'عرض عودة العملاء', 'masea_comeback_offer', 'أهلاً {{1}}، {{2}} — العرض ساري حتى {{3}}', 'approved'),
  ('dc000000-0000-0000-0000-000000000002', 'قالب قيد المراجعة', 'masea_pending', 'مرحباً {{1}} {{2}} {{3}}', 'pending')
on conflict (id) do nothing;
update app_config set value = whatsapp_today_count() + 2 where key = 'whatsapp_daily_limit';

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


select pg_temp.login('ac000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select queue_whatsapp_offer('ec000000-0000-0000-0000-000000000001', array['cc000000-0000-0000-0000-000000000001']::uuid[],
  'dc000000-0000-0000-0000-000000000001', 'خصم 10٪ على التأجير الشهري', now() + interval '5 days') $$, 'صلاحية', 'sales sends offers');

select pg_temp.login('ac000000-0000-0000-0000-000000000001');
do $$
declare r jsonb;
begin
  perform pg_temp.rejects($q$ select queue_whatsapp_offer('ec000000-0000-0000-0000-000000000001', array['cc000000-0000-0000-0000-000000000001']::uuid[],
    'dc000000-0000-0000-0000-000000000002', 'خصم', now() + interval '5 days') $q$, 'معتمداً', 'pending template');
  perform pg_temp.check((select count(*) from whatsapp_eligibility(array['cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000003',
    'cc000000-0000-0000-0000-000000000004']::uuid[]) where eligible) = 1, 'eligibility');
  perform pg_temp.check((select reason from whatsapp_eligibility(array['cc000000-0000-0000-0000-000000000004']::uuid[])) = 'no_phone', 'reason no_phone');
  r := queue_whatsapp_offer('ec000000-0000-0000-0000-000000000001',
    array['cc000000-0000-0000-0000-000000000001','cc000000-0000-0000-0000-000000000002','cc000000-0000-0000-0000-000000000003','cc000000-0000-0000-0000-000000000004']::uuid[],
    'dc000000-0000-0000-0000-000000000001', 'خصم 10٪ على التأجير الشهري', now() + interval '5 days');
  perform pg_temp.check((r->>'queued')::int = 2 and (r->>'not_eligible')::int = 2, 'queued eligible only');
  r := queue_whatsapp_offer('ec000000-0000-0000-0000-000000000001', array['cc000000-0000-0000-0000-000000000001']::uuid[],
    'dc000000-0000-0000-0000-000000000001', 'خصم 10٪', now() + interval '5 days');
  perform pg_temp.check((r->>'duplicate')::int = 1, 'no duplicate');
  perform pg_temp.check((select body from campaign_messages where customer_id = 'cc000000-0000-0000-0000-000000000001') like 'أهلاً ماجد، خصم 10٪ على التأجير الشهري — العرض ساري حتى %', 'rendered body');
  perform pg_temp.check((select status from campaign_messages where customer_id = 'cc000000-0000-0000-0000-000000000001') = 'queued', 'queued, not sent');
end $$;
-- the provider functions are not callable by staff
select pg_temp.rejects($$ select * from whatsapp_claim_batch(10) $$, 'permission denied', 'staff claims batch');
select pg_temp.rejects($$ select whatsapp_status_update('x', 'read') $$, 'permission denied', 'staff fakes status');
select pg_temp.logout();

-- daily limit: a third eligible customer today is held back
update customers set marketing_consent = true, consent_channels = '{whatsapp}', consent_at = now(), consent_source = 'موافقة'
 where id = 'cc000000-0000-0000-0000-000000000003';
select pg_temp.login('ac000000-0000-0000-0000-000000000001');
select pg_temp.check((queue_whatsapp_offer('ec000000-0000-0000-0000-000000000001', array['cc000000-0000-0000-0000-000000000003']::uuid[],
  'dc000000-0000-0000-0000-000000000001', 'خصم 10٪', now() + interval '5 days')->>'over_limit')::int = 1, 'daily limit');
select pg_temp.logout();

-- provider (Edge Function as service_role): claim → submit → webhook statuses
set role service_role;
do $$
declare b record; v_m1 uuid; v_m2 uuid;
begin
  perform pg_temp.check((select count(*) from whatsapp_claim_batch(10)) = 2, 'claim 2');
  perform pg_temp.check((select count(*) from whatsapp_claim_batch(10)) = 0, 'locked while in flight');
  select o.id into v_m1 from outbound_messages o join campaign_messages m on m.outbound_id = o.id where m.customer_id = 'cc000000-0000-0000-0000-000000000001';
  select o.id into v_m2 from outbound_messages o join campaign_messages m on m.outbound_id = o.id where m.customer_id = 'cc000000-0000-0000-0000-000000000002';
  perform whatsapp_submitted(v_m1, 'wamid.TEST1');
  perform pg_temp.check((select status from campaign_messages where outbound_id = v_m1) = 'queued', 'accepted ≠ sent');
  perform whatsapp_status_update('wamid.TEST1', 'sent');
  perform whatsapp_status_update('wamid.TEST1', 'read');
  perform whatsapp_status_update('wamid.TEST1', 'delivered');   -- late webhook must not downgrade
  perform pg_temp.check((select status from campaign_messages where outbound_id = v_m1) = 'read', 'read, no downgrade');
  perform pg_temp.check((select read_at is not null and delivered_at is not null and sent_at is not null from campaign_messages where outbound_id = v_m1), 'timestamps');
  -- transient failure → retried later; then permanent
  perform whatsapp_submit_failed(v_m2, 'rate limited', true);
  perform pg_temp.check((select status = 'queued' and next_attempt_at > now() from outbound_messages where id = v_m2), 'retry scheduled');
  perform whatsapp_submit_failed(v_m2, 'invalid parameter', false);
  perform pg_temp.check((select status from campaign_messages where outbound_id = v_m2) = 'failed', 'failed');
  perform whatsapp_inbound_record('966551232001', 'مهتم، كم السعر؟', 'wamid.IN1');
  perform whatsapp_inbound_record('966551232001', 'مهتم، كم السعر؟', 'wamid.IN1');
  perform pg_temp.check((select count(*) from whatsapp_inbound where provider_message_id = 'wamid.IN1') = 1, 'inbound idempotent');
  perform pg_temp.check((select reply_text from campaign_messages where outbound_id = v_m1) = 'مهتم، كم السعر؟', 'reply linked');
end $$;
reset role;

select pg_temp.login('ac000000-0000-0000-0000-000000000001');
do $$
declare v_msg uuid; k contracts; r record; v_failed uuid;
begin
  select id into v_failed from campaign_messages where customer_id = 'cc000000-0000-0000-0000-000000000002';
  perform retry_campaign_message(v_failed);
  perform pg_temp.check((select o.status from outbound_messages o join campaign_messages m on m.outbound_id = o.id where m.id = v_failed) = 'queued', 'manual retry');
  select id into v_msg from campaign_messages where customer_id = 'cc000000-0000-0000-0000-000000000001';
  perform pg_temp.check((select count(*) from customer_offer_messages('cc000000-0000-0000-0000-000000000001')) = 1, 'offers for the wizard');
  k := create_contract_draft(jsonb_build_object('service_code', 'monthly_rental', 'customer_id', 'cc000000-0000-0000-0000-000000000001',
    'branch', 'جازان', 'start_date', current_date + 1, 'end_date', current_date + 30, 'quantity', 1, 'nationality', 'كينيا',
    'marketing', jsonb_build_object('acquisition_source_code', 'whatsapp', 'source_code', 'whatsapp', 'campaign_message_id', v_msg)));
  perform pg_temp.check(k.campaign_message_id = v_msg and k.campaign_id = 'ec000000-0000-0000-0000-000000000001', 'contract linked to the offer');
  perform pg_temp.rejects(format($q$ select create_contract_draft(jsonb_build_object('service_code', 'monthly_rental',
    'customer_id', 'cc000000-0000-0000-0000-000000000002', 'branch', 'جازان', 'start_date', current_date + 1, 'end_date', current_date + 30,
    'quantity', 1, 'nationality', 'كينيا', 'marketing', jsonb_build_object('acquisition_source_code', 'whatsapp', 'source_code', 'whatsapp',
    'campaign_message_id', %L))) $q$, v_msg), 'لا تخص', 'offer of another customer');
  select * into r from campaign_whatsapp_report('ec000000-0000-0000-0000-000000000001');
  perform pg_temp.check(r.messages = 2 and r.read = 1 and r.replied = 1 and r.engaged_customers = 1 and r.contracts = 1
    and r.contracts_value = k.total_amount, 'campaign report');
end $$;
select pg_temp.logout();
update app_config set value = 250 where key = 'whatsapp_daily_limit';
select 'OK 99zc_whatsapp_offers' as result;
