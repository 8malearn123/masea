-- Tests for 0092: transfer trial — approved terms required, max days, secure link (hash only),
-- viewing ≠ accepting, identity check + attempts, immutable acceptance record, regulatory
-- checklist gate before handover, the two endings (transfer draft on Musaned / decline).
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into branches (id, name, city) values ('b0000000-0000-0000-0000-00000000000a', 'فرع نجران', 'نجران')
on conflict (id) do nothing;
insert into auth.users (id, email) values
  ('a9200000-0000-0000-0000-000000000001', 'bm92@test'),
  ('a9200000-0000-0000-0000-000000000002', 'ops92@test')
on conflict (id) do nothing;
insert into user_profiles (id, full_name, role, branch_id) values
  ('a9200000-0000-0000-0000-000000000001', 'مانع آل سدران', 'branch_manager', 'b0000000-0000-0000-0000-00000000000a'),
  ('a9200000-0000-0000-0000-000000000002', 'عبدالمنعم الصيعري', 'operations_manager', null)
on conflict (id) do update set role = excluded.role, branch_id = excluded.branch_id;
insert into customers (id, full_name, phone, national_id, branch_id, city) values
  ('c9200000-0000-0000-0000-000000000001', 'ظافر آل منصور', '0551237788', '1098765432', 'b0000000-0000-0000-0000-00000000000a', 'نجران')
on conflict (id) do nothing;
insert into worker_profiles (id, full_name, nationality, profession, branch_id) values
  ('f9200000-0000-0000-0000-000000000001', 'جوي ماي ريس', 'الفلبين', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a'),
  ('f9200000-0000-0000-0000-000000000002', 'ميرسي أتينو', 'كينيا', 'عاملة منزلية', 'b0000000-0000-0000-0000-00000000000a')
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
create temp table t_ctx (k text primary key, v text);
grant all on t_ctx to authenticated, anon;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------- terms must exist and be approved first ----------
-- 0106: the company's contract (contract_final_black.pdf) is the approved version from the start;
-- without an approved version no trial is created (checked with it retired, then rolled back)
select pg_temp.check((select count(*) from contract_templates where template_code = 'transfer_trial_terms'
                        and status = 'approved' and doc->>'layout' = 'trial_contract_black_v1') = 1,
                     'official trial contract approved');
begin;
update contract_templates set status = 'retired' where template_code = 'transfer_trial_terms' and status = 'approved';
select pg_temp.login('a9200000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select create_trial_agreement('c9200000-0000-0000-0000-000000000001',
                          'f9200000-0000-0000-0000-000000000001', 'نجران', 1500, 10, current_date)$$,
  'شروط تجربة معتمدة', 'no trial without approved terms');
rollback;
select pg_temp.logout();

select pg_temp.login('a9200000-0000-0000-0000-000000000002');
select save_trial_terms_draft('شروط تجربة العاملة بغرض نقل الخدمات',
  array['نص البند الأول كما تعتمده الشركة.', 'نص البند الثاني كما تعتمده الشركة.']);
select approve_contract_template((select id from contract_templates where template_code = 'transfer_trial_terms'
                                    and status = 'pending_review'));
select pg_temp.rejects($$update contract_templates set clauses = '["تعديل"]'::jsonb
                         where template_code = 'transfer_trial_terms' and status = 'approved'$$,
  'لا يُعدَّل', 'approved trial terms are locked');
select pg_temp.logout();

-- ---------- create ----------
select pg_temp.login('a9200000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select create_trial_agreement('c9200000-0000-0000-0000-000000000001',
                          'f9200000-0000-0000-0000-000000000001', 'نجران', 1500, 91, current_date)$$,
  'المادة التاسعة', 'more than 90 days is refused');
insert into t_ctx values ('trial', (select id::text from create_trial_agreement('c9200000-0000-0000-0000-000000000001',
  'f9200000-0000-0000-0000-000000000001', 'نجران', 1500, 10, current_date)));
select pg_temp.check((select t.status = 'draft' and t.end_date = current_date + 9 and t.total_amount = 1725
                         and c.service_code = 'transfer_trial' and c.worker_profile_id = t.worker_profile_id
                         and c.template_version = (select version from contract_templates
                              where template_code = 'transfer_trial_terms' and status = 'approved')
                        from trial_agreements t join contracts c on c.id = t.contract_id
                       where t.id = pg_temp.ctx('trial')::uuid),
  'trial + its contract (price 1,500 + VAT, 10 days, pinned terms v1)');

-- ---------- the secure link ----------
insert into t_ctx values ('token', (select issue_trial_link(pg_temp.ctx('trial')::uuid)->>'token'));
select pg_temp.logout();
select pg_temp.check((select count(*) = 1 and bool_and(token_hash <> pg_temp.ctx('token')) from trial_links
                       where trial_id = pg_temp.ctx('trial')::uuid), 'only the hash of the token is stored');
select pg_temp.check((select status from worker_profiles where id = 'f9200000-0000-0000-0000-000000000001') = 'reserved',
  'the worker is reserved once the link is sent');

-- the customer opens the link (anonymous): viewing changes nothing
set role anon;
select pg_temp.check((trial_public_view(pg_temp.ctx('token'))->>'trial_days')::int = 10
                     and (trial_public_view(pg_temp.ctx('token'))->>'price')::numeric = 1500
                     and trial_public_view(pg_temp.ctx('token'))->>'receipt_date' = current_date::text,
  'price, days and receipt date are shown');
