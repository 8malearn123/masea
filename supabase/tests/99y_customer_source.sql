-- Tests for 0098: customer acquisition source from lead to customer to contract, contract
-- source/campaign independent of the original source, guards, "other" needs a note.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9800000-0000-0000-0000-000000000001', 'bm98@test'),
  ('a9800000-0000-0000-0000-000000000002', 'sales98@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9800000-0000-0000-0000-000000000001', 'سالم آل منصور', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9800000-0000-0000-0000-000000000002', 'هند آل عباس', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into campaigns (id, name, type, start_at, end_at)
values ('e9800000-0000-0000-0000-000000000001', 'حملة تيك توك — التأجير الشهري', 'seasonal', now() - interval '5 days', now() + interval '20 days')
on conflict (id) do nothing;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9800000-0000-0000-0000-000000000009', 'فهد آل جابر', '0551239809', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
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


select pg_temp.login('a9800000-0000-0000-0000-000000000002');
do $$
declare v_lead uuid; v_cust customers; v_c1 contracts; v_c2 contracts;
begin
  -- 1) lead from Snapchat
  insert into leads (full_name, phone, source_code, service_code, branch_id, assigned_to, first_contact_at)
  values ('ناصر آل حمد', '0551239801', 'snapchat', 'monthly_rental', 'b0000000-0000-0000-0000-00000000000a',
          'a9800000-0000-0000-0000-000000000002', current_date - 10)
  returning id into v_lead;
  perform pg_temp.rejects($q$ insert into leads (full_name, phone, source_code) values ('س', '0551239802', 'other') $q$,
    'وضّح', '"other" needs a note');

  -- 2-3) conversion carries the source
  v_cust := convert_lead_to_customer(v_lead);
  perform pg_temp.check(v_cust.acquisition_source_code = 'snapchat', 'source carried to the customer');
  perform pg_temp.check(v_cust.first_contact_at = current_date - 10, 'first contact carried');

  -- 4-6) contract through the wizard path: contract source TikTok campaign, acquisition stays Snapchat
  v_c1 := create_contract_draft(jsonb_build_object(
    'service_code', 'monthly_rental', 'customer_id', v_cust.id, 'branch', 'نجران',
    'start_date', current_date + 1, 'end_date', current_date + 60, 'quantity', 2, 'nationality', 'كينيا',
    'marketing', jsonb_build_object('source_code', 'tiktok', 'campaign_id', 'e9800000-0000-0000-0000-000000000001',
                                    'lead_id', v_lead)));
  perform pg_temp.check(v_c1.acquisition_source_code = 'snapchat', 'acquisition snapshot on the contract');
  perform pg_temp.check(v_c1.source_code = 'tiktok' and v_c1.campaign_id is not null, 'contract source/campaign kept separately');
  perform pg_temp.check(v_c1.lead_id = v_lead and v_c1.first_contact_at = current_date - 10, 'lead + first contact linked');

  -- 9-10) second contract, no contract source given → defaults to acquisition; customer source unchanged
  v_c2 := create_contract_draft(jsonb_build_object(
    'service_code', 'monthly_rental', 'customer_id', v_cust.id, 'branch', 'نجران',
    'start_date', current_date + 90, 'end_date', current_date + 150, 'quantity', 2, 'nationality', 'كينيا',
    'marketing', jsonb_build_object('source_code', 'whatsapp')));
  perform pg_temp.check(v_c2.source_code = 'whatsapp' and v_c2.acquisition_source_code = 'snapchat', 'contact channel ≠ acquisition');
  perform pg_temp.check((select acquisition_source_code from customers where id = v_cust.id) = 'snapchat', 'original source kept');

  -- 12) legacy customer without a source: the wizard path requires it, then records it once
  perform pg_temp.rejects($q$ select create_contract_draft(jsonb_build_object(
    'service_code', 'monthly_rental', 'customer_id', 'c9800000-0000-0000-0000-000000000009', 'branch', 'نجران',
    'start_date', current_date + 1, 'end_date', current_date + 30, 'quantity', 1, 'nationality', 'كينيا',
    'marketing', '{}'::jsonb)) $q$, 'مصدر العميل الأصلي', 'contract without any source');
  perform create_contract_draft(jsonb_build_object(
    'service_code', 'monthly_rental', 'customer_id', 'c9800000-0000-0000-0000-000000000009', 'branch', 'نجران',
    'start_date', current_date + 1, 'end_date', current_date + 30, 'quantity', 1, 'nationality', 'كينيا',
    'marketing', jsonb_build_object('acquisition_source_code', 'walk_in')));
  perform pg_temp.check((select acquisition_source_code from customers where id = 'c9800000-0000-0000-0000-000000000009') = 'walk_in',
    'source recorded from the contract screen');

  -- 10) the original source can't be overwritten silently
  perform pg_temp.rejects(format($q$ update customers set acquisition_source_code = 'tiktok' where id = %L $q$, v_cust.id),
    'مسجّل', 'silent overwrite');
  perform pg_temp.rejects(format($q$ select set_customer_acquisition(%L, '{"acquisition_source_code":"google"}') $q$, v_cust.id),
    'مسجّل', 'set over an existing source');
  perform pg_temp.rejects(format($q$ select change_customer_acquisition(%L, 'google', null, 'تصحيح بعد مراجعة') $q$, v_cust.id),
    'لمدير', 'sales corrects the source');
  -- contract status changes keep the marketing data
  perform transition_contract(v_c1.id, 'pending_approval');
  perform pg_temp.check((select source_code from contracts where id = v_c1.id) = 'tiktok', 'kept across status change');
end $$;

select pg_temp.login('a9800000-0000-0000-0000-000000000001');
do $$
declare v_cust uuid;
begin
  select id into v_cust from customers where phone = '0551239801';
  perform pg_temp.rejects(format($q$ select change_customer_acquisition(%L, 'google', null, 'x') $q$, v_cust), 'سبب', 'reason required');
  perform change_customer_acquisition(v_cust, 'instagram', null, 'العميل أكّد أن أول معرفة كانت من إنستغرام');
  perform pg_temp.check((select acquisition_source_code from customers where id = v_cust) = 'instagram', 'manager correction');
  perform pg_temp.check((select count(*) from customer_acquisition_changes where customer_id = v_cust) = 1, 'correction logged');
  -- the contract snapshot does not move with the correction
  perform pg_temp.check((select bool_and(acquisition_source_code = 'snapchat') from contracts where customer_id = v_cust), 'snapshot frozen');
end $$;
select pg_temp.logout();

select pg_temp.check((select is_active from lead_sources where code = 'campaign') = false, '"campaign" closed for new entries');
select pg_temp.check((select count(*) from lead_sources where code in ('snapchat','tiktok','facebook','x','whatsapp','instagram','google','direct_call','other')) = 9, 'platform sources');
select 'OK 99y_customer_source' as result;
