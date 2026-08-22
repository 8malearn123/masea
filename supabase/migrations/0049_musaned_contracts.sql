-- =============================================================
-- Masiat Alsharq ERP — 0049 Musaned-origin contracts (Module 01)
-- Business rule (ماسية الشرق):
--   • استقدام + نقل كفالة  → العقد نفسه يُنشأ ويُوقّع على منصة «مساند».
--     نظامنا لا يولّد عقداً داخلياً، بل يتتبّع «بروسِس» مساند: أُنشئ على مساند →
--     وقّع العميل على مساند → نشط. نحتفظ برقم عقد مساند والمبالغ للفوترة/الدفعات.
--   • تأجير شهري/يومي      → كامل دورة الحياة الداخلية كما هي (بلا تغيير).
-- يُبنى فوق `contracts` + `services` + RBAC القائمة — لا جداول جديدة لمفهوم قائم.
-- =============================================================

-- ---------- 1) contract origin as MANAGED config on services ----------
-- ليست قيمة جامدة في الكود: مصدر العقد لكل خدمة يُدار من جدول الخدمات (قابل
-- للتعديل من الإدارة). القيم الافتراضية مزروعة واقعياً لماسية الشرق.
alter table services
  add column if not exists contract_origin text not null default 'internal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_contract_origin_chk'
  ) then
    alter table services
      add constraint services_contract_origin_chk
      check (contract_origin in ('internal', 'musaned'));
  end if;
end $$;

update services set contract_origin = 'musaned'
  where code in ('recruitment', 'sponsorship_transfer');

-- ---------- 2) Musaned reference number on the contract ----------
alter table contracts
  add column if not exists musaned_contract_no text;

-- ---------- 3) new state-machine values for the Musaned track ----------
-- (تُضاف قبل استخدامها؛ لا تُستعمَل وقت الترحيل — فقط داخل دالة الانتقال زمن التشغيل)
alter type contract_status add value if not exists 'musaned_created' after 'draft';
alter type contract_status add value if not exists 'musaned_signed'  after 'musaned_created';

-- ---------- 4) origin-aware state machine ----------
-- الدالة الوحيدة المشروعة لتغيير الحالة — تختار المسار حسب مصدر الخدمة.
create or replace function transition_contract(p_contract_id uuid, p_to_status text)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_from    contract_status;
  v_branch  uuid;
  v_service text;
  v_origin  text;
  v_allowed text[];
  v_row     contracts;
begin
  select status, branch_id, service_code
    into v_from, v_branch, v_service
  from contracts where id = p_contract_id for update;

  if v_from is null then
    raise exception 'العقد غير موجود';
  end if;

  -- permission + branch scope (unchanged)
  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if p_to_status = 'approved' and not has_perm('contracts', 'approve') then
    raise exception 'لا تملك صلاحية اعتماد العقود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  select coalesce(contract_origin, 'internal') into v_origin
  from services where code = v_service;
  v_origin := coalesce(v_origin, 'internal');

  if v_origin = 'musaned' then
    -- مسار مساند: العقد يُنشأ ويُوقّع خارج النظام على منصة مساند.
    v_allowed := case v_from::text
      when 'draft'           then array['musaned_created', 'cancelled']
      when 'musaned_created' then array['musaned_signed', 'cancelled']
      when 'musaned_signed'  then array['active', 'cancelled']
      when 'active'          then array['completed', 'cancelled']
      else array[]::text[]
    end;
  else
    -- المسار الداخلي (تأجير) كما هو.
    v_allowed := case v_from::text
      when 'draft'              then array['pending_approval', 'cancelled']
      when 'pending_approval'   then array['approved', 'draft', 'cancelled']
      when 'approved'           then array['awaiting_signature', 'cancelled']
      when 'awaiting_signature' then array['signed', 'cancelled']
      when 'signed'             then array['active']
      when 'active'             then array['completed', 'cancelled']
      else array[]::text[]
    end;
  end if;

  if not (p_to_status = any(v_allowed)) then
    raise exception 'انتقال غير مشروع من % إلى %', v_from, p_to_status;
  end if;

  update contracts set
    status     = p_to_status::contract_status,
    signed_at  = case when p_to_status in ('signed', 'musaned_signed') then now() else signed_at end,
    updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (p_contract_id, v_from::text, p_to_status, auth.uid());

  return v_row;
end $$;

grant execute on function transition_contract(uuid, text) to authenticated;

-- ---------- 5) editable Musaned reference number (bypasses draft-only RLS) ----
-- رقم عقد مساند يُدخَل/يُعدَّل بعد الإنشاء ولو لم يكن العقد مسودة — عبر دالة
-- security definer محروسة بالصلاحية ونطاق الفرع (مثل transition_contract).
create or replace function set_musaned_contract_no(p_contract_id uuid, p_no text)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
  v_row    contracts;
begin
  select branch_id into v_branch from contracts where id = p_contract_id for update;
  if not found then
    raise exception 'العقد غير موجود';
  end if;
  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  update contracts
    set musaned_contract_no = nullif(btrim(p_no), ''),
        updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  return v_row;
end $$;

grant execute on function set_musaned_contract_no(uuid, text) to authenticated;
