-- Tests for 0094: one rental template for every rental service, legacy rental templates
-- retired for new contracts, the corporate e-mail module disabled without losing data.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_msg; end if;
end $$;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into customers (id, full_name, phone, branch_id, city) values
  ('c9400000-0000-0000-0000-000000000001', 'سالم آل شريم', '0551234940', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;

-- by now 99n/99q approved the rental template v1 (daily + monthly rows)
insert into contracts (id, customer_id, branch_id, service_code, base_amount, status, contract_no, start_date, end_date)
values
  ('d9400000-0000-0000-0000-00000000000a', 'c9400000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'monthly_rental', 2200, 'draft', 'MR-94-A', current_date, current_date + 29),
  ('d9400000-0000-0000-0000-00000000000b', 'c9400000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'hourly_rental', 180, 'draft', 'HR-94-B', current_date, current_date),
  ('d9400000-0000-0000-0000-00000000000c', 'c9400000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'recruitment', 15000, 'draft', 'RC-94-C', current_date, null)
on conflict (id) do nothing;

select pg_temp.check((select bool_and(t.template_code = 'rental_labor_services' and c.template_version = 1
                         and c.template_sha256 = '2c17375e788419775a8cca949f6d139fcb110c216bad981b899c9739446c1243')
                        from contracts c join contract_templates t on t.id = c.template_id
                       where c.id in ('d9400000-0000-0000-0000-00000000000a', 'd9400000-0000-0000-0000-00000000000b')),
  'monthly and hourly drafts get the same approved rental template, version and fingerprint');
select pg_temp.check((select template_id is null from contracts where id = 'd9400000-0000-0000-0000-00000000000c'),
  'non-rental services are untouched');
select pg_temp.check(not exists (select 1 from contract_templates where template_code is null and is_active
                                   and service_code in ('monthly_rental','daily_rental','hourly_rental')),
  'legacy short rental templates are retired for new contracts');
select pg_temp.check((select count(*) from contract_templates where template_code is null
                       and service_code in ('monthly_rental','daily_rental','hourly_rental')) >= 4,
  'legacy templates are kept (not deleted) for the contracts that used them');

-- corporate e-mail: access gone, data kept
select pg_temp.check(not exists (select 1 from role_permissions where module = 'it_admin')
                     and not exists (select 1 from permissions where module = 'it_admin'), 'it_admin has no grants');
select pg_temp.check(not has_function_privilege('authenticated', 'submit_account_request(text, uuid, text, jsonb, text)', 'execute'),
  'its functions can no longer be called');
select pg_temp.check((select count(*) from it_mail_accounts) >= 26, 'its data is kept, not deleted');
select pg_temp.check(to_regclass('public.outbound_messages') is not null
                     and has_function_privilege('anon', 'trial_accept(text, text, text, text, text)', 'execute'),
  'customer notifications and trial acceptance are unaffected');

select 'OK 99u_contracts_unification' as result;
