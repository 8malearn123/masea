-- =============================================================
-- 0089 — أساسات التسوية والإرجاع والاستبدال (المرحلة 0 — docs/plans/contracts-settlement-email-plan.md)
--
-- سدّ الثغرات التي كشفها الفحص، فوق الجداول القائمة دون جداول موازية:
--   1) ربط العقد بسجل العاملة (worker_profiles) + منع حجز العاملة نفسها على
--      عقدين حيّين متداخلين (exclusion constraint على غرار التأجير بالساعة 0065).
--      set_contract_worker(): ربط/تغيير العاملة في المسودة بصلاحية contracts.edit.
--   2) توفر العاملة يتبع حالة العقد: محجوزة ← في الخدمة ← بانتظار الاستلام.
--      الإلغاء قبل التسليم يحرّرها فوراً؛ بعد التسليم تبقى «بانتظار الاستلام»
--      حتى يُؤكَّد إرجاعها فعلياً (المرحلة 2).
--   3) القيود الحيّة: توقيع العقد ← post_contract_signed، والدفعة ←
--      post_payment_received — بمفتاح idempotency فريد (لا قيود مكررة)، وحساب
--      الإيراد من service_code (العقود الحديثة بلا service_type)، وبلا أسطر صفرية.
--      مفتاح الإعداد acc_auto_post_contracts (1 = مفعّل) يديره الإداري.
--   4) amount_paid على العقد = مجموع دفعاته (trigger) — لا إدخال يدوي.
--      الدفعة المُرحَّلة لا تُعدَّل ولا تُحذف — التصحيح بالاسترداد (المرحلة 2).
--   5) نص العقد الموقّع محمي: لا تعديل ولا حذف لبنوده أو توقيعاته بعد إرساله
--      للتوقيع، ولا حذف لعقد تجاوز المسودة.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) contract ↔ worker profile + overlap guard ----------------------
alter table contracts
  add column if not exists worker_profile_id uuid references worker_profiles(id) on delete restrict;
create index if not exists idx_contracts_worker_profile on contracts(worker_profile_id);

comment on column contracts.worker_profile_id is
  'العاملة المخصّصة للعقد (worker_profiles). تتغيّر فقط عبر set_contract_worker أو الاستبدال.';

-- الحالات «الحيّة» التي تحجز العاملة (المسودة لا تحجز)
create or replace function contract_status_is_live(p contract_status) returns boolean
language sql immutable as $$
  select p::text in ('pending_approval','approved','awaiting_signature','signed',
                     'musaned_created','musaned_signed','active')
$$;

alter table contracts drop constraint if exists contracts_worker_no_overlap;
alter table contracts add constraint contracts_worker_no_overlap
  exclude using gist (
    worker_profile_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  ) where (worker_profile_id is not null and start_date is not null
           and contract_status_is_live(status));

-- العقد الحيّ الذي يشغل العاملة في فترة (للرسائل الواضحة قبل الاصطدام بالقيد)
create or replace function worker_contract_conflict(
  p_profile uuid, p_start date, p_end date, p_exclude uuid default null)
returns contracts language sql stable security definer set search_path = public as $$
  select c.* from contracts c
   where c.worker_profile_id = p_profile
     and c.id is distinct from p_exclude
     and contract_status_is_live(c.status)
     and c.start_date is not null
     and daterange(c.start_date, coalesce(c.end_date, 'infinity'::date), '[]')
         && daterange(p_start, coalesce(p_end, 'infinity'::date), '[]')
   order by c.start_date limit 1
$$;
grant execute on function worker_contract_conflict(uuid, date, date, uuid) to authenticated;

