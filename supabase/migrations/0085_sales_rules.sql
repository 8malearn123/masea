-- =============================================================
-- 0085 — المبيعات والعقود: قواعد الخادم (نتيجة اختبار وحدة المبيعات)
--   1) العملاء المحتملون: العميل الجديد يُسند لمنشئه (كان assigned_to فارغًا فيختفي
--      عن موظف المبيعات بعد الحفظ لأن سياسة القراءة تشترط الإسناد له)، الجوال
--      05xxxxxxxx (يُطبَّع +966/966)، القيمة لا تكون سالبة، إعادة الإسناد لمدير الفرع،
--      ولا حذف نهائي (العميل غير المهتم = مرحلة «مفقود»).
--   2) عروض الأسعار تُكتب عبر دوال الخادم فقط (create_quote_from_price /
--      set_quote_status / convert_quote_to_contract). سياسة quotes_write «for all» كانت
--      تسمح بقبول العرض أو حذفه مباشرة متجاوزة دورة الحياة والاعتماد.
--   3) تحويل العرض لعقد يعيد فحص الكوبون (فعّال، لم تنتهِ مدته، لم يُستنفد حده — مع
--      قفل صف الخصم) وصلاحية العرض. كان الحد يُفحص عند إنشاء العرض فقط.
--   4) ضريبة العقد من pricing_config.vat_rate بدل 15٪ ثابتة في عمود مولَّد؛ العقد
--      المحوَّل من عرض يجمّد ضريبة العرض نفسها.
--   5) رقم مساند لا يُعدَّل لعقد منتهٍ أو ملغى.
--   6) حذف renew_contract(uuid) القديمة (0052) — كانت تجدّد العقد «المكتمل» خلافًا لـ 0056.
--   7) قواعد الأسعار لا تُحذف نهائيًا (التعطيل is_active).
-- التراجع: supabase/rollback/0085_sales_rules_down.sql
-- =============================================================

-- ---------- 1) leads -------------------------------------------------------------
create or replace function guard_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_digits text;
begin
  new.full_name := btrim(new.full_name);
  v_digits := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  if v_digits like '9665%' and length(v_digits) = 12 then v_digits := '0' || substr(v_digits, 4); end if;
  if v_digits like '5%' and length(v_digits) = 9 then v_digits := '0' || v_digits; end if;
  new.phone := nullif(v_digits, '');
  if tg_op = 'INSERT' then
    new.assigned_to := coalesce(new.assigned_to, auth.uid());
    new.created_by  := coalesce(new.created_by, auth.uid());
  else
    new.updated_at := now();
    if new.assigned_to is distinct from old.assigned_to and auth.uid() is not null
       and not (is_cross_branch() or get_my_role() = 'branch_manager') then
      raise exception 'إعادة إسناد العميل المحتمل من صلاحية مدير الفرع' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_lead on leads;
create trigger trg_guard_lead before insert or update on leads
  for each row execute function guard_lead();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_name_chk') then
    alter table leads add constraint leads_name_chk check (length(btrim(full_name)) > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_phone_chk') then
    alter table leads add constraint leads_phone_chk check (phone is null or phone ~ '^05[0-9]{8}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_est_value_chk') then
    alter table leads add constraint leads_est_value_chk check (est_value is null or est_value >= 0) not valid;
  end if;
end $$;

drop policy if exists leads_write on leads;
drop policy if exists leads_ins on leads;
drop policy if exists leads_upd on leads;
create policy leads_ins on leads for insert to authenticated with check (
  has_perm('leads','create') and (is_cross_branch() or branch_id = get_my_branch())
);
create policy leads_upd on leads for update to authenticated using (
  has_perm('leads','edit') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
) with check (
  has_perm('leads','edit') and (is_cross_branch() or branch_id = get_my_branch())
);
-- لا سياسة حذف: العميل غير المهتم يُنقل لمرحلة «مفقود»

-- ---------- 2) quotes: RPC-only writes ----------------------------------------------
drop policy if exists quotes_write on quotes;

