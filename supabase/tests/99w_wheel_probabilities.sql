-- Tests for 0105: the approved distribution (= 100%), values untouched, disabled prizes kept at 0%,
-- a total other than 100% is never persisted, server-side pick by cumulative ranges, a large
-- random sample close to the approved odds, each spin saved once with the right grant
-- (points / wallet / nothing for «حظ أوفر»), and the result's prize_id = the saved spin.
-- Runs before 99zb/99ze (which replace the prizes for their own scenarios).
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

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000d', 'فرع حبونا', 'حبونا')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-000000000001', 'gm105@test'),
  ('a7000000-0000-0000-0000-000000000002', 'sales105@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a7000000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', 'b0000000-0000-0000-0000-00000000000d'),
  ('a7000000-0000-0000-0000-000000000002', 'لمى آل سالم', 'sales', 'b0000000-0000-0000-0000-00000000000d')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

-- ---------- 1) the approved distribution ----------
do $$
declare r record;
begin
  for r in select * from (values ('100 نقطة', 'points', 100, 40, true), ('20 ريال محفظة', 'wallet', 20, 25, true),
                                 ('500 نقطة', 'points', 500, 10, true), ('50 ريال محفظة', 'wallet', 50, 5, true),
                                 ('حظ أوفر', 'none', 0, 20, true), ('خصم 10٪', 'discount', 10, 0, false),
                                 ('تأجيل مجاني', 'free_service', 1, 0, false)) v(label, t, val, prob, act) loop
    perform pg_temp.check((select count(*) from wheel_prizes p where p.label = r.label and p.prize_type = r.t
                             and p.value = r.val and p.probability = r.prob and p.is_active = r.act) = 1,
                          'prize ' || r.label);
  end loop;
end $$;
select pg_temp.check(wheel_probability_total() = 100, 'active total = 100');
select pg_temp.check((select count(*) from wheel_prizes where is_active) = 5, 'five active prizes');

-- ---------- 2) never persisted unless the active total is 100 ----------
select pg_temp.rejects($$ update wheel_prizes set probability = 45 where label = '100 نقطة' $$, 'يساوي 100', 'single edit → 105%');
select pg_temp.rejects($$ update wheel_prizes set is_active = false where label = 'حظ أوفر' $$, 'يساوي 100', 'disable → 80%');
select pg_temp.check((select probability from wheel_prizes where label = '100 نقطة') = 40, 'refused edit not saved');
select pg_temp.login('a7000000-0000-0000-0000-000000000002');
select pg_temp.rejects(format($q$ select set_wheel_probabilities(%L) $q$,
  (select jsonb_agg(jsonb_build_object('id', id, 'probability', probability)) from wheel_prizes)), 'صلاحية', 'sales edits odds');
select pg_temp.login('a7000000-0000-0000-0000-000000000001');
select pg_temp.rejects(format($q$ select set_wheel_probabilities(%L) $q$,
  jsonb_build_array(jsonb_build_object('id', (select id from wheel_prizes where label = '100 نقطة'), 'probability', 30))),
  'يساوي 100', 'bulk edit → 90%');
-- a valid bulk edit (move 5 points between two prizes) then restore the approved odds
select set_wheel_probabilities(jsonb_build_array(
  jsonb_build_object('id', (select id from wheel_prizes where label = '100 نقطة'), 'probability', 35),
  jsonb_build_object('id', (select id from wheel_prizes where label = 'حظ أوفر'), 'probability', 25)));
select pg_temp.check((select probability from wheel_prizes where label = 'حظ أوفر') = 25, 'bulk edit saved');
select set_wheel_probabilities(jsonb_build_array(
  jsonb_build_object('id', (select id from wheel_prizes where label = '100 نقطة'), 'probability', 40),
  jsonb_build_object('id', (select id from wheel_prizes where label = 'حظ أوفر'), 'probability', 20)));
select pg_temp.logout();
select pg_temp.check(wheel_probability_total() = 100 and (select probability from wheel_prizes where label = '100 نقطة') = 40, 'restored');
select pg_temp.check((select count(*) from audit_log where table_name = 'wheel_prizes') >= 4, 'odds edits audited');

-- ---------- 3) server-side pick: cumulative ranges in display order ----------
do $$
declare f text;
begin
  f := (select label from wheel_prizes where id = wheel_pick_prize(0));        perform pg_temp.check(f = '100 نقطة', 'r=0');
  f := (select label from wheel_prizes where id = wheel_pick_prize(39.999));   perform pg_temp.check(f = '100 نقطة', 'r=39.999');
  f := (select label from wheel_prizes where id = wheel_pick_prize(40));       perform pg_temp.check(f = '20 ريال محفظة', 'r=40');
  f := (select label from wheel_prizes where id = wheel_pick_prize(64.999));   perform pg_temp.check(f = '20 ريال محفظة', 'r=64.999');
  f := (select label from wheel_prizes where id = wheel_pick_prize(65));       perform pg_temp.check(f = '500 نقطة', 'r=65 (disabled 10% skipped)');
  f := (select label from wheel_prizes where id = wheel_pick_prize(75));       perform pg_temp.check(f = '50 ريال محفظة', 'r=75 (disabled delay skipped)');
  f := (select label from wheel_prizes where id = wheel_pick_prize(80));       perform pg_temp.check(f = 'حظ أوفر', 'r=80');
  f := (select label from wheel_prizes where id = wheel_pick_prize(99.9999));  perform pg_temp.check(f = 'حظ أوفر', 'r→100');
