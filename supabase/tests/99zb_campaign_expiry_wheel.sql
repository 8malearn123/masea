-- Tests for 0101: expired campaign coupons refused, extension by a manager with reason
-- (and its coupons extend), campaign history protected, wheel prize rules, secure single-use
-- customer link, restricted coupon, report.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ab000000-0000-0000-0000-000000000001', 'gm101@test'),
  ('ab000000-0000-0000-0000-000000000002', 'sales101@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ab000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', 'b0000000-0000-0000-0000-00000000000a'),
  ('ab000000-0000-0000-0000-000000000002', 'لمى آل سالم', 'sales', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
insert into customers (id, full_name, phone, branch_id, city) values
  ('cb000000-0000-0000-0000-000000000001', 'سعيد آل ناجم', '0551231101', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into campaigns (id, name, type, start_at, end_at, platform_code, coupon_code) values
  ('eb000000-0000-0000-0000-000000000001', 'عرض نوفمبر', 'discount', now() - interval '20 days', now() - interval '1 hour', 'snapchat', 'NOV-OFFER')
on conflict (id) do nothing;
insert into promotions (id, name, type, code, discount_pct, requires_code, is_active, campaign_id, ends_at)
select 'fb000000-0000-0000-0000-000000000001', 'كوبون عرض نوفمبر', 'manual', 'NOV-OFFER', 10, true, true,
       'eb000000-0000-0000-0000-000000000001', end_at from campaigns where id = 'eb000000-0000-0000-0000-000000000001'
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


-- ---------- expiry & extension ----------
select pg_temp.check((evaluate_promotion('fb000000-0000-0000-0000-000000000001', 'monthly_rental', 1000, 'NOV-OFFER')->>'ok')::boolean = false,
  'expired campaign coupon refused');
select pg_temp.check((select campaign_status(c) from campaigns c where id = 'eb000000-0000-0000-0000-000000000001') = 'ended', 'status ended');

select pg_temp.login('ab000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select extend_campaign('eb000000-0000-0000-0000-000000000001', now() + interval '7 days', 'طلب من الإدارة') $$,
  'صلاحية إدارية', 'sales extends a campaign');
select pg_temp.login('ab000000-0000-0000-0000-000000000001');
select pg_temp.rejects($$ select extend_campaign('eb000000-0000-0000-0000-000000000001', now() + interval '7 days', 'x') $$, 'سبب', 'reason required');
select extend_campaign('eb000000-0000-0000-0000-000000000001', now() + interval '7 days', 'تمديد بقرار المدير العام لنهاية الشهر');
select pg_temp.logout();
select pg_temp.check((evaluate_promotion('fb000000-0000-0000-0000-000000000001', 'monthly_rental', 1000, 'NOV-OFFER')->>'ok')::boolean,
  'coupon valid after the extension');
select pg_temp.check((select count(*) from campaign_extensions where campaign_id = 'eb000000-0000-0000-0000-000000000001') = 1, 'extension logged');
-- history: a campaign linked to a lead can't be deleted
insert into leads (full_name, phone, source_code, campaign_id) values ('بدر آل منيف', '0551231109', 'snapchat', 'eb000000-0000-0000-0000-000000000001');
select pg_temp.rejects($$ delete from campaigns where id = 'eb000000-0000-0000-0000-000000000001' $$, 'لا تُحذف', 'campaign history deleted');

-- ---------- wheel ----------
select pg_temp.rejects($$ insert into wheel_prizes (label, prize_type, value, probability) values ('خصم 30٪', 'discount', 30, 5) $$,
  'حدّد الخدمات', 'big discount on all services');
update wheel_prizes set is_active = false;
insert into wheel_prizes (label, prize_type, value, probability, service_codes, max_discount_amount, coupon_valid_days, sort_order)
values ('خصم 25٪ على التأجير الشهري', 'discount', 25, 100, '{monthly_rental}', 500, 14, 1);
update loyalty_config set wheel_spins_per_customer = 1 where id = 1;

select pg_temp.login('ab000000-0000-0000-0000-000000000002');
select pg_temp.rejects($$ select create_wheel_link('cb000000-0000-0000-0000-000000000001') $$, 'صلاحية', 'sales creates links');
select pg_temp.login('ab000000-0000-0000-0000-000000000001');
create temp table tok as select create_wheel_link('cb000000-0000-0000-0000-000000000001')->>'token' as t;
select pg_temp.logout();
do $$
declare v_t text := (select t from tok); v jsonb; r jsonb; p promotions%rowtype;
begin
  perform pg_temp.check(not exists (select 1 from wheel_links where token_hash = v_t), 'token stored hashed only');
  v := wheel_public_view(v_t);
  perform pg_temp.check(v->>'first_name' = 'سعيد' and (v->>'used')::boolean = false, 'public view');
  perform pg_temp.check((v->'prizes'->0->>'chance')::numeric = 100, 'chances shown');
  perform pg_temp.rejects($q$ select wheel_public_view('bad-token') $q$, 'غير صحيح', 'bad token');
  r := spin_wheel_by_token(v_t);
  perform pg_temp.check(r->>'coupon_code' like 'MAS-DISC25-%', 'coupon issued');
  select * into p from promotions where code = r->>'coupon_code';
  perform pg_temp.check(p.service_codes = '{monthly_rental}' and p.max_discount_amount = 500 and p.usage_limit = 1, 'coupon restricted & capped');
  perform pg_temp.check(p.ends_at::date = current_date + 14, 'coupon validity');
  perform pg_temp.check((evaluate_promotion(p.id, 'recruitment', 20000, p.code)->>'ok')::boolean = false, 'not valid on other services');
  perform pg_temp.check((evaluate_promotion(p.id, 'monthly_rental', 10000, p.code)->>'amount')::numeric = 500, 'capped at 500');
  perform pg_temp.rejects(format($q$ select spin_wheel_by_token(%L) $q$, v_t), 'مسبقاً', 'link reused');
  perform pg_temp.check((select customer_id from wheel_spins where coupon_code = r->>'coupon_code') = 'cb000000-0000-0000-0000-000000000001', 'spin linked to the customer');
  -- a second link can't bypass the per-customer limit
end $$;
select pg_temp.login('ab000000-0000-0000-0000-000000000001');
create temp table tok2 as select create_wheel_link('cb000000-0000-0000-0000-000000000001')->>'token' as t;
select pg_temp.logout();
select pg_temp.rejects($$ select spin_wheel_by_token((select t from tok2)) $$, 'تجاوزت', 'per-customer limit');
update wheel_links set expires_at = now() - interval '1 minute' where id = (select id from wheel_links order by created_at desc limit 1);
select pg_temp.login('ab000000-0000-0000-0000-000000000001');
select pg_temp.check((select spins from wheel_report(current_date - 1, current_date) where prize_label like 'خصم 25٪%') = 1, 'wheel report');
select pg_temp.logout();
select 'OK 99zb_campaign_expiry_wheel' as result;