create or replace function set_contract_worker(p_contract_id uuid, p_profile uuid)
returns contracts language plpgsql security definer set search_path = public as $$
declare c contracts; v_hit contracts; v_name text; v_row contracts;
begin
  select * into c from contracts where id = p_contract_id for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية تعديل العقود'; end if;
  if not (is_cross_branch() or c.branch_id = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;
  if c.status <> 'draft' then
    raise exception 'تغيير العاملة بعد المسودة يتم عبر «استبدال العاملة» فقط';
  end if;
  if p_profile is not null then
    select full_name into v_name from worker_profiles where id = p_profile and is_active;
    if v_name is null then raise exception 'العاملة غير موجودة أو معطّلة'; end if;
    v_hit := worker_contract_conflict(p_profile, c.start_date, c.end_date, c.id);
    if v_hit.id is not null then
      raise exception 'العاملة % محجوزة على العقد % في الفترة نفسها', v_name, coalesce(v_hit.contract_no, v_hit.id::text);
    end if;
  end if;
  update contracts set worker_profile_id = p_profile, updated_at = now()
   where id = p_contract_id returning * into v_row;
  insert into audit_log (user_id, action, table_name, record_id, details)
  values (auth.uid(), 'contract.set_worker', 'contracts', p_contract_id,
          jsonb_build_object('from', c.worker_profile_id, 'to', p_profile));
  return v_row;
end $$;
grant execute on function set_contract_worker(uuid, uuid) to authenticated;

-- ---------- 2) worker availability follows the contract ------------------------
-- القيم المستخدمة في worker_profiles.status: available | reserved | on_service |
-- returning (بانتظار الاستلام) | medical
create or replace function worker_profile_has_other_live(p_profile uuid, p_contract uuid)
returns boolean language sql stable as $$
  select exists (select 1 from contracts
                  where worker_profile_id = p_profile and id <> p_contract
                    and contract_status_is_live(status))
$$;

create or replace function contracts_sync_worker_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_to text; v_profile uuid := new.worker_profile_id;
begin
  if v_profile is null then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status
     and new.worker_profile_id is not distinct from old.worker_profile_id then
    return new;
  end if;
  v_to := case
    when new.status::text in ('pending_approval','approved','awaiting_signature','signed',
                              'musaned_created','musaned_signed') then 'reserved'
    when new.status = 'active' then 'on_service'
    when new.status in ('cancelled','completed') then
      -- سُلِّمت العاملة؟ (العقد كان نشطاً) ← تنتظر الاستلام الفعلي؛ وإلا تُحرَّر
      case when tg_op = 'UPDATE' and old.status = 'active' then 'returning' else 'available' end
    else null end;
  if v_to is null then return new; end if;
  if v_to = 'available' then
    -- يُحرَّر الحجز فقط: عاملة في الخدمة أو بانتظار الاستلام لا تصبح متاحة بإلغاء عقد آخر
    if worker_profile_has_other_live(v_profile, new.id) then return new; end if;
    update worker_profiles set status = 'available' where id = v_profile and status = 'reserved';
    return new;
  end if;
  update worker_profiles set status = v_to where id = v_profile and status is distinct from v_to;
  return new;
end $$;
drop trigger if exists trg_contracts_sync_worker on contracts;
create trigger trg_contracts_sync_worker after insert or update of status, worker_profile_id on contracts
  for each row execute function contracts_sync_worker_status();

-- ---------- 3) live postings (idempotent) -------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('acc_auto_post_contracts', 'ترحيل قيود العقود والدفعات تلقائياً (1 = مفعّل، 0 = يدوي)',
   'المحاسبة', 1, 'مفتاح', 5)
on conflict (key) do nothing;

create or replace function acc_auto_post_enabled() returns boolean
language sql stable as $$
  select coalesce((select value from app_config where key = 'acc_auto_post_contracts'), 1) = 1
$$;

-- حساب الإيراد من رمز الخدمة (المصدر المعتمد منذ 0016)
create or replace function revenue_account_for_code(p_code text) returns uuid
language sql stable as $$
  select acc_id(case p_code
    when 'recruitment'          then '4100'
    when 'sponsorship_transfer' then '4400'
    when 'monthly_rental'       then '4200'
    else '4300'                 -- تأجير يومي / بالساعة / تجربة
  end)
$$;

