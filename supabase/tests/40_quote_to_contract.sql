-- Phase 1: lead → quote (approval) → contract → order, branch-scoped.
-- Depends on the fixtures of 10_branch_access.sql.
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
create or replace function pg_temp.fails(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: %', p_msg;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- a 20% coupon (over the managed 10% approval threshold)
insert into promotions (name, type, code, discount_pct, requires_code, is_active)
values ('كوبون اختبار الاعتماد', 'manual', 'TEST20', 20, true, true);
-- the price floor caps this discount at 6% of 16,000 — use a 5% approval threshold
update app_config set value = 5 where key = 'quote_approval_discount_pct';

-- ---------- sales rep (Najran) ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
insert into leads (id, full_name, phone, service_code, assigned_to, city)
values ('e0000000-0000-0000-0000-000000000010', 'خالد آل زمانان', '0553000001', 'monthly_rental',
        'a0000000-0000-0000-0000-000000000004', 'نجران');

select create_quote_from_price(
  'monthly_rental', '{"nationality":"الفلبين","quantity":3}'::jsonb,
  'خالد آل زمانان', '0553000001', current_date + 7, 'يشمل التوصيل', null, null,
  jsonb_build_object('lead_id', 'e0000000-0000-0000-0000-000000000010',
                     'start_date', (current_date + 3)::text, 'duration_unit', 'month', 'duration_count', 3,
                     'worker_name', 'ماريا سانتوس',
                     'terms', jsonb_build_array('مدة العقد ثلاثة أشهر', 'السداد مقدمًا')));

select pg_temp.check((select count(*) from quotes where lead_id = 'e0000000-0000-0000-0000-000000000010'
                      and branch_id = 'b0000000-0000-0000-0000-00000000000a'
                      and end_date = (current_date + 3 + interval '3 months')::date - 1
                      and jsonb_array_length(terms) = 2 and gross_amount > 0) = 1,
  'quote linked to the lead, in its branch, with duration, end date and terms');
select pg_temp.check((select stage_code from leads where id = 'e0000000-0000-0000-0000-000000000010') = 'quoted',
  'lead moved to "quoted"');

select set_quote_status((select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000010'), 'sent');
select pg_temp.fails($$select convert_quote_to_contract(
  (select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000010'))$$,
  'a quote that is only sent was converted');
select set_quote_status((select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000010'), 'accepted');

select convert_quote_to_contract((select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000010'));

select pg_temp.check((
  select count(*) from quotes q
    join contracts c on c.id = q.contract_id and c.quote_id = q.id
    join service_requests r on r.id = q.request_id and r.contract_id = c.id
    join leads l on l.id = q.lead_id and l.customer_id = c.customer_id
   where q.lead_id = 'e0000000-0000-0000-0000-000000000010'
     and c.base_amount = q.base_amount and c.gross_amount = q.gross_amount
     and c.status = 'draft' and c.branch_id = 'b0000000-0000-0000-0000-00000000000a'
     and c.start_date = q.start_date and c.end_date = q.end_date
     and l.stage_code = 'won' and r.branch_id = c.branch_id) = 1,
  'contract + order + customer created from the quote, all linked, amounts frozen');
select pg_temp.check((select count(*) from contract_clauses cc join quotes q on q.contract_id = cc.contract_id
                      where q.lead_id = 'e0000000-0000-0000-0000-000000000010') = 2,
  'quote terms became the contract clauses');
select pg_temp.fails($$select convert_quote_to_contract(
  (select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000010'))$$,
  'the same quote was converted twice');

-- discount above the threshold → needs the branch manager
select create_quote_from_price(
  'recruitment', '{"nationality":"الفلبين","promotion_code":"TEST20"}'::jsonb,
  'خالد آل زمانان', '0553000001', current_date + 7, null, null, null,
  jsonb_build_object('lead_id', 'e0000000-0000-0000-0000-000000000010'));
select pg_temp.check((select discount_amount from quotes where coupon_code = 'TEST20') > 0, 'coupon discount stored on the quote');
select pg_temp.fails($$select set_quote_status((select id from quotes where coupon_code = 'TEST20'), 'sent')$$,
  'a quote over the discount threshold was sent without approval');
select set_quote_status((select id from quotes where coupon_code = 'TEST20'), 'pending_approval');
select pg_temp.fails($$select set_quote_status((select id from quotes where coupon_code = 'TEST20'), 'sent')$$,
  'the sales rep approved their own quote');
select pg_temp.logout();

-- ---------- the other branch manager cannot act on it ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from quotes where coupon_code = 'TEST20') = 0, 'Jazan BM does not see the Najran quote');
select pg_temp.fails($$select set_quote_status((select id from quotes where coupon_code = 'TEST20' limit 1), 'sent')$$,
  'Jazan BM approved a Najran quote');
select pg_temp.logout();
-- (the select above returns null for Jazan — also call with the real id as owner-known value)
do $$
declare v uuid := (select id from quotes where coupon_code = 'TEST20');
begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000003', false);
  set local role authenticated;
  begin
    perform set_quote_status(v, 'sent');
    raise exception 'FAIL: Jazan BM approved a Najran quote by id';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
reset role;

-- ---------- Najran branch manager approves ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select set_quote_status((select id from quotes where coupon_code = 'TEST20'), 'sent', 'معتمد');
select pg_temp.check((select approved_by from quotes where coupon_code = 'TEST20') = 'a0000000-0000-0000-0000-000000000002'
                     and (select count(*) from quote_events e join quotes q on q.id = e.quote_id
                          where q.coupon_code = 'TEST20' and e.type in ('submitted_for_approval','approved')) = 2,
  'approval recorded with approver and events');
select pg_temp.logout();

select 'quote to contract: all checks passed' as result;
