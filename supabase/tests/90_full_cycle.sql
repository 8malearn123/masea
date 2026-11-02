-- Phase 6: the whole customer cycle across the modules, as the real roles:
-- campaign coupon → lead → quote (approval) → contract (real transitions +
-- signatures) → sale → customer insights → hourly booking → second sale,
-- with visibility per branch / role and the audit trail.
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

-- an accountant (cross-branch, read-only on sales)
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000007', 'acc@test') on conflict do nothing;
insert into user_profiles (id, full_name, role, branch_id)
values ('a0000000-0000-0000-0000-000000000007', 'هالة السبيعي', 'accountant', null)
on conflict (id) do update set role = 'accountant';
update app_config set value = 5 where key = 'quote_approval_discount_pct';

-- 1) GM: the campaign
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
insert into campaigns (id, name, type, discount_pct, start_at, end_at, is_active, service_codes)
values ('f0000000-0000-0000-0000-000000000009', 'عرض الشتاء — التأجير الشهري', 'seasonal', 10,
        now() - interval '1 day', now() + interval '60 days', true, array['monthly_rental']);
select pg_temp.logout();

-- 2) Najran BM: a referral coupon for an existing customer
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
create temp table t_cp as
  select * from create_campaign_coupons('f0000000-0000-0000-0000-000000000009', 1, 10, 1,
                                        'c0000000-0000-0000-0000-00000000000a', 'WIN');
grant select on t_cp to authenticated;
select pg_temp.logout();

-- 3) sales rep: lead → follow-up → quote with the coupon → submit for approval
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
insert into leads (id, full_name, phone, service_code, source_code, assigned_to, city)
values ('e0000000-0000-0000-0000-000000000090', 'عبير آل حيدر', '0559000090', 'monthly_rental', 'referral',
        'a0000000-0000-0000-0000-000000000004', 'نجران');
insert into lead_activities (lead_id, kind, note) values ('e0000000-0000-0000-0000-000000000090', 'call', 'شرح عرض الشتاء');
select create_quote_from_price('monthly_rental',
  jsonb_build_object('nationality','الفلبين','quantity',3,'promotion_code',(select code from t_cp)),
  'عبير آل حيدر', '0559000090', current_date + 7, null, null, null,
  jsonb_build_object('lead_id','e0000000-0000-0000-0000-000000000090',
                     'start_date',(current_date + 1)::text,'duration_unit','month','duration_count',3,
                     'terms', jsonb_build_array('مدة العقد ثلاثة أشهر', 'السداد مقدمًا')));
create temp table t_q as select id from quotes where lead_id = 'e0000000-0000-0000-0000-000000000090';
grant select on t_q to authenticated;
select set_quote_status((select id from t_q), 'pending_approval');
select pg_temp.logout();

-- 4) BM approves; the customer accepts; the rep converts
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select set_quote_status((select id from t_q), 'sent', 'معتمد — خصم الحملة');
select pg_temp.logout();
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
select set_quote_status((select id from t_q), 'accepted');
select convert_quote_to_contract((select id from t_q));
create temp table t_c as select contract_id as id, customer_id from quotes where id = (select id from t_q);
grant select on t_c to authenticated;
select pg_temp.logout();

-- 5) BM runs the contract lifecycle (real transitions + both signatures)
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select transition_contract((select id from t_c), 'pending_approval');
select transition_contract((select id from t_c), 'approved');
select transition_contract((select id from t_c), 'awaiting_signature');
select pg_temp.logout();
insert into contract_signatures (contract_id, signer_type, signer_name)
select id, 'customer', 'عبير آل حيدر' from t_c union all select id, 'company', 'فهد آل منصور' from t_c;
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select transition_contract((select id from t_c), 'signed');
select transition_contract((select id from t_c), 'active');
select pg_temp.logout();

select pg_temp.check((
  select count(*) from sales s, t_c, quotes q
   where s.contract_id = t_c.id and q.id = (select id from t_q)
     and s.discount_amount = q.discount_amount and s.discount_amount > 0
     and s.coupon_code = (select upper(code) from t_cp)
     and s.sold_by_name = 'نايف اليامي' and s.status = 'confirmed') = 1,
  'one sale, with the coupon discount and the responsible rep');