end $$;

-- a large random sample (100,000 picks) lands within ±1 point of each approved odd (≈6σ)
create temp table sample as
  select p.label, p.probability, count(*)::numeric * 100 / 100000 as pct
    from generate_series(1, 100000) g
    cross join lateral (select wheel_pick_prize((random() * 100 + g * 0)::numeric) as pid) x   -- one draw per row
    join wheel_prizes p on p.id = x.pid
   group by p.label, p.probability;
do $$
declare r record;
begin
  perform pg_temp.check((select count(*) from sample) = 5, 'only the five active prizes drawn');
  perform pg_temp.check(not exists (select 1 from sample where label in ('خصم 10٪', 'تأجيل مجاني')), 'disabled never drawn');
  for r in select * from sample loop
    perform pg_temp.check(abs(r.pct - r.probability) < 1, format('%s: %s%% vs %s%%', r.label, r.pct, r.probability));
    raise notice '% → % %% (approved %)', r.label, r.pct, r.probability;
  end loop;
end $$;
select label, probability as approved, pct as observed from sample order by probability desc;

-- ---------- 4) real spins: saved once, right grant, prize_id matches ----------
insert into customers (id, full_name, phone, branch_id, city)
select ('c7000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'عميل تجربة العجلة ' || g,
       '0557' || lpad(g::text, 6, '0'), 'b0000000-0000-0000-0000-00000000000d', 'حبونا'
  from generate_series(1, 400) g
on conflict (id) do nothing;
update loyalty_config set wheel_spins_per_customer = 1 where id = 1;
create temp table spun as
  select c.id as customer_id, spin_wheel_core(c.id, null, null) as r
    from customers c where c.id::text like 'c7000000-%';
do $$
declare n_points int; n_wallet int;
begin
  perform pg_temp.check((select count(*) from spun) = 400, '400 spins');
  -- each spin saved exactly once, and the shown prize = the saved prize
  perform pg_temp.check((select count(*) from wheel_spins s join spun x on x.customer_id = s.customer_id) = 400, 'one row per spin');
  perform pg_temp.check(not exists (select 1 from spun x join wheel_spins s on s.id = (x.r->>'spin_id')::uuid
                                     where s.prize_id <> (x.r->>'prize_id')::uuid or s.customer_id <> x.customer_id),
                        'result prize_id = saved spin');
  perform pg_temp.check(not exists (select 1 from spun where r->>'label' in ('خصم 10٪', 'تأجيل مجاني')), 'no disabled prize won');
  -- grants: points → one points entry of the prize value; wallet → one credit; «حظ أوفر» → nothing
  perform pg_temp.check(not exists (
    select 1 from spun x
     where (select coalesce(sum(points), 0) from points_ledger l where l.customer_id = x.customer_id)
           <> case when x.r->>'prize_type' = 'points' then (x.r->>'value')::numeric else 0 end
        or (select coalesce(sum(amount), 0) from wallet_ledger w where w.customer_id = x.customer_id)
           <> case when x.r->>'prize_type' = 'wallet' then (x.r->>'value')::numeric else 0 end), 'grants match prizes');
  perform pg_temp.check(not exists (select 1 from spun x where x.r->>'label' = 'حظ أوفر'
      and (exists (select 1 from points_ledger l where l.customer_id = x.customer_id)
           or exists (select 1 from wallet_ledger w where w.customer_id = x.customer_id))), 'better luck grants nothing');
  select count(*) into n_points from points_ledger where customer_id::text like 'c7000000-%';
  select count(*) into n_wallet from wallet_ledger where customer_id::text like 'c7000000-%';
  perform pg_temp.check(n_points = (select count(*) from spun where r->>'prize_type' = 'points')
                    and n_wallet = (select count(*) from spun where r->>'prize_type' = 'wallet'), 'no double grant');
end $$;
-- a second spin for the same customer is refused (nothing granted twice)
select pg_temp.rejects($$ select spin_wheel_core('c7000000-0000-0000-0000-000000000001', null, null) $$, 'سبق لك المشاركة', 'second spin');
select pg_temp.check((select count(*) from wheel_spins where customer_id = 'c7000000-0000-0000-0000-000000000001') = 1, 'still one spin');

select 'OK 99w_wheel_probabilities' as result;
