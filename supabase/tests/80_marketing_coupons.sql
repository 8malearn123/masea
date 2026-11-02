-- Phase 5: campaigns → referral coupons → discount in quote / contract / sale,
-- usage & total discount per coupon, invalid coupons refused, referral recorded.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

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
create or replace function pg_temp.fails(p_sql text, p_expect text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: %', p_msg;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if p_expect is not null and position(p_expect in sqlerrm) = 0 then
    raise exception 'FAIL: % (got: %)', p_msg, sqlerrm;
  end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- the campaign (managed by the GM), recruitment only, running now
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
insert into campaigns (id, name, type, discount_pct, start_at, end_at, is_active, service_codes, description)
values ('f0000000-0000-0000-0000-000000000001', 'عرض الإحالة', 'referral', 10,
        now() - interval '1 day', now() + interval '30 days', true, array['monthly_rental'],
        'خصم 10٪ لمن يحضر عميلاً جديدًا');
select pg_temp.logout();

-- ---------- a branch manager issues coupons: presets only ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select pg_temp.fails($$select create_campaign_coupons('f0000000-0000-0000-0000-000000000001', 1, 15)$$,
                     'صلاحية الإدارة', 'a custom % was issued without management rights');
create temp table t_cp as
  select * from create_campaign_coupons('f0000000-0000-0000-0000-000000000001', 1, 10, 1,
                                        'c0000000-0000-0000-0000-00000000000a', 'NJR-REF');
grant select on t_cp to authenticated;
select pg_temp.check((select count(*) from t_cp where code like 'NJR-REF10-%' and usage_limit = 1
                      and referrer_name = 'محمد آل مرضمة' and service_codes = array['monthly_rental']) = 1,
  'referral coupon issued: 10%, single use, tied to the referrer and the campaign services');
select pg_temp.logout();

-- ---------- eligibility ----------
select pg_temp.check(((calc_price('monthly_rental', jsonb_build_object('nationality','الفلبين','quantity',3,
                        'promotion_code', (select code from t_cp))))->>'discounts')::numeric > 0,
  'valid coupon discounts the covered service');
select pg_temp.check(((calc_price('recruitment', jsonb_build_object('nationality','الفلبين',
                        'promotion_code', (select code from t_cp))))->>'promotion_reason') like '%لا يشمل%',
  'coupon refused on a service outside the campaign');
select pg_temp.check(((calc_price('monthly_rental', jsonb_build_object('nationality','الفلبين',
                        'promotion_code', 'NJR-REF10-XXXXX')))->>'promotion_reason') = 'رمز الكوبون غير صحيح',
  'unknown coupon refused');

-- ---------- quote with the coupon → contract → sale ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
insert into leads (id, full_name, phone, service_code, assigned_to)
values ('e0000000-0000-0000-0000-000000000020', 'شهد آل منصور', '0555000020', 'monthly_rental',
        'a0000000-0000-0000-0000-000000000004');
select create_quote_from_price('monthly_rental',
  jsonb_build_object('nationality','الفلبين','quantity',3,'promotion_code',(select code from t_cp)),
  'شهد آل منصور', '0555000020', current_date + 7, null, null, null,
  jsonb_build_object('lead_id','e0000000-0000-0000-0000-000000000020','start_date',(current_date+2)::text,
                     'duration_unit','month','duration_count',3));
select pg_temp.check((select discount_amount > 0 and coupon_code = (select upper(code) from t_cp)
                      from quotes where lead_id = 'e0000000-0000-0000-0000-000000000020'), 'quote shows the coupon discount');
select pg_temp.logout();
-- approval threshold back to default for this flow (40 set 5%)
update app_config set value = 10 where key = 'quote_approval_discount_pct';
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
select set_quote_status((select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000020'), 'sent');
select set_quote_status((select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000020'), 'accepted');
select convert_quote_to_contract((select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000020'));
select pg_temp.logout();

select pg_temp.check((select count(*) from contracts c join quotes q on q.contract_id = c.id
                      where q.lead_id = 'e0000000-0000-0000-0000-000000000020'
                        and c.discount_amount = q.discount_amount and c.promotion_id = (select id from t_cp)) = 1,
  'contract carries the coupon discount');
select pg_temp.check((select uses = 1 and total_discount > 0 from coupon_stats where promotion_id = (select id from t_cp)),
  'coupon usage and total discount counted');
select pg_temp.check((select usage_count from promotions where id = (select id from t_cp)) = 1, 'usage counter consumed');
select pg_temp.check(((calc_price('monthly_rental', jsonb_build_object('nationality','الفلبين','quantity',3,
                        'promotion_code', (select code from t_cp))))->>'promotion_reason') like '%استُنفد%',
  'a single-use coupon cannot be used twice');
select pg_temp.check((select count(*) from referrals r join contracts c on c.customer_id = r.referred_customer_id
                      join quotes q on q.contract_id = c.id
                      where q.lead_id = 'e0000000-0000-0000-0000-000000000020'
                        and r.referrer_customer_id = 'c0000000-0000-0000-0000-00000000000a' and r.status = 'joined') = 1,
  'the referral is recorded for the referrer commission');

update contracts set status = 'signed', signed_at = now()
 where quote_id = (select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000020');
select pg_temp.check((select s.discount_amount > 0 and s.coupon_code = (select upper(code) from t_cp)
                      from sales s join quotes q on q.contract_id = s.contract_id
                      where q.lead_id = 'e0000000-0000-0000-0000-000000000020'), 'the sale shows the coupon and its discount');

-- ---------- campaign switched off → its coupons stop working ----------
insert into promotions (name, type, code, discount_pct, requires_code, is_active, campaign_id)
values ('كوبون متعدد', 'manual', 'MULTI-REF10', 10, true, true, 'f0000000-0000-0000-0000-000000000001');
update campaigns set is_active = false where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.check(((calc_price('monthly_rental', '{"nationality":"الفلبين","promotion_code":"MULTI-REF10"}'))->>'promotion_reason')
                     like '%الحملة%', 'coupon of a disabled campaign refused');
update campaigns set is_active = true, end_at = now() - interval '1 hour' where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.check(((calc_price('monthly_rental', '{"nationality":"الفلبين","promotion_code":"MULTI-REF10"}'))->>'promotion_reason')
                     like '%خارج فترتها%', 'coupon of an ended campaign refused');

-- ---------- cancellation releases the usage in the stats ----------
update contracts set status = 'cancelled'
 where quote_id = (select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000020');
select pg_temp.check((select uses from coupon_stats where promotion_id = (select id from t_cp)) = 0,
  'a cancelled contract no longer counts as a coupon use');
select pg_temp.check((select usage_count from promotions where id = (select id from t_cp)) = 0,
  'the cancelled use is released on the coupon');

-- ---------- scope ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from coupon_redemptions where promotion_id = (select id from t_cp)) = 0,
  'Jazan BM does not see Najran coupon redemptions');
select pg_temp.logout();

select 'marketing coupons: all checks passed' as result;