reset role;
select pg_temp.check((select status from trial_agreements where id = pg_temp.ctx('trial')::uuid) = 'awaiting_acceptance',
  'opening the link is not acceptance');
set role anon;
select pg_temp.rejects($$select trial_public_view('not-a-token')$$, 'غير صحيح', 'a forged token is rejected');
select pg_temp.check((trial_accept(pg_temp.ctx('token'), '0000', '7788')->>'ok')::boolean = false, 'wrong ID refused');
reset role;
select pg_temp.check((select attempts from trial_links where trial_id = pg_temp.ctx('trial')::uuid) = 1,
  'the failed attempt is counted');
set role anon;
select pg_temp.check((trial_accept(pg_temp.ctx('token'), '5432', '7788', null, 'Mozilla/5.0 test')->>'ok')::boolean,
  'the customer accepts with matching ID/phone digits');
select pg_temp.rejects($$select trial_accept(pg_temp.ctx('token'), '5432', '7788')$$, 'سبق قبول', 'a link cannot be used twice');
reset role;

select pg_temp.check((select verified_by = 'id_last4+phone_last4' and national_id_last4 = '5432' and phone_masked = '******7788'
                         and length(document_sha256) = 64 and document->>'trial_no' is not null
                        from trial_acceptances where trial_id = pg_temp.ctx('trial')::uuid),
  'an auditable acceptance record with the accepted document and its hash');
select pg_temp.rejects($$delete from trial_acceptances$$, 'لا يُعدَّل', 'the acceptance record is immutable');
select pg_temp.check((select t.status = 'awaiting_handover' and c.status = 'signed' from trial_agreements t
                       join contracts c on c.id = t.contract_id where t.id = pg_temp.ctx('trial')::uuid),
  'accepted → awaiting handover; contract signed electronically');
select pg_temp.check((select count(*) = 2 from outbound_messages where entity_id = pg_temp.ctx('trial')::uuid),
  'link + confirmation messages queued for the customer');

-- ---------- regulatory gate ----------
select pg_temp.login('a9200000-0000-0000-0000-000000000001');
select pg_temp.rejects($$select trial_step(pg_temp.ctx('trial')::uuid, 'start')$$, 'المتطلبات النظامية',
  'no handover before the mandatory requirements');
select set_trial_requirement(pg_temp.ctx('trial')::uuid, code, true, 'تم التحقق عبر مساند')
  from contract_lookups where kind = 'trial_requirement' and flag;
select trial_step(pg_temp.ctx('trial')::uuid, 'start');
select pg_temp.logout();
select pg_temp.check((select t.status = 'in_trial' and c.status = 'active' from trial_agreements t
                       join contracts c on c.id = t.contract_id where t.id = pg_temp.ctx('trial')::uuid), 'trial running');
select pg_temp.check((select status from worker_profiles where id = 'f9200000-0000-0000-0000-000000000001') = 'on_service',
  'worker on service with the customer');

-- ---------- ending 1: the customer wants the transfer ----------
select pg_temp.login('a9200000-0000-0000-0000-000000000001');
select trial_step(pg_temp.ctx('trial')::uuid, 'transfer', current_date, 'العميل يرغب في نقل الخدمات');
select pg_temp.logout();
select pg_temp.check((select t.status = 'wants_transfer' and x.service_code = 'sponsorship_transfer' and x.status = 'draft'
                         and x.worker_profile_id = t.worker_profile_id and c.status = 'completed'
                        from trial_agreements t join contracts x on x.id = t.transfer_contract_id
                        join contracts c on c.id = t.contract_id where t.id = pg_temp.ctx('trial')::uuid),
  'a DRAFT sponsorship-transfer contract on the Musaned track — no transfer executed here');
select pg_temp.check((select status from worker_profiles where id = 'f9200000-0000-0000-0000-000000000001') = 'reserved',
  'the worker stays with the customer while Musaned is processed');

-- ---------- ending 2: the customer declines ----------
select pg_temp.login('a9200000-0000-0000-0000-000000000001');
insert into t_ctx values ('trial2', (select id::text from create_trial_agreement('c9200000-0000-0000-0000-000000000001',
  'f9200000-0000-0000-0000-000000000002', 'نجران', 1200, 7, current_date)));
insert into t_ctx values ('token2', (select issue_trial_link(pg_temp.ctx('trial2')::uuid)->>'token'));
select pg_temp.logout();
set role anon;
select trial_accept(pg_temp.ctx('token2'), '5432', '7788');
reset role;
select pg_temp.login('a9200000-0000-0000-0000-000000000001');
select set_trial_requirement(pg_temp.ctx('trial2')::uuid, code, true) from contract_lookups
 where kind = 'trial_requirement' and flag;
select trial_step(pg_temp.ctx('trial2')::uuid, 'start');
select trial_step(pg_temp.ctx('trial2')::uuid, 'decline', null, 'لم تناسب احتياج الأسرة');
-- the return + settlement use the existing 0090 path on the trial's contract
select request_worker_return((select contract_id from trial_agreements where id = pg_temp.ctx('trial2')::uuid),
  current_date, 'contract_end', 'نهاية التجربة دون نقل');
select pg_temp.logout();
select pg_temp.check((select t.status = 'declined' and exists (select 1 from worker_returns r where r.contract_id = t.contract_id)
                        from trial_agreements t where t.id = pg_temp.ctx('trial2')::uuid),
  'declined → the worker return is opened on the same contract');

select 'OK 99s_transfer_trials' as result;
