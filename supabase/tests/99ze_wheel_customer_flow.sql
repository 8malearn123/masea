-- Tests for 0104: wheel campaign link + identity check + lockout, once per customer per campaign,
-- 100% probability gate (never auto-changed), undefined prizes can't be activated, max awards,
-- prize reference in the customer file, use on a contract (customer/service/usage), report
-- counts a renewal only when the prize was used on it.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000c', 'فرع شرورة', 'شرورة')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ae000000-0000-0000-0000-000000000001', 'gm104@test'),
  ('ae000000-0000-0000-0000-000000000002', 'sales104@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ae000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', 'b0000000-0000-0000-0000-00000000000c'),
  ('ae000000-0000-0000-0000-000000000002', 'لمى آل سالم', 'sales', 'b0000000-0000-0000-0000-00000000000c')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
insert into customers (id, full_name, phone, branch_id, city, national_id) values
  ('ce000000-0000-0000-0000-000000000001', 'فهد آل يام', '0551234401', 'b0000000-0000-0000-0000-00000000000c', 'شرورة', '1012344401'),
  ('ce000000-0000-0000-0000-000000000002', 'نورة آل مريح', '0551234402', 'b0000000-0000-0000-0000-00000000000c', 'شرورة', '1012344402'),
  ('ce000000-0000-0000-0000-000000000003', 'مانع آل عباس', '0551234403', 'b0000000-0000-0000-0000-00000000000c', 'شرورة', null)
on conflict (id) do nothing;
insert into campaigns (id, name, type, start_at, end_at, is_draft, terms) values
  ('ee000000-0000-0000-0000-000000000001', 'عجلة اليوم الوطني', 'lucky_wheel', now() - interval '1 day', now() + interval '10 days', false,
   'مشاركة واحدة لكل عميل مسجّل. الجوائز وفق الشروط الظاهرة.'),
  ('ee000000-0000-0000-0000-000000000002', 'عجلة ديسمبر', 'lucky_wheel', now() - interval '1 day', now() + interval '10 days', false, null),
  ('ee000000-0000-0000-0000-000000000003', 'عجلة مسودة', 'lucky_wheel', now() - interval '1 day', now() + interval '10 days', true, null)
on conflict (id) do nothing;
-- contracts: one new, one renewal (parent), one other service, one renewal for which no prize is used
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date, parent_contract_id) values
  ('de000000-0000-0000-0000-000000000001', 'ce000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c', 'monthly_rental', 2000, 'draft', 'MR-104-1', current_date, current_date + 30, null),
  ('de000000-0000-0000-0000-000000000002', 'ce000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c', 'monthly_rental', 2000, 'draft', 'MR-104-2', current_date, current_date + 30, 'de000000-0000-0000-0000-000000000001'),
  ('de000000-0000-0000-0000-000000000003', 'ce000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c', 'recruitment', 15000, 'draft', 'RC-104-3', current_date, current_date + 90, null),
  ('de000000-0000-0000-0000-000000000004', 'ce000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000c', 'monthly_rental', 2000, 'draft', 'MR-104-4', current_date, current_date + 30, 'de000000-0000-0000-0000-000000000001')
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
  set constraints all immediate;   -- the 100% total check is deferred to commit (0105)
  execute p_sql;
  raise exception 'FAIL (accepted): %', p_msg;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%' || p_like || '%' then raise exception 'FAIL: % — got «%»', p_msg, sqlerrm; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- prize definitions: nothing undefined can be activated ----------
select pg_temp.rejects($$ update wheel_prizes set is_active = true where label = 'خصم 10٪' $$,
  'الخدمات المشمولة والحد الأعلى', '10% without services/cap');
select pg_temp.rejects($$ update wheel_prizes set is_active = true where label = 'تأجيل مجاني' $$,
  'اعتماد تعريفها', 'free postponement without a definition');
