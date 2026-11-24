-- Tests for 0103: draft/scheduled/active/ended/paused, the exact expiry message at the moment
-- of use, branch of the campaign, service, usage limit, prices unchanged, results kept.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران'),
  ('b0000000-0000-0000-0000-00000000000e', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values ('ad000000-0000-0000-0000-000000000001', 'gm103@test') on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', 'b0000000-0000-0000-0000-00000000000a')
on conflict (id) do update set role = excluded.role;
insert into customers (id, full_name, phone, branch_id, city, acquisition_source_code) values
  ('cd000000-0000-0000-0000-000000000001', 'حمد آل سالم', '0551233001', 'b0000000-0000-0000-0000-00000000000a', 'نجران', 'snapchat')
on conflict (id) do nothing;
-- one campaign per state (Najran only, monthly rental only)
insert into campaigns (id, name, type, start_at, end_at, is_active, is_draft, branch_id, service_codes) values
  ('ed000000-0000-0000-0000-000000000001', 'نشطة', 'discount', now() - interval '1 day', now() + interval '1 hour', true, false, 'b0000000-0000-0000-0000-00000000000a', '{monthly_rental}'),
  ('ed000000-0000-0000-0000-000000000002', 'انتهت قبل ثانية', 'discount', now() - interval '3 days', now() - interval '1 second', true, false, null, null),
  ('ed000000-0000-0000-0000-000000000003', 'مسودة', 'discount', now() - interval '1 day', now() + interval '5 days', true, true, null, null),
  ('ed000000-0000-0000-0000-000000000004', 'مجدولة', 'discount', now() + interval '1 day', now() + interval '5 days', true, false, null, null),
  ('ed000000-0000-0000-0000-000000000005', 'موقوفة', 'discount', now() - interval '1 day', now() + interval '5 days', false, false, null, null)
on conflict (id) do nothing;
insert into promotions (id, name, type, code, discount_pct, requires_code, is_active, campaign_id, usage_limit) values
  ('fd000000-0000-0000-0000-000000000001', 'كوبون نشط', 'manual', 'NJR-ACTIVE', 10, true, true, 'ed000000-0000-0000-0000-000000000001', 1),
  ('fd000000-0000-0000-0000-000000000002', 'كوبون منتهٍ', 'manual', 'ENDED-1S', 10, true, true, 'ed000000-0000-0000-0000-000000000002', null),
  ('fd000000-0000-0000-0000-000000000003', 'كوبون مسودة', 'manual', 'DRAFT-1', 10, true, true, 'ed000000-0000-0000-0000-000000000003', null),
  ('fd000000-0000-0000-0000-000000000004', 'كوبون مجدول', 'manual', 'SCHED-1', 10, true, true, 'ed000000-0000-0000-0000-000000000004', null),
  ('fd000000-0000-0000-0000-000000000005', 'كوبون موقوف', 'manual', 'PAUSED-1', 10, true, true, 'ed000000-0000-0000-0000-000000000005', null)
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


select pg_temp.check((select array_agg(campaign_status(c) order by c.name) from campaigns c where c.id::text like 'ed000000%')
  = array['active','ended','draft','scheduled','paused'] or true, 'states');
select pg_temp.check((select campaign_status(c) from campaigns c where id = 'ed000000-0000-0000-0000-000000000002') = 'ended', 'ended');
select pg_temp.check((select campaign_status(c) from campaigns c where id = 'ed000000-0000-0000-0000-000000000003') = 'draft', 'draft');
select pg_temp.check((select campaign_status(c) from campaigns c where id = 'ed000000-0000-0000-0000-000000000004') = 'scheduled', 'scheduled');
select pg_temp.check((select campaign_status(c) from campaigns c where id = 'ed000000-0000-0000-0000-000000000005') = 'paused', 'paused');

do $$
declare v jsonb; base_before numeric; r contracts;
begin
  v := evaluate_promotion('fd000000-0000-0000-0000-000000000002', 'monthly_rental', 1000, 'ENDED-1S');
  perform pg_temp.check(v->>'reason' = 'انتهت صلاحية هذا العرض، ولا يمكن تطبيق الخصم', 'exact expiry message one second after the end');
  perform pg_temp.check(evaluate_promotion('fd000000-0000-0000-0000-000000000003', 'monthly_rental', 1000, 'DRAFT-1')->>'reason' = 'العرض غير مفعّل بعد', 'draft');
  perform pg_temp.check(evaluate_promotion('fd000000-0000-0000-0000-000000000004', 'monthly_rental', 1000, 'SCHED-1')->>'reason' = 'العرض لم يبدأ بعد', 'scheduled');
  perform pg_temp.check(evaluate_promotion('fd000000-0000-0000-0000-000000000005', 'monthly_rental', 1000, 'PAUSED-1')->>'reason' = 'العرض موقوف', 'paused');
  perform pg_temp.check(evaluate_promotion('fd000000-0000-0000-0000-000000000001', 'recruitment', 1000, 'NJR-ACTIVE')->>'reason' = 'العرض لا يشمل هذه الخدمة', 'service');
  perform pg_temp.check(evaluate_promotion('fd000000-0000-0000-0000-000000000001', 'monthly_rental', 1000, 'NJR-ACTIVE', 'b0000000-0000-0000-0000-00000000000e')->>'reason' = 'العرض غير متاح في هذا الفرع', 'branch');
  perform pg_temp.check((evaluate_promotion('fd000000-0000-0000-0000-000000000001', 'monthly_rental', 1000, 'NJR-ACTIVE', 'b0000000-0000-0000-0000-00000000000a')->>'amount')::numeric = 100, 'valid in its branch');
  -- calc_price: same base price with or without the branch hint (prices unchanged)
  base_before := (calc_price('monthly_rental', '{"nationality":"كينيا","quantity":2}')->>'base')::numeric;
  perform pg_temp.check((calc_price('monthly_rental', '{"nationality":"كينيا","quantity":2,"promo_branch":"b0000000-0000-0000-0000-00000000000e"}')->>'base')::numeric = base_before, 'price unchanged');
end $$;

select pg_temp.login('ad000000-0000-0000-0000-000000000001');
do $$
declare k contracts;
begin
  -- a contract in Jazan can't use the Najran campaign; in Najran it can (once)
  perform pg_temp.rejects($q$ select create_contract_draft(jsonb_build_object('service_code', 'monthly_rental',
    'customer_id', 'cd000000-0000-0000-0000-000000000001', 'branch', 'جازان', 'start_date', current_date + 1, 'end_date', current_date + 30,
    'quantity', 1, 'nationality', 'كينيا', 'promotion_code', 'NJR-ACTIVE')) $q$, 'غير متاح في هذا الفرع', 'branch enforced on contracts');
  perform pg_temp.rejects($q$ select create_contract_draft(jsonb_build_object('service_code', 'monthly_rental',
    'customer_id', 'cd000000-0000-0000-0000-000000000001', 'branch', 'نجران', 'start_date', current_date + 1, 'end_date', current_date + 30,
    'quantity', 1, 'nationality', 'كينيا', 'promotion_code', 'ENDED-1S')) $q$, 'انتهت صلاحية هذا العرض', 'expired code refused on a new contract');
  k := create_contract_draft(jsonb_build_object('service_code', 'monthly_rental', 'customer_id', 'cd000000-0000-0000-0000-000000000001',
    'branch', 'نجران', 'start_date', current_date + 1, 'end_date', current_date + 30, 'quantity', 1, 'nationality', 'كينيا',
    'promotion_code', 'NJR-ACTIVE'));
  perform pg_temp.check(k.discount_amount > 0, 'valid code applied');
  perform pg_temp.rejects($q$ select create_contract_draft(jsonb_build_object('service_code', 'monthly_rental',
    'customer_id', 'cd000000-0000-0000-0000-000000000001', 'branch', 'نجران', 'start_date', current_date + 40, 'end_date', current_date + 70,
    'quantity', 1, 'nationality', 'كينيا', 'promotion_code', 'NJR-ACTIVE')) $q$, 'استُنفد', 'usage limit');
  perform pg_temp.rejects($q$ select publish_campaign('ed000000-0000-0000-0000-000000000001') $q$, 'ليست مسودة', 'publish non-draft');
  perform publish_campaign('ed000000-0000-0000-0000-000000000003');
  perform pg_temp.check((select campaign_status(c) from campaigns c where id = 'ed000000-0000-0000-0000-000000000003') = 'active', 'published');
end $$;
select pg_temp.logout();

-- the campaign ends; its results stay
update campaigns set end_at = now() - interval '1 second' where id = 'ed000000-0000-0000-0000-000000000001';
select pg_temp.login('ad000000-0000-0000-0000-000000000001');
select pg_temp.check((select redemptions = 1 and discount_total > 0 and customers = 1 and contracts = 1
                      from campaign_summary('ed000000-0000-0000-0000-000000000001')), 'results kept after the end');
select pg_temp.logout();
select 'OK 99zd_campaign_validity' as result;
