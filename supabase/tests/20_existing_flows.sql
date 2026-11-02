-- Regression: the flows built before 0061 still work under the strict branch
-- rules (lead → customer → quote → contract; website daily-rental order →
-- contract from accepted terms). Depends on the fixtures of 10_branch_access.sql.
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
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- sales rep (Najran): the full sales journey ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');

insert into leads (id, full_name, phone, service_code, assigned_to)
values ('e0000000-0000-0000-0000-000000000001', 'تركي آل عباس', '0552000001', 'recruitment',
        'a0000000-0000-0000-0000-000000000004');
select pg_temp.check((select branch_id from leads where id = 'e0000000-0000-0000-0000-000000000001')
                     = 'b0000000-0000-0000-0000-00000000000a', 'lead created in the rep''s branch');

select convert_lead_to_customer('e0000000-0000-0000-0000-000000000001');
select pg_temp.check((select c.branch_id from customers c join leads l on l.customer_id = c.id
                      where l.id = 'e0000000-0000-0000-0000-000000000001')
                     = 'b0000000-0000-0000-0000-00000000000a', 'lead converted to a customer of the branch');

select create_quote_from_price('recruitment', '{"nationality":"الفلبين"}'::jsonb,
                               'تركي آل عباس', '0552000001', current_date + 7);
select pg_temp.check((select count(*) from quotes where customer_phone = '0552000001'
                      and branch_id = 'b0000000-0000-0000-0000-00000000000a' and total_amount > 0) = 1,
  'quote priced by calc_price in the rep''s branch');

select create_contract_draft(jsonb_build_object(
  'service_code', 'recruitment', 'branch', 'b0000000-0000-0000-0000-00000000000a',
  'customer_id', (select customer_id from leads where id = 'e0000000-0000-0000-0000-000000000001'),
  'nationality', 'الفلبين', 'start_date', current_date::text));
select pg_temp.check((select count(*) from contracts c join leads l on l.customer_id = c.customer_id
                      where l.id = 'e0000000-0000-0000-0000-000000000001' and c.status = 'draft') = 1,
  'contract draft created and visible to the rep');

do $$ begin
  perform create_contract_draft(jsonb_build_object(
    'service_code', 'recruitment', 'branch', 'b0000000-0000-0000-0000-00000000000b',
    'customer_id', 'c0000000-0000-0000-0000-00000000000b', 'start_date', current_date::text));
  raise exception 'FAIL: rep created a contract in another branch';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
select pg_temp.logout();

-- ---------- website order (anonymous) → daily-rental contract from accepted terms ----------
set role anon;
insert into service_requests (service_code, customer_name, customer_phone, customer_city, base_amount, details)
values ('daily_rental', 'أمل آل سدران', '0552000002', 'نجران', 300,
        '{"agreeTerms": true, "accepted_terms": ["البند الأول", "البند الثاني"], "start_date": "2026-11-05"}');
reset role;
select pg_temp.check((select branch_id from service_requests where customer_phone = '0552000002')
                     = 'b0000000-0000-0000-0000-00000000000a', 'website order routed to Najran');
select pg_temp.check((select c.branch_id from service_requests r join contracts c on c.id = r.contract_id
                      where r.customer_phone = '0552000002') = 'b0000000-0000-0000-0000-00000000000a',
  'contract from accepted terms created in the routed branch');

select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select pg_temp.check((select count(*) from contracts c join customers cu on cu.id = c.customer_id
                      where cu.phone = '0552000002') = 1, 'Najran BM sees the website contract');
select pg_temp.logout();

select 'existing flows: all checks passed' as result;