select pg_temp.check((select uses = 1 from coupon_stats where promotion_id = (select id from t_cp)), 'coupon use counted');
select pg_temp.check((select count(*) from referrals where referrer_customer_id = 'c0000000-0000-0000-0000-00000000000a'
                      and referred_customer_id = (select customer_id from t_c)) = 1, 'referral recorded for the referrer');
select pg_temp.check((select status from service_requests r join t_c on r.contract_id = t_c.id) = 'new',
  'the operational order exists for dispatch');

-- 6) the customer file reflects it
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select pg_temp.check((select purchases = 1 and active_contracts = 1 and last_contact_at is not null
                      from customer_insights where id = (select customer_id from t_c)),
  'customer insights: 1 purchase, a worker now, contact from the lead log');

-- 7) an hourly booking for the same customer → second sale → repeat customer
select book_hourly(jsonb_build_object(
  'worker_profile_id', (select id from worker_profiles where full_name = 'نيلوكا فرناندو'),
  'booking_date', (current_date + 3)::text, 'start_time', '15:00', 'end_time', '21:00',
  'profession', 'رعاية', 'customer_id', (select customer_id from t_c)));
create temp table t_h as select contract_id as id from worker_bookings
  where customer_id = (select customer_id from t_c);
grant select on t_h to authenticated;
select transition_contract((select id from t_h), 'pending_approval');
select transition_contract((select id from t_h), 'approved');
select transition_contract((select id from t_h), 'awaiting_signature');
select pg_temp.logout();
insert into contract_signatures (contract_id, signer_type, signer_name)
select id, 'customer', 'عبير آل حيدر' from t_h union all select id, 'company', 'فهد آل منصور' from t_h;
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
select transition_contract((select id from t_h), 'signed');
select pg_temp.check((select purchases from customer_insights where id = (select customer_id from t_c)) = 2,
  'second purchase (hourly) — the customer is now a repeat customer');
select pg_temp.check((select count(*) from sales where contract_id in (select id from t_c union select id from t_h)) = 2,
  'two sales, one per contract');
select pg_temp.logout();

-- 8) visibility by branch and role
select pg_temp.login('a0000000-0000-0000-0000-000000000003');   -- Jazan BM
select pg_temp.check((select count(*) from leads where id = 'e0000000-0000-0000-0000-000000000090') = 0
                 and (select count(*) from quotes where id = (select id from t_q)) = 0
                 and (select count(*) from contracts where id = (select id from t_c)) = 0
                 and (select count(*) from sales where contract_id = (select id from t_c)) = 0
                 and (select count(*) from customer_insights where id = (select customer_id from t_c)) = 0
                 and (select count(*) from worker_bookings where contract_id = (select id from t_h)) = 0
                 and (select count(*) from audit_log where record_id = (select id from t_c)) = 0,
  'the other branch sees none of the cycle');
select pg_temp.logout();

select pg_temp.login('a0000000-0000-0000-0000-000000000007');   -- accountant
select pg_temp.check((select count(*) from sales where contract_id in (select id from t_c union select id from t_h)) = 2,
  'the accountant reads the sales of every branch');
do $$ begin
  insert into sale_notes (sale_id, note) select id, 'محاولة' from sales limit 1;
  raise exception 'FAIL: the accountant wrote a sale note';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

select pg_temp.login('a0000000-0000-0000-0000-000000000006');   -- housing supervisor
select pg_temp.check((select count(*) from sales) = 0 and (select count(*) from customer_insights) = 0
                 and (select count(*) from quotes) = 0,
  'a role without these modules sees nothing');
select pg_temp.logout();

-- 9) the audit trail covers the cycle, attributed
select pg_temp.check((select count(distinct table_name) from audit_log
                      where table_name in ('quotes','contracts','sales','promotions','worker_bookings','leads')
                        and created_at > now() - interval '1 hour') = 6,
  'audit rows for quotes, contracts, sales, coupons, bookings and leads');
select pg_temp.check((select count(*) from audit_log where action = 'contract.transition'
                      and record_id = (select id from t_c) and actor_name = 'فهد آل منصور') = 5,
  'every contract transition audited with the actor');

select 'full cycle: all checks passed' as result;