select pg_temp.check((select not is_active from wheel_prizes where label = 'تأجيل مجاني'), 'free postponement stays disabled');
select pg_temp.check((select value from wheel_prizes where label = 'خصم 10٪') = 10, 'prize value untouched');

-- ---------- 100% gate ----------
-- a total other than 100% is never persisted (0105)
select pg_temp.rejects($$ insert into wheel_prizes (label, prize_type, value, probability, sort_order, is_active)
                          values ('200 نقطة', 'points', 200, 72, 1, true) $$, 'يساوي 100', 'total 172 refused');
select pg_temp.check(wheel_probability_total() = 100, 'total still 100');

-- an approved, fully defined non-cash prize: 100%
begin;
update wheel_prizes set is_active = false;
insert into wheel_prizes (id, label, prize_type, value, probability, sort_order, is_active, service_codes, coupon_valid_days, usage_limit, terms)
values ('fe000000-0000-0000-0000-000000000002', 'توصيل مجاني للعاملة', 'free_service', 0, 100, 2, true, '{monthly_rental}', 30, 1,
        'توصيل العاملة لمنزل العميل مجاناً داخل المدينة عند عقد تأجير شهري واحد.');
commit;

-- ---------- links: permission, identity data, campaign ----------
select pg_temp.login('ae000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select create_wheel_link('ce000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001') $$, 'صلاحية', 'sales creates links');
select pg_temp.login('ae000000-0000-0000-0000-000000000001');
select pg_temp.rejects($$ select create_wheel_link('ce000000-0000-0000-0000-000000000003', 'ee000000-0000-0000-0000-000000000001') $$, 'رقم الهوية', 'customer without national id');
select pg_temp.rejects($$ select create_wheel_link('ce000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000003') $$, 'حملة نشطة', 'draft campaign');
create temp table tk (n int, t text);
insert into tk select 1, create_wheel_link('ce000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001')->>'token';
insert into tk select 2, create_wheel_link('ce000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000001')->>'token';
insert into tk select 3, create_wheel_link('ce000000-0000-0000-0000-000000000001', 'ee000000-0000-0000-0000-000000000002')->>'token';
insert into tk select 4, create_wheel_link('ce000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-000000000001')->>'token';
select pg_temp.logout();

do $$
declare t1 text := (select t from tk where n = 1); v jsonb; r jsonb; i int;
begin
  set local role anon;
  v := wheel_public_view(t1);
  perform pg_temp.check(v->>'campaign_name' = 'عجلة اليوم الوطني' and v->>'campaign_terms' like 'مشاركة واحدة%', 'campaign name & terms');
  perform pg_temp.check((v->>'ready')::boolean and (v->'prizes'->0->>'terms') like 'توصيل العاملة%', 'prize terms shown');
  r := spin_wheel_by_token(t1, '0000', '4401');
  perform pg_temp.check(r->>'error' = 'بيانات التحقق غير مطابقة', 'wrong id digits');
  r := spin_wheel_by_token(t1, '4401', '9999');
  perform pg_temp.check(r->>'error' = 'بيانات التحقق غير مطابقة', 'wrong phone digits');
  r := spin_wheel_by_token(t1, '4401', '4401');
  perform pg_temp.check(r->>'reference' like 'MAS-PRIZE-%' and r->>'valid_until' is not null, 'prize with reference');
  reset role;
  perform pg_temp.check((select reference from wheel_spins where customer_id = 'ce000000-0000-0000-0000-000000000001'
                           and campaign_id = 'ee000000-0000-0000-0000-000000000001') = r->>'reference', 'spin saved to the customer & campaign');
end $$;
-- once per campaign (second link, same campaign) — another campaign is allowed
select pg_temp.rejects($$ select spin_wheel_by_token((select t from tk where n = 2), '4401', '4401') $$, 'سبق لك المشاركة', 'once per campaign');
select pg_temp.check((spin_wheel_by_token((select t from tk where n = 3), '4401', '4401')->>'reference') like 'MAS-PRIZE-%', 'other campaign allowed');
-- lockout after 5 wrong attempts
do $$
declare i int;
begin
  for i in 1..5 loop perform spin_wheel_by_token((select t from tk where n = 4), '1111', '1111'); end loop;
end $$;
select pg_temp.rejects($$ select spin_wheel_by_token((select t from tk where n = 4), '4402', '4402') $$, 'أُوقف الرابط', 'locked after 5 failures');
select pg_temp.check((wheel_public_view((select t from tk where n = 4))->>'locked')::boolean, 'view shows locked');

-- ---------- max awards: reached → no prize, probabilities unchanged ----------
update wheel_prizes set max_awards = 2 where id = 'fe000000-0000-0000-0000-000000000002';
select pg_temp.login('ae000000-0000-0000-0000-000000000001');
create temp table tk2 as select create_wheel_link('ce000000-0000-0000-0000-000000000002', 'ee000000-0000-0000-0000-000000000002')->>'token' as t;
select pg_temp.logout();
select pg_temp.check((spin_wheel_by_token((select t from tk2), '4402', '4402')->>'prize_type') = 'none', 'sold-out prize gives nothing');
select pg_temp.check((select exhausted from wheel_spins where customer_id = 'ce000000-0000-0000-0000-000000000002' and campaign_id = 'ee000000-0000-0000-0000-000000000002'), 'recorded as exhausted');

-- ---------- use on a contract ----------
create temp table ref as select reference as r from wheel_spins
 where customer_id = 'ce000000-0000-0000-0000-000000000001' and campaign_id = 'ee000000-0000-0000-0000-000000000001';
grant select on ref to authenticated;
select pg_temp.login('ae000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from customer_wheel_prizes('ce000000-0000-0000-0000-000000000001')) = 2, 'prizes in the customer file');
select pg_temp.rejects($$ select redeem_wheel_prize((select r from ref), 'de000000-0000-0000-0000-000000000004') $$, 'عميلاً آخر', 'other customer');
select pg_temp.rejects($$ select redeem_wheel_prize((select r from ref), 'de000000-0000-0000-0000-000000000003') $$, 'لا تشمل', 'other service');
select pg_temp.rejects($$ select redeem_wheel_prize('MAS-PRIZE-XXXXXX', 'de000000-0000-0000-0000-000000000002') $$, 'غير صحيح', 'bad reference');
select redeem_wheel_prize((select r from ref), 'de000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select redeem_wheel_prize((select r from ref), 'de000000-0000-0000-0000-000000000001') $$, 'بالعدد المسموح', 'usage limit 1');
select pg_temp.check((select uses from customer_wheel_prizes('ce000000-0000-0000-0000-000000000001') where reference = (select r from ref)) = 1, 'use counted');

-- ---------- report: renewal only via the used prize ----------
select pg_temp.login('ae000000-0000-0000-0000-000000000001');
do $$
declare r record;
begin
  select * into r from wheel_report(current_date - 1, current_date, 'ee000000-0000-0000-0000-000000000001', null)
   where prize_label = 'توصيل مجاني للعاملة';
  perform pg_temp.check(r.spins = 1 and r.participants = 1 and r.winners = 1 and r.used = 1, 'campaign counts');
  -- contract 4 is a renewal by another participant that used no prize → not counted
  perform pg_temp.check(r.renewals = 1 and r.contracts = 0 and r.renewals_value = 2300, 'renewal via the used prize only');
  select * into r from wheel_report(current_date - 1, current_date, 'ee000000-0000-0000-0000-000000000002', null)
   where prize_label = 'توصيل مجاني للعاملة';
  perform pg_temp.check(r.spins = 2 and r.winners = 1 and r.used = 0, 'other campaign separate (one sold out)');
end $$;
select pg_temp.logout();

select 'OK 99ze_wheel_customer_flow' as result;
