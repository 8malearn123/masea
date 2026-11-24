-- Tests for 0099: per-source report from real rows (unique customers, contracts, value,
-- revenue vs collected, spend, CPL/CAC/ROAS), attribution models, campaign status/results,
-- spend immutability, permissions, legacy rows as «غير محدد» (null source).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000c', 'فرع شرورة', 'شرورة')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9900000-0000-0000-0000-000000000001', 'admin99@test'),
  ('a9900000-0000-0000-0000-000000000002', 'driver99@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9900000-0000-0000-0000-000000000001', 'منيرة الحارثي', 'admin', 'b0000000-0000-0000-0000-00000000000c'),
  ('a9900000-0000-0000-0000-000000000002', 'سعد اليامي', 'driver', 'b0000000-0000-0000-0000-00000000000c')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
insert into campaigns (id, name, type, start_at, end_at, platform_code, budget, branch_id) values
  ('e9900000-0000-0000-0000-000000000001', 'سناب — التأجير الشهري', 'seasonal', now() - interval '10 days', now() + interval '10 days', 'snapchat', 5000, 'b0000000-0000-0000-0000-00000000000c'),
  ('e9900000-0000-0000-0000-000000000002', 'تيك توك — منتهية', 'seasonal', now() - interval '40 days', now() - interval '1 day', 'tiktok', 2000, null)
on conflict (id) do nothing;
-- a legacy customer/contract without any source (stays «غير محدد»)
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9900000-0000-0000-0000-000000000009', 'عبدالرحمن آل زمانان', '0551239909', 'b0000000-0000-0000-0000-00000000000c', 'نجران')
on conflict (id) do nothing;
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date)
values ('d9900000-0000-0000-0000-000000000009', 'c9900000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-00000000000c',
        'monthly_rental', 1000, 'draft', 'MR-99-L', current_date, current_date + 30)
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


select pg_temp.login('a9900000-0000-0000-0000-000000000001');
do $$
declare v_l1 uuid; v_l2 uuid; v_l3 uuid; v_cu customers; v_k1 contracts; v_k2 contracts; r record; v_sp uuid;
begin
  -- 3 Snapchat leads (one converts), 1 TikTok lead
  insert into leads (full_name, phone, source_code, branch_id, campaign_id) values
    ('ناصر آل حمد', '0551239901', 'snapchat', 'b0000000-0000-0000-0000-00000000000c', 'e9900000-0000-0000-0000-000000000001') returning id into v_l1;
  insert into leads (full_name, phone, source_code, branch_id) values ('هادي آل سعد', '0551239902', 'snapchat', 'b0000000-0000-0000-0000-00000000000c') returning id into v_l2;
  insert into leads (full_name, phone, source_code, branch_id) values ('سلطان آل مريح', '0551239903', 'snapchat', 'b0000000-0000-0000-0000-00000000000c');
  insert into leads (full_name, phone, source_code, branch_id) values ('مهدي آل قريع', '0551239904', 'tiktok', 'b0000000-0000-0000-0000-00000000000c') returning id into v_l3;
  v_cu := convert_lead_to_customer(v_l1);
  -- two contracts for the same customer: Snapchat campaign, then a TikTok contract source
  v_k1 := create_contract_draft(jsonb_build_object('service_code', 'monthly_rental', 'customer_id', v_cu.id,
    'branch', 'شرورة', 'start_date', current_date + 1, 'end_date', current_date + 60, 'quantity', 2, 'nationality', 'كينيا',
    'marketing', jsonb_build_object('source_code', 'snapchat', 'campaign_id', 'e9900000-0000-0000-0000-000000000001')));
  v_k2 := create_contract_draft(jsonb_build_object('service_code', 'monthly_rental', 'customer_id', v_cu.id,
    'branch', 'شرورة', 'start_date', current_date + 90, 'end_date', current_date + 120, 'quantity', 1, 'nationality', 'كينيا',
    'marketing', jsonb_build_object('source_code', 'tiktok')));
  -- spend: 3000 on the Snapchat campaign
  perform add_campaign_spend('e9900000-0000-0000-0000-000000000001', current_date, 3000, 'INV-SNAP-11', null);
  perform pg_temp.rejects($q$ select add_campaign_spend('e9900000-0000-0000-0000-000000000001', current_date + 3, 10) $q$,
    'المستقبل', 'future spend');
  select id into v_sp from campaign_spend where reference = 'INV-SNAP-11';

  -- acquisition model: both contracts count for Snapchat; the customer is counted once
  select * into r from marketing_sources(current_date - 1, current_date, 'b0000000-0000-0000-0000-00000000000c', null, 'acquisition') where source_code = 'snapchat';
  perform pg_temp.check(r.leads = 3 and r.converted_leads = 1, 'snap leads/converted');
  perform pg_temp.check(r.contracts = 2 and r.new_customers = 1, 'snap contracts & unique new customer');
  perform pg_temp.check(r.contract_value = v_k1.total_amount + v_k2.total_amount, 'contract value incl VAT');
  perform pg_temp.check(r.revenue = 0 and r.collected = 0, 'drafts: no revenue, nothing collected');
  perform pg_temp.check(r.spend = 3000 and r.cpl = 1000 and r.cac = 3000, 'spend, CPL, CAC');
  perform pg_temp.check(r.conversion_rate = 0.3333, 'conversion rate');
  -- contract model: the TikTok contract moves to TikTok
  select * into r from marketing_sources(current_date - 1, current_date, 'b0000000-0000-0000-0000-00000000000c', null, 'contract') where source_code = 'tiktok';
  perform pg_temp.check(r.contracts = 1 and r.leads = 1, 'contract model → tiktok');
  perform pg_temp.check(r.roas is null, 'no spend → no ROAS');
  -- the legacy contract is in the «غير محدد» bucket
  perform pg_temp.check(exists (select 1 from marketing_sources(current_date - 1, current_date, 'b0000000-0000-0000-0000-00000000000c') s
                                 where s.source_code is null and s.contracts >= 1), 'legacy = unspecified');
