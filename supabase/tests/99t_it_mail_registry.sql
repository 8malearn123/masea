-- Tests for 0093: corporate e-mail registry — company list seeded as «requested» (nothing
-- created), unique addresses on the company domain, no passwords stored, four-eyes on
-- requests, execution updates the account, ownership record managed by it_admin only.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('a9300000-0000-0000-0000-000000000001', 'gm93@test'),
  ('a9300000-0000-0000-0000-000000000002', 'gm93b@test'),
  ('a9300000-0000-0000-0000-000000000003', 'sales93@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9300000-0000-0000-0000-000000000001', 'منصور المكرمي', 'admin', null),
  ('a9300000-0000-0000-0000-000000000002', 'عبدالله آل سالم', 'admin', null),
  ('a9300000-0000-0000-0000-000000000003', 'نايف اليامي', 'sales', null)
on conflict (id) do update set role = excluded.role;

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

-- ---------- the seed ----------
select pg_temp.check((select count(*) = 26 and bool_and(status = 'requested') from it_mail_accounts),
  '26 unique accounts, all «requested» — nothing created');
select pg_temp.check((select count(*) = 26 from it_account_requests where request_type = 'create' and status = 'pending'),
  'one pending create request per account');
select pg_temp.check((select note like '%maram.almustanir%' from it_mail_accounts where address = 'maram@masiatalsharq.com'),
  'Maram''s address awaits the naming decision');

-- ---------- access ----------
select pg_temp.login('a9300000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) = 0 from it_mail_accounts), 'other roles cannot read the registry');
select pg_temp.rejects($$select submit_account_request('create', null, 'x', '{"address":"x@masiatalsharq.com"}')$$,
  'صلاحية', 'other roles cannot submit');
select pg_temp.logout();

-- ---------- rules ----------
select pg_temp.login('a9300000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select submit_account_request('create', null, 'Karim', '{"address":"karim@masiatalsharq.com"}')$$,
  'مكررة', 'no duplicate address');
select pg_temp.rejects($$select submit_account_request('create', null, 'Test', '{"address":"test@gmail.com"}')$$,
  'دومين الشركة', 'only the company domain');
select pg_temp.rejects($$select submit_account_request('create', null, 'Test', '{"address":"lama@masiatalsharq.com","password":"x"}')$$,
  'كلمات المرور', 'passwords are never stored');
select submit_account_request('create', null, 'لمى', '{"address":"Lama@masiatalsharq.com","display_name":"Lama"}');
select pg_temp.rejects($$select decide_account_request((select id from it_account_requests where details->>'address' = 'Lama@masiatalsharq.com'), true)$$,
  'أربع أعين', 'the requester cannot approve');
select pg_temp.logout();

select pg_temp.login('a9300000-0000-0000-0000-000000000002');
select decide_account_request((select id from it_account_requests where details->>'address' = 'Lama@masiatalsharq.com'), true);
select pg_temp.rejects($$select execute_account_request((select id from it_account_requests where details->>'address' = 'Lama@masiatalsharq.com'),
                         'password: 123')$$, 'كلمات المرور', 'no password in the execution note');
select execute_account_request((select id from it_account_requests where details->>'address' = 'Lama@masiatalsharq.com'),
  'أُنشئ في لوحة المزوّد مع إلزام MFA');
select pg_temp.check((select status = 'active' and address = 'lama@masiatalsharq.com' from it_mail_accounts
                       where lower(address) = 'lama@masiatalsharq.com'), 'execution creates the active account (lower-cased)');
select pg_temp.check((select requested_by is not null and approved_by is not null and executed_by is not null
                         and requested_at is not null and decided_at is not null and executed_at is not null and status = 'done'
                        from it_account_requests where details->>'address' = 'Lama@masiatalsharq.com'),
  'the log keeps requester, approver, executor, dates and status');

-- disable a leaver
select submit_account_request('disable', (select id from it_mail_accounts where address = 'lama@masiatalsharq.com'),
  'لمى', '{}', 'انتهاء الخدمة');
select pg_temp.logout();
select pg_temp.login('a9300000-0000-0000-0000-000000000001');
select decide_account_request((select id from it_account_requests where request_type = 'disable' and status = 'pending'), true);
select execute_account_request((select id from it_account_requests where request_type = 'disable' and status = 'approved'));
select pg_temp.check((select status from it_mail_accounts where address = 'lama@masiatalsharq.com') = 'disabled',
  'disabled after approval and execution');

-- ownership
select update_mail_ownership('{"registrant_name":"شركة ماسية الشرق للاستقدام","mfa_enforced":true}');
select pg_temp.check((select registrant_name = 'شركة ماسية الشرق للاستقدام' and mfa_enforced from it_mail_ownership),
  'the ownership record is managed in-system');
select pg_temp.logout();

select 'OK 99t_it_mail_registry' as result;
