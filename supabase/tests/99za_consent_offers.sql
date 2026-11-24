-- Tests for 0100: consent gate, offers queued only for consenting customers, no false
-- "sent", manual WhatsApp logged as unconfirmed, provider status sync, responses, revoke.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000d', 'فرع حبونا', 'حبونا')
on conflict (id) do nothing;
insert into auth.users (id, email) values ('a9a00000-0000-0000-0000-000000000001', 'mkt100@test') on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9a00000-0000-0000-0000-000000000001', 'ريم آل مسعود', 'admin', 'b0000000-0000-0000-0000-00000000000d')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
insert into customers (id, full_name, phone, branch_id, city) values
  ('ca000000-0000-0000-0000-000000000001', 'صالح آل منجم', '0551231001', 'b0000000-0000-0000-0000-00000000000d', 'حبونا'),
  ('ca000000-0000-0000-0000-000000000002', 'جابر آل حيدر', '0551231002', 'b0000000-0000-0000-0000-00000000000d', 'حبونا'),
  ('ca000000-0000-0000-0000-000000000003', 'هادي آل شيبان', null,          'b0000000-0000-0000-0000-00000000000d', 'حبونا')
on conflict (id) do nothing;
insert into campaigns (id, name, type, start_at, end_at, platform_code) values
  ('ea000000-0000-0000-0000-000000000001', 'عرض التأجير الشهري — حبونا', 'seasonal', now() - interval '2 days', now() + interval '20 days', 'whatsapp'),
  ('ea000000-0000-0000-0000-000000000002', 'عرض منتهٍ', 'seasonal', now() - interval '30 days', now() - interval '1 day', 'whatsapp')
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


select pg_temp.login('a9a00000-0000-0000-0000-000000000001');
do $$
declare r jsonb; v_msg campaign_messages;
begin
  perform pg_temp.rejects($q$ select set_marketing_consent('ca000000-0000-0000-0000-000000000001', true, '{whatsapp}', '') $q$,
    'وثّق', 'consent needs a documented source');
  perform set_marketing_consent('ca000000-0000-0000-0000-000000000001', true, '{whatsapp,sms}', 'موافقة مكتوبة في فرع حبونا');
  perform set_marketing_consent('ca000000-0000-0000-0000-000000000003', true, '{whatsapp}', 'موافقة هاتفية مسجّلة');

  perform pg_temp.check((select count(*) from campaign_audience('whatsapp')) >= 2
    and not exists (select 1 from campaign_audience('whatsapp') where id = 'ca000000-0000-0000-0000-000000000002'),
    'audience = consenting only');
  perform pg_temp.rejects($q$ select queue_campaign_offer('ea000000-0000-0000-0000-000000000002',
    array['ca000000-0000-0000-0000-000000000001']::uuid[], 'whatsapp', 'عرض خاص لك يا {الاسم} على التأجير الشهري') $q$,
    'غير نشطة', 'offer for an ended campaign');

  r := queue_campaign_offer('ea000000-0000-0000-0000-000000000001',
    array['ca000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000003']::uuid[],
    'whatsapp', 'أهلاً {الاسم}، خصم خاص على التأجير الشهري هذا الأسبوع.');
  perform pg_temp.check((r->>'queued')::int = 1 and (r->>'skipped_no_consent')::int = 1 and (r->>'skipped_no_phone')::int = 1,
    'queued only the consenting customer with a phone');
  select * into v_msg from campaign_messages where customer_id = 'ca000000-0000-0000-0000-000000000001';
  perform pg_temp.check(v_msg.status = 'queued' and v_msg.body like 'أهلاً صالح،%', 'queued, personalised, not "sent"');
  perform pg_temp.check(exists (select 1 from outbound_messages where id = v_msg.outbound_id and status = 'queued'), 'in the outbound queue');
  r := queue_campaign_offer('ea000000-0000-0000-0000-000000000001', array['ca000000-0000-0000-0000-000000000001']::uuid[],
    'whatsapp', 'أهلاً {الاسم}، خصم خاص على التأجير الشهري هذا الأسبوع.');
  perform pg_temp.check((r->>'skipped_duplicate')::int = 1, 'no duplicate offer');

  -- manual WhatsApp from the employee's phone: unconfirmed, queue cancelled
  perform mark_campaign_message_manual(v_msg.id);
  perform pg_temp.check((select status from campaign_messages where id = v_msg.id) = 'opened_manually', 'manual = unconfirmed');
  perform record_campaign_response(v_msg.id, 'interested', 'طلب التواصل غداً');
  perform pg_temp.check((select response from campaign_messages where id = v_msg.id) = 'interested', 'response recorded');

  -- revoke stops future offers
  perform set_marketing_consent('ca000000-0000-0000-0000-000000000001', false, '{}', 'طلب العميل الإيقاف');
  perform pg_temp.check(not exists (select 1 from campaign_audience('whatsapp') where id = 'ca000000-0000-0000-0000-000000000001'), 'revoked');
  perform pg_temp.check((select count(*) from customer_consent_events where customer_id = 'ca000000-0000-0000-0000-000000000001') = 2, 'consent log');
end $$;
select pg_temp.logout();

-- a provider (later) updates the queue → the campaign log follows
do $$
declare v_out uuid; v_id uuid;
begin
  insert into campaign_messages (campaign_id, customer_id, channel, to_address, body)
  values ('ea000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000003', 'whatsapp', '966551231003', 'نص') returning id into v_id;
  insert into outbound_messages (channel, to_address, template, body) values ('whatsapp', '966551231003', 'campaign_offer', 'نص') returning id into v_out;
  update campaign_messages set outbound_id = v_out where id = v_id;
  update outbound_messages set status = 'delivered' where id = v_out;
  perform pg_temp.check((select status from campaign_messages where id = v_id) = 'delivered', 'provider status synced');
end $$;
select 'OK 99za_consent_offers' as result;