end $$;
select pg_temp.logout();
select pg_temp.rejects($q$ update campaign_spend set amount = 1 $q$, 'لا يُعدَّل', 'spend edited');
select pg_temp.rejects($q$ delete from campaign_spend $q$, 'لا يُعدَّل', 'spend deleted');

-- signing + a received payment flow into revenue and collected (owner simulates signing)
update contracts set status = 'signed' where branch_id = 'b0000000-0000-0000-0000-00000000000c' and source_code = 'snapchat';
select pg_temp.login('a9900000-0000-0000-0000-000000000001');
do $$
declare k contracts; r record;
begin
  select * into k from contracts where source_code = 'snapchat' and status = 'signed' and branch_id = 'b0000000-0000-0000-0000-00000000000c';
  perform record_contract_payment(k.id, 1000, 'cash', current_date);
  perform record_contract_payment(k.id, 500, 'cash', current_date, null, null, 'شيك', 'pending_clearance');
  select * into r from marketing_sources(current_date - 1, current_date, 'b0000000-0000-0000-0000-00000000000c') where source_code = 'snapchat';
  perform pg_temp.check(r.revenue = k.base_amount, 'revenue = net of the signed contract');
  perform pg_temp.check(r.collected = 1000, 'collected excludes pending');
  perform pg_temp.check(r.roas = round(k.base_amount / 3000, 2), 'ROAS = revenue / spend');
  -- per campaign
  select * into r from marketing_campaigns(current_date - 1, current_date, 'b0000000-0000-0000-0000-00000000000c') where campaign_id = 'e9900000-0000-0000-0000-000000000001';
  perform pg_temp.check(r.status = 'active' and r.leads = 1 and r.contracts = 1 and r.collected = 1000 and r.spend = 3000, 'campaign results');
  perform pg_temp.check((select status from marketing_campaigns(current_date - 1, current_date)
                          where campaign_id = 'e9900000-0000-0000-0000-000000000002') = 'ended', 'ended campaign status');
  -- same-platform contract without the campaign is NOT counted in the campaign
  perform pg_temp.check(r.contracts = 1, 'no automatic campaign attribution');
  -- breakdowns
  perform pg_temp.check((select sum(contracts) from marketing_breakdown(current_date - 1, current_date, 'employee', 'b0000000-0000-0000-0000-00000000000c')
                          where dim_label = 'منيرة الحارثي') = 2, 'by employee (split by source)');
  perform pg_temp.check(exists (select 1 from marketing_breakdown(current_date - 1, current_date, 'branch', 'b0000000-0000-0000-0000-00000000000c')
                                 where dim_label = 'شرورة'), 'by branch');
end $$;

select pg_temp.login('a9900000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select * from marketing_sources(current_date - 1, current_date) $$, 'صلاحية', 'driver sees marketing');
select pg_temp.logout();
select 'OK 99z_marketing_attribution' as result;
