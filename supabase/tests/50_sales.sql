-- Phase 2: sales are pulled from contracts once, branch/role-scoped, with notes.
-- Depends on fixtures of 10/40 (the Najran rep's contract from a quote).
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

-- the contract created from the rep's quote (40_quote_to_contract)
create temp table t_c as
  select c.* from contracts c join quotes q on q.contract_id = c.id
   where q.lead_id = 'e0000000-0000-0000-0000-000000000010';
grant select on t_c to authenticated;

select pg_temp.check((select count(*) from sales where contract_id = (select id from t_c)) = 0,
  'a draft contract is not a sale');

-- signing makes it a sale (status set as owner — the transition itself is tested elsewhere)
update contracts set status = 'signed', signed_at = now() where id = (select id from t_c);
update contracts set status = 'active' where id = (select id from t_c);
select pg_temp.check((select count(*) from sales where contract_id = (select id from t_c)) = 1,
  'signed then active contract = exactly one sale');
select pg_temp.check((
  select count(*) from sales s, t_c c
   where s.contract_id = c.id and s.net_amount = c.base_amount and s.total_amount = c.total_amount
     and s.gross_amount = coalesce(c.gross_amount, c.base_amount)
     and s.sold_by = 'a0000000-0000-0000-0000-000000000004' and s.sold_by_name = 'نايف اليامي'
     and s.quote_id = c.quote_id and s.worker_name = 'ماريا سانتوس'
     and s.branch_id = 'b0000000-0000-0000-0000-00000000000a' and s.status = 'confirmed') = 1,
  'sale carries the contract amounts, quote, worker and the responsible rep');

-- a sale by someone else in the same branch
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no)
values ('d0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-00000000000a',
        'b0000000-0000-0000-0000-00000000000a', 'daily_rental', 300, 'signed', 'MAS-2026-90002');
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no)
values ('d0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-00000000000b',
        'b0000000-0000-0000-0000-00000000000b', 'monthly_rental', 2500, 'signed', 'MAS-2026-90003');

-- ---------- sales rep: own sales only, notes on own sale ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
select pg_temp.check((select count(*) from sales) = 1, 'the rep sees only their own sale');
insert into sale_notes (sale_id, note) select id, 'العميل طلب تأجيل البداية أسبوعًا' from sales;
select pg_temp.check((select created_by_name from sale_notes limit 1) = 'نايف اليامي', 'note stamped with its author');
do $$ begin
  update sales set net_amount = 1;
  if found then raise exception 'FAIL: a sale was edited by a user'; end if;
end $$;
do $$ begin
  insert into sales (contract_id) values ('d0000000-0000-0000-0000-00000000000a');
  raise exception 'FAIL: a sale was inserted by hand';
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

-- ---------- branch managers ----------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
-- 3 = the rep's sale, another rep's sale and the website daily-rental contract (20_existing_flows)
select pg_temp.check((select count(*) from sales) = 3, 'Najran BM sees every Najran sale and only those');
insert into sale_notes (sale_id, note)
  select id, 'تمت مراجعة العملية' from sales where contract_id = 'd0000000-0000-0000-0000-0000000000a2';
select pg_temp.logout();

select pg_temp.login('a0000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from sales) = 1, 'Jazan BM sees only the Jazan sale');
select pg_temp.check((select count(*) from sale_notes) = 0, 'Jazan BM sees no Najran notes');
do $$ begin
  insert into sale_notes (sale_id, note)
    select id, 'محاولة' from sales where contract_id = 'd0000000-0000-0000-0000-0000000000a2';
  if found then raise exception 'FAIL: Jazan BM noted a Najran sale'; end if;
exception when insufficient_privilege then null;
end $$;
select pg_temp.logout();

-- ---------- cancellation keeps the row, flips the status ----------
update contracts set status = 'cancelled' where id = 'd0000000-0000-0000-0000-0000000000a2';
select pg_temp.check((select status from sales where contract_id = 'd0000000-0000-0000-0000-0000000000a2') = 'cancelled'
                     and (select cancelled_at from sales where contract_id = 'd0000000-0000-0000-0000-0000000000a2') is not null,
  'cancelled contract → cancelled sale (kept)');
update contracts set status = 'completed' where id = (select id from t_c);
select pg_temp.check((select status from sales where contract_id = (select id from t_c)) = 'completed',
  'completed contract → completed sale');

do $$ begin
  update sale_notes set note = 'تعديل';
  raise exception 'FAIL: a sale note was edited';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

select 'sales: all checks passed' as result;
