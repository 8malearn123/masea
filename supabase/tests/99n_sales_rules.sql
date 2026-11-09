-- Tests for 0085: sales rules — lead ownership, RPC-only quotes, coupon at conversion, VAT from config.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values
  ('b0000000-0000-0000-0000-00000000000b', 'فرع جازان', 'جازان')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('ad000000-0000-0000-0000-000000000061', 'sales18@test'),
  ('ad000000-0000-0000-0000-000000000062', 'sales18b@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('ad000000-0000-0000-0000-000000000061', 'نورة العتيبي', 'sales', 'b0000000-0000-0000-0000-00000000000b'),
  ('ad000000-0000-0000-0000-000000000062', 'هند القرني', 'sales', 'b0000000-0000-0000-0000-00000000000b')
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id, full_name = excluded.full_name;
insert into customers (id, full_name, phone, branch_id) values
  ('c0000000-0000-0000-0000-0000000000f1', 'عميل اختبار المبيعات', '0551110001', 'b0000000-0000-0000-0000-00000000000b')
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

-- ---- 1) a sales rep's new lead is hers and visible to her
select pg_temp.login('ad000000-0000-0000-0000-000000000061');
insert into leads (id, full_name, phone, branch_id, est_value)
values ('1e000000-0000-0000-0000-000000000001', ' فيصل آل منصور ', '+966 55 123 9876', 'b0000000-0000-0000-0000-00000000000b', 16000);
select pg_temp.check((select assigned_to = 'ad000000-0000-0000-0000-000000000061' and phone = '0551239876' and full_name = 'فيصل آل منصور'
                        from leads where id = '1e000000-0000-0000-0000-000000000001'),
  'lead assigned to its creator, phone normalised, name trimmed');
select pg_temp.rejects($$ insert into leads (full_name, phone, branch_id) values ('رقم خطأ', '12345', 'b0000000-0000-0000-0000-00000000000b') $$,
  'leads_phone_chk', 'invalid phone refused');
select pg_temp.rejects($$ insert into leads (full_name, branch_id, est_value) values ('قيمة سالبة', 'b0000000-0000-0000-0000-00000000000b', -5) $$,
  'leads_est_value_chk', 'negative value refused');
select pg_temp.rejects($$ update leads set assigned_to = 'ad000000-0000-0000-0000-000000000062' where id = '1e000000-0000-0000-0000-000000000001' $$,
  'مدير الفرع', 'a rep cannot reassign');
delete from leads where id = '1e000000-0000-0000-0000-000000000001';
select pg_temp.logout();
select pg_temp.check(exists (select 1 from leads where id = '1e000000-0000-0000-0000-000000000001'), 'no hard delete of a lead');

-- ---- 2) quotes are written through the RPCs only
insert into quotes (id, service_code, base_amount, vat_amount, total_amount, status, branch_id, assigned_to, valid_until, customer_name)
values ('9a000000-0000-0000-0000-000000000001', 'daily_rental', 1000, 150, 1150, 'sent', 'b0000000-0000-0000-0000-00000000000b',
        'ad000000-0000-0000-0000-000000000061', current_date - 1, 'عميل اختبار المبيعات')
on conflict (id) do nothing;
select pg_temp.login('ad000000-0000-0000-0000-000000000061');
update quotes set status = 'accepted' where id = '9a000000-0000-0000-0000-000000000001';
delete from quotes where id = '9a000000-0000-0000-0000-000000000001';
select pg_temp.logout();
select pg_temp.check((select status = 'sent' from quotes where id = '9a000000-0000-0000-0000-000000000001'),
  'direct quote update/delete has no effect');

-- ---- 3) contract from an expired quote / exhausted coupon is refused
select pg_temp.rejects($$ insert into contracts (customer_id, branch_id, service_code, base_amount, status, quote_id)
  values ('c0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-00000000000b', 'daily_rental', 1000, 'draft',
          '9a000000-0000-0000-0000-000000000001') $$, 'انتهت صلاحية عرض السعر', 'expired quote cannot become a contract');
insert into promotions (id, name, type, code, discount_pct, usage_limit, usage_count, requires_code, is_active)
values ('9b000000-0000-0000-0000-000000000001', 'كوبون اختبار لمرة واحدة', 'manual', 'T18-ONCE', 10, 1, 1, true, true)
on conflict (id) do nothing;
select pg_temp.rejects($$ insert into contracts (customer_id, branch_id, service_code, gross_amount, discount_amount, base_amount, status, promotion_id)
  values ('c0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-00000000000b', 'daily_rental', 1000, 100, 900, 'draft',
          '9b000000-0000-0000-0000-000000000001') $$, 'استُنفد الحد', 'exhausted coupon refused at contract creation');

-- ---- 4) VAT follows the managed rate; a quote contract keeps the quote VAT
update pricing_config set vat_rate = 0.10 where id = 1;
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status)
values ('9c000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-00000000000b',
        'daily_rental', 1000, 'draft');
select pg_temp.check((select vat_amount = 100 and total_amount = 1100 from contracts where id = '9c000000-0000-0000-0000-000000000001'),
  'VAT from pricing_config (10%)');
update contracts set vat_amount = 1 where id = '9c000000-0000-0000-0000-000000000001';
select pg_temp.check((select vat_amount = 100 from contracts where id = '9c000000-0000-0000-0000-000000000001'), 'VAT cannot be typed over');
update contracts set base_amount = 2000 where id = '9c000000-0000-0000-0000-000000000001';
select pg_temp.check((select vat_amount = 200 and total_amount = 2200 from contracts where id = '9c000000-0000-0000-0000-000000000001'),
  'VAT recomputed when the base changes');
update quotes set valid_until = current_date + 5 where id = '9a000000-0000-0000-0000-000000000001';
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, quote_id)
values ('9c000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-00000000000b',
        'daily_rental', 1000, 'draft', '9a000000-0000-0000-0000-000000000001');
select pg_temp.check((select vat_amount = 150 and total_amount = 1150 from contracts where id = '9c000000-0000-0000-0000-000000000002'),
  'a quote contract keeps the quote VAT');
update pricing_config set vat_rate = 0.15 where id = 1;

-- ---- 5) Musaned number frozen on a finished contract; 6) old renewal removed
update contracts set status = 'cancelled' where id = '9c000000-0000-0000-0000-000000000001';
select pg_temp.login('ad000000-0000-0000-0000-000000000061');
select pg_temp.rejects($$ select set_musaned_contract_no('9c000000-0000-0000-0000-000000000001', 'MS-1') $$,
  'منتهٍ أو ملغى', 'Musaned number frozen on a cancelled contract');
select pg_temp.logout();
select pg_temp.check(not exists (select 1 from pg_proc where proname = 'renew_contract' and pronargs = 1), 'renew_contract(uuid) dropped');
\echo 'OK 99n_sales_rules'