-- ---------- 3) contract from a quote: coupon + validity re-check ---------------------
create or replace function guard_contract_from_quote() returns trigger
language plpgsql security definer set search_path = public as $$
declare p promotions; v_until date;
begin
  if new.quote_id is not null then
    select valid_until into v_until from quotes where id = new.quote_id;
    if v_until is not null and v_until < current_date then
      raise exception 'انتهت صلاحية عرض السعر (%): أنشئ نسخة جديدة من العرض بالأسعار الحالية', v_until;
    end if;
  end if;
  if new.promotion_id is not null and coalesce(new.discount_amount, 0) > 0 then
    select * into p from promotions where id = new.promotion_id for update;
    if not found or not p.is_active then
      raise exception 'الخصم المطبّق لم يعد فعّالًا: أعد تسعير العرض';
    end if;
    if p.ends_at is not null and p.ends_at < now() then
      raise exception 'انتهت مدة الخصم «%»: أعد تسعير العرض', p.name;
    end if;
    if p.usage_limit is not null and p.usage_count >= p.usage_limit then
      raise exception 'استُنفد الحد المسموح لاستخدام الخصم «%» (% من %)', p.name, p.usage_count, p.usage_limit;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_contract_from_quote on contracts;
create trigger trg_guard_contract_from_quote before insert on contracts
  for each row execute function guard_contract_from_quote();

-- ---------- 4) contract VAT from the managed rate ------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'contracts' and column_name = 'vat_amount' and is_generated = 'ALWAYS') then
    alter table contracts alter column vat_amount drop expression;
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'contracts' and column_name = 'total_amount' and is_generated = 'ALWAYS') then
    alter table contracts alter column total_amount drop expression;
  end if;
end $$;

create or replace function set_contract_vat() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rate numeric; v_qvat numeric; v_qbase numeric;
begin
  if tg_op = 'UPDATE' and new.base_amount is not distinct from old.base_amount then
    new.vat_amount := old.vat_amount;
    new.total_amount := old.total_amount;
    return new;
  end if;
  -- a contract converted from a quote keeps the quote's frozen VAT
  if tg_op = 'INSERT' and new.quote_id is not null then
    select vat_amount, base_amount into v_qvat, v_qbase from quotes where id = new.quote_id;
    if v_qvat is not null and v_qbase is not distinct from new.base_amount then
      new.vat_amount := v_qvat;
      new.total_amount := new.base_amount + v_qvat;
      return new;
    end if;
  end if;
  select vat_rate into v_rate from pricing_config where id = 1;
  if v_rate is null then raise exception 'نسبة الضريبة غير معرّفة في إعدادات التسعير'; end if;
  new.vat_amount := round(coalesce(new.base_amount, 0) * v_rate, 2);
  new.total_amount := coalesce(new.base_amount, 0) + new.vat_amount;
  return new;
end $$;
drop trigger if exists trg_set_contract_vat on contracts;
create trigger trg_set_contract_vat before insert or update of base_amount, vat_amount, total_amount on contracts
  for each row execute function set_contract_vat();

-- ---------- 5) Musaned number: not on a finished contract ----------------------------
create or replace function set_musaned_contract_no(p_contract_id uuid, p_no text)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
  v_status text;
  v_row    contracts;
begin
  select branch_id, status::text into v_branch, v_status from contracts where id = p_contract_id for update;
  if not found then
    raise exception 'العقد غير موجود';
  end if;
  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;
  if v_status in ('completed', 'cancelled') then
    raise exception 'العقد منتهٍ أو ملغى: لا يُعدَّل رقم مساند';
  end if;

  update contracts
    set musaned_contract_no = nullif(btrim(p_no), ''),
        updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  return v_row;
end $$;

-- ---------- 6) the superseded renewal --------------------------------------------------
drop function if exists renew_contract(uuid);

-- ---------- 7) price rules are deactivated, not deleted -------------------------------
drop policy if exists pricing_rules_delete on pricing_rules;