create or replace function post_contract_signed(p_contract_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        contracts%rowtype;
  v_entry  uuid;
  v_date   date := current_date;
  v_rev    uuid;
begin
  select * into c from contracts where id = p_contract_id;
  if not found then raise exception 'العقد غير موجود'; end if;
  if coalesce(c.total_amount, 0) <= 0 then return null; end if;

  -- idempotent: one live entry per contract (key + legacy source lookup)
  select id into v_entry from journal_entries
   where status <> 'void'
     and (idempotency_key = 'CS-' || p_contract_id
          or (source_type = 'contract' and source_id = p_contract_id and kind = 'auto'));
  if v_entry is not null then return v_entry; end if;

  v_rev := case when c.service_code is not null then revenue_account_for_code(c.service_code)
                else revenue_account_for(c.service_type) end;

  insert into journal_entries (entry_date, period_id, branch_id, description, reference,
                               source_type, source_id, status, kind, idempotency_key, posted_at)
  values (v_date, ensure_period(v_date), c.branch_id,
          'إثبات عقد رقم ' || coalesce(c.contract_no, c.contract_number::text),
          coalesce(c.contract_no, 'CON-' || c.contract_number), 'contract', p_contract_id,
          'posted', 'auto', 'CS-' || p_contract_id, now())
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  select v_entry, a, d, cr, c.branch_id, ds from (values
    (acc_id('1120'), c.total_amount, 0::numeric, 'ذمة العميل'),
    (v_rev,          0::numeric, c.base_amount, 'إيراد الخدمة (قبل الضريبة)'),
    (acc_id('2120'), 0::numeric, c.vat_amount, 'ضريبة القيمة المضافة المستحقة')
  ) as l(a, d, cr, ds) where d > 0 or cr > 0;
  return v_entry;
end $$;

create or replace function post_payment_received(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p        payments%rowtype;
  v_branch uuid;
  v_entry  uuid;
  v_date   date;
begin
  select * into p from payments where id = p_payment_id;
  if not found then raise exception 'الدفعة غير موجودة'; end if;
  if coalesce(p.amount, 0) <= 0 then return null; end if;

  select id into v_entry from journal_entries
   where status <> 'void'
     and (idempotency_key = 'PR-' || p_payment_id
          or (source_type = 'payment' and source_id = p_payment_id));
  if v_entry is not null then return v_entry; end if;

  select branch_id into v_branch from contracts where id = p.contract_id;
  v_date := p.paid_at::date;
  insert into journal_entries (entry_date, period_id, branch_id, description, reference,
                               source_type, source_id, status, kind, idempotency_key, posted_at)
  values (v_date, ensure_period(v_date), v_branch, 'تحصيل دفعة', coalesce(p.reference_no, 'PMT'),
          'payment', p_payment_id, 'posted', 'auto', 'PR-' || p_payment_id, now())
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, cash_account_for(p.method), p.amount, 0, v_branch, 'تحصيل نقدي/بنكي'),
    (v_entry, acc_id('1120'), 0, p.amount, v_branch, 'سداد ذمة العميل');
  return v_entry;
end $$;

-- direct calls are for the accountant (manual catch-up of older contracts)
revoke execute on function post_contract_signed(uuid) from public, anon, authenticated;
revoke execute on function post_payment_received(uuid) from public, anon, authenticated;

create or replace function post_contract_manual(p_contract_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_status contract_status;
begin
  if not has_perm('accounting', 'post') then raise exception 'لا تملك صلاحية ترحيل القيود'; end if;
  select status into v_status from contracts where id = p_contract_id;
  if v_status is null then raise exception 'العقد غير موجود'; end if;
  if v_status::text not in ('signed','musaned_signed','active','completed') then
    raise exception 'لا يُرحَّل إلا عقد موقّع';
  end if;
  return post_contract_signed(p_contract_id);
end $$;
grant execute on function post_contract_manual(uuid) to authenticated;

create or replace function contracts_auto_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('signed', 'musaned_signed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and acc_auto_post_enabled() then
    perform post_contract_signed(new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_auto_post on contracts;
create trigger trg_contracts_auto_post after insert or update of status on contracts
  for each row execute function contracts_auto_post();

-- ---------- 4) amount_paid follows payments; posted payments are frozen -------
create or replace function contracts_recalc_paid(p_contract uuid) returns void
language sql security definer set search_path = public as $$
  update contracts c
     set amount_paid = coalesce((select sum(amount) from payments where contract_id = c.id), 0)
   where c.id = p_contract
$$;

create or replace function payments_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform contracts_recalc_paid(old.contract_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform contracts_recalc_paid(new.contract_id);
    if tg_op = 'INSERT' and new.amount > 0 and acc_auto_post_enabled() then
      perform post_payment_received(new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_payments_after_change on payments;
create trigger trg_payments_after_change after insert or update or delete on payments
  for each row execute function payments_after_change();

create or replace function payments_guard_posted() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from journal_entries
              where source_type = 'payment' and source_id = old.id and status = 'posted') then
    if tg_op = 'DELETE' then
      raise exception 'لا تُحذف دفعة مُرحَّلة — سجّل استرداداً بدلاً منها';
    end if;
    if new.amount is distinct from old.amount or new.method is distinct from old.method
       or new.contract_id is distinct from old.contract_id then
      raise exception 'الدفعة المُرحَّلة محمية من التعديل — سجّل استرداداً أو تسوية';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_payments_guard_posted on payments;
create trigger trg_payments_guard_posted before update or delete on payments
  for each row execute function payments_guard_posted();

-- إعادة احتساب المدفوع للعقود القائمة مرة واحدة
update contracts c set amount_paid = s.total
  from (select contract_id, sum(amount) total from payments group by contract_id) s
 where s.contract_id = c.id and c.amount_paid is distinct from s.total;

-- ---------- 5) the signed text is frozen --------------------------------------
create or replace function contract_text_locked(p_contract uuid) returns boolean
language sql stable as $$
  -- مفتوح للكتابة: المسودة وما قبل الإرسال للتوقيع، أو داخل المعاملة التي أنشأت العقد
  select exists (select 1 from contracts
                  where id = p_contract
                    and status::text not in ('draft', 'pending_approval', 'approved')
                    and created_at <> now())
$$;

create or replace function guard_contract_clauses() returns trigger
language plpgsql as $$
begin
  if contract_text_locked(coalesce(new.contract_id, old.contract_id)) then
    raise exception 'بنود العقد محمية بعد إرساله للتوقيع — التعديل بنسخة جديدة (تجديد/عقد جديد)';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_contract_clauses on contract_clauses;
create trigger trg_guard_contract_clauses before insert or update or delete on contract_clauses
  for each row execute function guard_contract_clauses();

create or replace function guard_contract_signatures() returns trigger
language plpgsql as $$
declare v_status text; v_created timestamptz;
begin
  select status::text, created_at into v_status, v_created
    from contracts where id = coalesce(new.contract_id, old.contract_id);
  if tg_op in ('UPDATE', 'DELETE') and v_created <> now() then
    raise exception 'سجل التوقيع غير قابل للتعديل أو الحذف';
  end if;
  if tg_op = 'INSERT' and v_status not in ('draft','pending_approval','approved','awaiting_signature')
     and v_created <> now() then
    raise exception 'لا يُضاف توقيع على عقد موقّع مسبقاً';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_guard_contract_signatures on contract_signatures;
create trigger trg_guard_contract_signatures before insert or update or delete on contract_signatures
  for each row execute function guard_contract_signatures();

create or replace function guard_contract_delete() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' then
    raise exception 'لا يُحذف عقد تجاوز المسودة — الإلغاء بإجراء «إلغاء العقد وتسويته»';
  end if;
  return old;
end $$;
drop trigger if exists trg_guard_contract_delete on contracts;
create trigger trg_guard_contract_delete before delete on contracts
  for each row execute function guard_contract_delete();
