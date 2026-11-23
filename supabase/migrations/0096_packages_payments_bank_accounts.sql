-- =============================================================
-- 0096 — الباقات، الحسابات البنكية للشركة، تفاصيل الدفعات، جدول الاستحقاقات
-- (docs/plans/contracts-operations-finance-plan.md — المرحلة 3)
--
--   1) الباقة = قاعدة تسعير مسمّاة بمدة ثابتة داخل pricing_rules (مصدر سعر
--      واحد). calc_price يستعملها فقط عند اختيارها صراحةً (package_id)، ولا
--      تدخل في المطابقة العامة — فلا تتغيّر أي أسعار معتمدة قائمة.
--   2) bank_accounts: صاحب الحساب، رقم الحساب، العملة، الفرع، تحقق صيغة الآيبان،
--      وقائمة اختيار مقنّعة (آخر 4 أرقام) لمن يسجّل الدفعات دون كشف الآيبان كاملاً.
--      لا تُضاف حسابات فعلية هنا — يُدخلها الإداري من شاشة البنوك.
--   3) payments: الحساب المستلم، رقم العملية، الحالة (مستلمة/بانتظار التحصيل/مرتجعة).
--      الترحيل على الحساب المختار؛ الارتداد = قيد عكسي (لا حذف)؛ المدفوع يُحسب من
--      الدفعات المستلمة فقط. الدفعات السابقة تبقى بقيودها كما هي.
--   4) contract_installments: جدول الاستحقاقات للعقد، يُغطّى من المدفوع بالأقدم أولاً.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) packages -------------------------------------------------------
alter table pricing_rules add column if not exists package_name text;
alter table pricing_rules add column if not exists duration_count integer;
alter table pricing_rules drop constraint if exists pricing_rules_package_check;
alter table pricing_rules add constraint pricing_rules_package_check check (
  (package_name is null and duration_count is null)
  or (length(btrim(package_name)) >= 2 and duration_count between 1 and 120));

create or replace function calc_price(p_service_code text, p_params jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cfg        pricing_config%rowtype;
  v_qty        numeric := greatest(coalesce((p_params->>'quantity')::numeric, 1), 1);
  v_nat        text    := nullif(p_params->>'nationality', '');
  v_prof       text    := nullif(p_params->>'profession', '');
  v_branch     uuid    := coalesce(nullif(p_params->>'branch_id', '')::uuid,
                                   resolve_branch_id(nullif(p_params->>'branch', '')));
  v_promo_id   uuid    := nullif(p_params->>'promotion_id', '')::uuid;
  v_package    uuid    := nullif(p_params->>'package_id', '')::uuid;
  v_pkg        pricing_rules%rowtype;
  v_code       text    := nullif(btrim(coalesce(p_params->>'promotion_code', '')), '');
  v_rule       numeric(12,2);
  v_rule_min   numeric(12,2);
  v_base       numeric(12,2);
  v_floor      numeric(12,2);
  v_discounts  numeric(12,2) := 0;
  v_promo      jsonb;
  v_promo_amt  numeric(12,2) := 0;
  v_penalties  numeric(12,2) := 0;
  v_net        numeric(12,2);
  v_vat        numeric(12,2);
  v_total      numeric(12,2);
  v_late_days  integer := coalesce((p_params->>'late_days')::integer, 0);
  v_absence    integer := coalesce((p_params->>'absence_days')::integer, 0);
  v_late_pct   numeric(5,2);
  v_abs_perday numeric(12,2);
  v_abs_max    integer;
  v_result     jsonb;
begin
  select * into v_cfg from pricing_config where id = 1;

  if v_package is not null then
    -- الباقة = قاعدة تسعير مسمّاة بمدة ثابتة: سعرها للوحدة × مدتها (لا تُعدَّل المدة)
    select * into v_pkg from pricing_rules
     where id = v_package and service_code = p_service_code and is_active and package_name is not null;
    if not found then raise exception 'الباقة غير متاحة لهذه الخدمة'; end if;
    v_rule := v_pkg.base_price; v_rule_min := v_pkg.min_price;
    v_qty  := greatest(coalesce(v_pkg.duration_count, 1), 1);
  else
  select base_price, min_price into v_rule, v_rule_min
  from pricing_rules
  where service_code = p_service_code and is_active and package_name is null
    and (nationality is null or nationality = v_nat)
    and (profession  is null or profession  = v_prof)
    and (branch_id   is null or branch_id   = v_branch)
  order by (case when branch_id   is not null then 4 else 0 end)
         + (case when nationality is not null then 1 else 0 end)
         + (case when profession  is not null then 1 else 0 end) desc
  limit 1;
  end if;
  v_base  := round(coalesce(v_rule, 0) * v_qty, 2);
  v_floor := round(coalesce(v_rule_min, 0) * v_qty, 2);

  if v_promo_id is null and v_code is not null then
    select id into v_promo_id from promotions where upper(code) = upper(v_code);
    if v_promo_id is null then
      v_promo := jsonb_build_object('ok', false, 'amount', 0, 'reason', 'رمز الكوبون غير صحيح');
    end if;
  end if;
  if v_promo_id is not null then
    v_promo := evaluate_promotion(v_promo_id, p_service_code, v_base, v_code);
  end if;
  if coalesce((v_promo->>'ok')::boolean, false) then
    v_promo_amt := (v_promo->>'amount')::numeric;
  end if;

  v_discounts := v_promo_amt + coalesce((p_params->>'wallet_redeem')::numeric, 0);
  if v_absence > 0 then
    v_abs_perday := coalesce((v_cfg.absence_compensation_rule->>'per_day')::numeric, 0);
    v_abs_max    := coalesce((v_cfg.absence_compensation_rule->>'max_days')::integer, 0);
    v_discounts  := v_discounts + round(v_abs_perday * least(v_absence, v_abs_max), 2);
  end if;
  v_discounts := least(round(v_discounts, 2), greatest(v_base - v_floor, 0));

  if v_late_days > v_cfg.late_grace_days then
    v_late_pct  := least(v_late_days * v_cfg.late_daily_pct, v_cfg.late_max_pct);
    v_penalties := v_penalties + round(v_base * v_late_pct / 100.0, 2);
  end if;
  if coalesce((p_params->>'cancelled')::boolean, false) then
    v_penalties := v_penalties + round(v_base * v_cfg.cancellation_pct / 100.0, 2);
  end if;

  v_net   := greatest(v_base - v_discounts + v_penalties, 0);
  v_vat   := round(v_net * v_cfg.vat_rate, 2);
  v_total := v_net + v_vat;

  v_result := jsonb_build_object(
    'base', v_base, 'discounts', v_discounts, 'penalties', v_penalties,
    'net', v_net, 'vat', v_vat, 'total', v_total,
    'promotion_id', v_promo_id,
    'promotion_ok', coalesce((v_promo->>'ok')::boolean, v_promo is null),
    'promotion_reason', v_promo->>'reason',
    'unit_price', coalesce(v_rule, 0),
    'quantity', v_qty,
    'package_id', v_pkg.id,
    'package_name', v_pkg.package_name
  );

  insert into pricing_log (service_code, params, result, created_by)
  values (p_service_code, p_params, v_result, auth.uid());

  return v_result;
end;
$$;
grant execute on function calc_price(text, jsonb) to anon, authenticated;

create or replace function create_contract_draft(p_input jsonb, p_clauses jsonb default '[]'::jsonb)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_service text := p_input->>'service_code';
  v_branch  uuid := resolve_branch_id(p_input->>'branch');
  v_params  jsonb;
  v_price   jsonb;
  v_promo   uuid := nullif(p_input->>'promotion_id', '')::uuid;
  v_code    text := nullif(btrim(coalesce(p_input->>'promotion_code', '')), '');
  v_row     contracts;
  v_clause  text;
  v_i       integer := 0;
begin
  if not has_perm('contracts', 'create') then
    raise exception 'لا تملك صلاحية إنشاء العقود';
  end if;
  if v_service is null or not exists (select 1 from services where code = v_service) then
    raise exception 'نوع الخدمة غير صحيح';
  end if;
  if nullif(p_input->>'customer_id', '') is null then
    raise exception 'اختر العميل';
  end if;
  if v_branch is null then
    raise exception 'الفرع غير معروف';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'لا يمكنك إنشاء عقد خارج نطاق فرعك';
  end if;
  if nullif(p_input->>'start_date', '') is null then
    raise exception 'حدّد تاريخ البداية';
  end if;
  if nullif(p_input->>'end_date', '') is not null
     and (p_input->>'end_date')::date < (p_input->>'start_date')::date then
    raise exception 'تاريخ النهاية قبل تاريخ البداية';
  end if;

  v_params := jsonb_strip_nulls(jsonb_build_object(
    'nationality',    p_input->>'nationality',
    'profession',     p_input->>'profession',
    'quantity',       coalesce((p_input->>'quantity')::numeric, 1),
    'promotion_id',   v_promo,
    'promotion_code', v_code,
    'package_id',     nullif(p_input->>'package_id', '')
  ));
  v_price := calc_price(v_service, v_params);
  if (v_promo is not null or v_code is not null)
     and not coalesce((v_price->>'promotion_ok')::boolean, false) then
    raise exception 'لا يمكن تطبيق الخصم: %', coalesce(v_price->>'promotion_reason', 'غير مؤهل');
  end if;
  v_promo := nullif(v_price->>'promotion_id', '')::uuid;
  if coalesce((v_price->>'base')::numeric, 0) <= 0 then
    raise exception 'لا توجد قاعدة تسعير فعّالة لهذه الخدمة';
  end if;

  insert into contracts (
    contract_no, service_code, template_id, customer_id, worker_id, branch_id,
    start_date, end_date, gross_amount, discount_amount, promotion_id, base_amount,
    musaned_contract_no, pricing_params, status, created_by
  ) values (
    generate_contract_no(), v_service, nullif(p_input->>'template_id', '')::uuid,
    (p_input->>'customer_id')::uuid, nullif(p_input->>'worker_id', '')::uuid, v_branch,
    (p_input->>'start_date')::date, nullif(p_input->>'end_date', '')::date,
    (v_price->>'base')::numeric, (v_price->>'discounts')::numeric, v_promo,
    (v_price->>'net')::numeric,
    nullif(btrim(coalesce(p_input->>'musaned_contract_no', '')), ''), v_params, 'draft', auth.uid()
  ) returning * into v_row;

  for v_clause in select jsonb_array_elements_text(coalesce(p_clauses, '[]'::jsonb)) loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_row.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());

  if v_promo is not null then
    update promotions set usage_count = usage_count + 1, updated_at = now() where id = v_promo;
  end if;

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.create', 'contracts', v_row.id, to_jsonb(v_row));

  return v_row;
end $$;

grant execute on function create_contract_draft(jsonb, jsonb) to authenticated;

-- الباقات المتاحة لخدمة (للمعالج والتسعير) — قراءة فقط
create or replace function pricing_packages(p_service text, p_nationality text default null,
                                            p_branch text default null)
returns table (id uuid, package_name text, duration_count integer, duration_unit text,
               unit_price numeric, list_total numeric, nationality text, profession text)
language sql stable security definer set search_path = public as $$
  select r.id, r.package_name, r.duration_count, r.duration_unit, r.base_price,
         round(r.base_price * r.duration_count, 2), r.nationality, r.profession
    from pricing_rules r
   where r.service_code = p_service and r.is_active and r.package_name is not null
     and (r.nationality is null or p_nationality is null or r.nationality = p_nationality)
     and (r.branch_id is null or p_branch is null or r.branch_id = resolve_branch_id(p_branch))
   order by r.duration_count, r.package_name
$$;
grant execute on function pricing_packages(text, text, text) to authenticated;

-- ---------- 2) company bank accounts --------------------------------------------
alter table bank_accounts add column if not exists holder_name text;
alter table bank_accounts add column if not exists account_no text;
alter table bank_accounts add column if not exists currency text not null default 'SAR';
alter table bank_accounts add column if not exists branch_id uuid references branches(id) on delete set null;
alter table bank_accounts add column if not exists updated_at timestamptz not null default now();
alter table bank_accounts drop constraint if exists bank_accounts_iban_check;
alter table bank_accounts add constraint bank_accounts_iban_check
  check (iban is null or iban ~ '^SA[0-9]{22}$');
alter table bank_accounts drop constraint if exists bank_accounts_currency_check;
alter table bank_accounts add constraint bank_accounts_currency_check check (currency ~ '^[A-Z]{3}$');
drop trigger if exists trg_audit_row on bank_accounts;
create trigger trg_audit_row after insert or update or delete on bank_accounts
  for each row execute function audit_row_change();

-- قائمة الحسابات المستلمة لمسجّل الدفعة: الآيبان مقنّع، والكامل لمن يملك المحاسبة
create or replace function bank_account_options()
returns table (id uuid, name text, bank text, holder_name text, iban_masked text,
               currency text, branch_id uuid, account_code text, is_cash boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('payments', 'create') or has_perm('accounting', 'view')) then
    raise exception 'لا تملك صلاحية عرض حسابات الاستلام';
  end if;
  return query
    select b.id, b.name, b.bank, b.holder_name,
           case when b.iban is null then null
                when has_perm('accounting', 'view') then b.iban
                else 'SA••' || right(b.iban, 4) end,
           b.currency, b.branch_id, b.account_code, b.iban is null
      from bank_accounts b
     where b.is_active
     order by b.iban is null desc, b.name;
end $$;
grant execute on function bank_account_options() to authenticated;

-- إضافة/تعديل حساب بنكي (حساب دليل حسابات قائم تحت النقدية والبنوك)
create or replace function upsert_bank_account(
  p_id uuid, p_name text, p_bank text, p_holder text, p_iban text, p_account_no text,
  p_currency text, p_branch text, p_account_code text default null, p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_parent uuid; v_code text; v_code_n bigint;
        v_iban text := nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), '');
begin
  if not has_perm('accounting', case when p_id is null then 'create' else 'edit' end) then
    raise exception 'لا تملك صلاحية إدارة الحسابات البنكية';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'اسم الحساب مطلوب'; end if;
  if v_iban is not null and v_iban !~ '^SA[0-9]{22}$' then
    raise exception 'الآيبان غير صحيح — SA ثم 22 رقماً';
  end if;
  if nullif(p_account_code, '') is null then
    -- حساب جديد في دليل الحسابات تحت «النقدية والبنوك» (1110)
    select id into v_parent from chart_of_accounts where code = '1110';
    if v_parent is null then raise exception 'حساب النقدية والبنوك (1110) غير موجود في الدليل'; end if;
    select coalesce(max(code::bigint), 1110) + 1 into v_code_n
      from chart_of_accounts where parent_id = v_parent and code ~ '^[0-9]+$';
    v_code := v_code_n::text;
    insert into chart_of_accounts (code, name_ar, type, parent_id, is_postable, normal_balance)
    values (v_code, btrim(p_name), 'asset', v_parent, true, 'debit');
  else
    v_code := p_account_code;
  end if;
  if not exists (select 1 from chart_of_accounts where code = v_code and type = 'asset' and is_postable) then
    raise exception 'الحساب المحاسبي غير موجود أو غير قابل للترحيل';
  end if;
  if exists (select 1 from bank_accounts where account_code = v_code and id is distinct from p_id) then
    raise exception 'الحساب المحاسبي مربوط بحساب بنكي آخر';
  end if;
  if p_id is null then
    insert into bank_accounts (name, bank, holder_name, iban, account_no, currency, branch_id, account_code, is_active)
    values (btrim(p_name), nullif(btrim(p_bank), ''), nullif(btrim(p_holder), ''), v_iban,
            nullif(btrim(p_account_no), ''), coalesce(nullif(upper(btrim(p_currency)), ''), 'SAR'),
            resolve_branch_id(nullif(p_branch, '')), v_code, coalesce(p_is_active, true))
    returning id into v_id;
  else
    update bank_accounts set name = btrim(p_name), bank = nullif(btrim(p_bank), ''),
           holder_name = nullif(btrim(p_holder), ''), iban = v_iban,
           account_no = nullif(btrim(p_account_no), ''),
           currency = coalesce(nullif(upper(btrim(p_currency)), ''), 'SAR'),
           branch_id = resolve_branch_id(nullif(p_branch, '')), account_code = v_code,
           is_active = coalesce(p_is_active, is_active), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'الحساب غير موجود'; end if;
  end if;
  return v_id;
end $$;
grant execute on function upsert_bank_account(uuid, text, text, text, text, text, text, text, text, boolean) to authenticated;

-- ---------- 3) payment details --------------------------------------------------
alter table payments add column if not exists bank_account_id uuid references bank_accounts(id) on delete restrict;
alter table payments add column if not exists transaction_no text;
alter table payments add column if not exists status text not null default 'received';
alter table payments add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();
alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('received', 'pending_clearance', 'bounced'));

-- الحساب المدين: الحساب البنكي المختار إن وُجد، وإلا حساب الطريقة الافتراضي (0023)
create or replace function payment_cash_account(p payments) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select acc_id(b.account_code) from bank_accounts b where b.id = p.bank_account_id),
                  cash_account_for(p.method))
$$;

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
  if coalesce(p.amount, 0) <= 0 or p.status <> 'received' then return null; end if;

  select id into v_entry from journal_entries
   where status <> 'void'
     and (idempotency_key = 'PR-' || p_payment_id
          or (source_type = 'payment' and source_id = p_payment_id));
  if v_entry is not null then return v_entry; end if;

  select branch_id into v_branch from contracts where id = p.contract_id;
  v_date := p.paid_at::date;
  insert into journal_entries (entry_date, period_id, branch_id, description, reference,
                               source_type, source_id, status, kind, idempotency_key, posted_at)
  values (v_date, ensure_period(v_date), v_branch, 'تحصيل دفعة',
          coalesce(p.transaction_no, p.reference_no, 'PMT'),
          'payment', p_payment_id, 'posted', 'auto', 'PR-' || p_payment_id, now())
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, payment_cash_account(p), p.amount, 0, v_branch, 'تحصيل نقدي/بنكي'),
    (v_entry, acc_id('1120'), 0, p.amount, v_branch, 'سداد ذمة العميل');
  return v_entry;
end $$;
revoke execute on function post_payment_received(uuid) from public, anon, authenticated;

-- ارتداد دفعة مُرحَّلة: قيد عكسي بنفس الحسابات (لا حذف للقيد الأصلي)
create or replace function post_payment_bounced(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p payments%rowtype; v_orig uuid; v_entry uuid; v_branch uuid;
begin
  select * into p from payments where id = p_payment_id;
  select id into v_orig from journal_entries
   where status = 'posted' and idempotency_key = 'PR-' || p_payment_id;
  if v_orig is null then return null; end if;
  select id into v_entry from journal_entries where idempotency_key = 'PRB-' || p_payment_id;
  if v_entry is not null then return v_entry; end if;
  select branch_id into v_branch from contracts where id = p.contract_id;
  insert into journal_entries (entry_date, period_id, branch_id, description, reference,
                               source_type, source_id, status, kind, idempotency_key, posted_at)
  values (current_date, ensure_period(current_date), v_branch, 'عكس دفعة مرتجعة',
          coalesce(p.transaction_no, p.reference_no, 'PMT'),
          'adjustment', p_payment_id, 'posted', 'adjusting', 'PRB-' || p_payment_id, now())
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  select v_entry, l.account_id, l.credit, l.debit, l.branch_id, 'عكس: ' || coalesce(l.description, '')
    from journal_entry_lines l where l.entry_id = v_orig;
  return v_entry;
end $$;
revoke execute on function post_payment_bounced(uuid) from public, anon, authenticated;

-- المدفوع = الدفعات المستلمة فقط، ثم توزيعه على الاستحقاقات
create or replace function contracts_recalc_paid(p_contract uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update contracts c
     set amount_paid = coalesce((select sum(amount) from payments
                                  where contract_id = c.id and status = 'received'), 0)
   where c.id = p_contract;
  perform contract_installments_allocate(p_contract);
end $$;

create or replace function payments_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform contracts_recalc_paid(old.contract_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'UPDATE' and new.contract_id is distinct from old.contract_id or tg_op = 'INSERT' then
      perform contracts_recalc_paid(new.contract_id);
    end if;
    if new.amount > 0 and new.status = 'received' and acc_auto_post_enabled()
       and (tg_op = 'INSERT' or old.status is distinct from 'received') then
      perform post_payment_received(new.id);
    end if;
    if tg_op = 'UPDATE' and old.status = 'received' and new.status = 'bounced' then
      perform post_payment_bounced(new.id);
    end if;
  end if;
  return null;
end $$;

create or replace function payments_guard_posted() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from journal_entries
              where source_type = 'payment' and source_id = old.id and status = 'posted') then
    if tg_op = 'DELETE' then
      raise exception 'لا تُحذف دفعة مُرحَّلة — سجّل استرداداً أو ارتداداً بدلاً منها';
    end if;
    if new.amount is distinct from old.amount or new.method is distinct from old.method
       or new.contract_id is distinct from old.contract_id
       or new.bank_account_id is distinct from old.bank_account_id then
      raise exception 'الدفعة المُرحَّلة محمية من التعديل — سجّل استرداداً أو تسوية';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'bounced' and new.status is distinct from 'bounced' then
    raise exception 'الدفعة المرتجعة نهائية — سجّل دفعة جديدة';
  end if;
  return coalesce(new, old);
end $$;

-- تسجيل دفعة عقد بكل تفاصيلها (الواجهة تستعمل هذه الدالة)
create or replace function record_contract_payment(
  p_contract uuid, p_amount numeric, p_method payment_method, p_paid_on date,
  p_bank_account uuid default null, p_transaction_no text default null,
  p_reference text default null, p_status text default 'received')
returns uuid language plpgsql security definer set search_path = public as $$
declare c contracts%rowtype; v_id uuid; v_remaining numeric; v_needs_bank boolean;
begin
  if not has_perm('payments', 'create') then raise exception 'لا تملك صلاحية تسجيل الدفعات'; end if;
  select * into c from contracts where id = p_contract;
  if not found or not contract_in_my_scope(p_contract) then raise exception 'العقد غير موجود'; end if;
  if c.status::text in ('cancelled') then raise exception 'لا تُسجَّل دفعة على عقد ملغى'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_paid_on is null or p_paid_on > current_date then raise exception 'تاريخ الدفعة لا يكون في المستقبل'; end if;
  if p_status not in ('received', 'pending_clearance') then raise exception 'حالة الدفعة غير صحيحة'; end if;
  v_remaining := c.total_amount - c.amount_paid
    - coalesce((select sum(amount) from payments where contract_id = p_contract and status = 'pending_clearance'), 0);
  if p_amount > v_remaining + 0.005 then
    raise exception 'المبلغ يتجاوز المتبقي على العقد (%)', round(v_remaining, 2);
  end if;
  v_needs_bank := p_method = 'transfer';
  if v_needs_bank and p_bank_account is null then raise exception 'اختر الحساب البنكي المستلم للتحويل'; end if;
  if p_bank_account is not null and not exists (select 1 from bank_accounts where id = p_bank_account and is_active) then
    raise exception 'الحساب المستلم غير متاح';
  end if;
  if v_needs_bank and length(btrim(coalesce(p_transaction_no, ''))) < 3 then
    raise exception 'رقم عملية التحويل مطلوب';
  end if;
  insert into payments (contract_id, amount, method, paid_at, bank_account_id, transaction_no,
                        reference_no, status, installment_no)
  values (p_contract, round(p_amount, 2), p_method, p_paid_on::timestamptz + interval '9 hours',
          p_bank_account, nullif(btrim(p_transaction_no), ''), nullif(btrim(p_reference), ''), p_status,
          1 + (select count(*) from payments where contract_id = p_contract))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function record_contract_payment(uuid, numeric, payment_method, date, uuid, text, text, text) to authenticated;

-- تأكيد التحصيل أو ارتداد الدفعة
create or replace function set_payment_status(p_payment uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p payments%rowtype;
begin
  if not has_perm('payments', 'edit') then raise exception 'لا تملك صلاحية تعديل الدفعات'; end if;
  select * into p from payments where id = p_payment for update;
  if not found or not contract_in_my_scope(p.contract_id) then raise exception 'الدفعة غير موجودة'; end if;
  if not ((p.status = 'pending_clearance' and p_status in ('received', 'bounced'))
          or (p.status = 'received' and p_status = 'bounced')) then
    raise exception 'لا يمكن نقل الدفعة من % إلى %', p.status, p_status;
  end if;
  if p_status = 'bounced' and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'سبب الارتداد مطلوب';
  end if;
  update payments set status = p_status where id = p_payment;
  perform contracts_recalc_paid(p.contract_id);
end $$;
grant execute on function set_payment_status(uuid, text, text) to authenticated;

-- ---------- 4) installment schedule -----------------------------------------------
create table if not exists contract_installments (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references contracts(id) on delete cascade,
  seq          integer not null,
  due_date     date not null,
  amount       numeric(12,2) not null check (amount > 0),
  paid_amount  numeric(12,2) not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  unique (contract_id, seq)
);
create index if not exists idx_installments_contract on contract_installments(contract_id, due_date);
alter table contract_installments enable row level security;
drop policy if exists ci_read on contract_installments;
create policy ci_read on contract_installments for select to authenticated
  using (has_perm('contracts', 'view') and contract_in_my_scope(contract_id));
drop trigger if exists trg_audit_row on contract_installments;
create trigger trg_audit_row after insert or update or delete on contract_installments
  for each row execute function audit_row_change();

create or replace function contract_installments_allocate(p_contract uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_left numeric; r record;
begin
  select amount_paid into v_left from contracts where id = p_contract;
  v_left := coalesce(v_left, 0);
  for r in select id, amount from contract_installments where contract_id = p_contract order by due_date, seq loop
    update contract_installments set paid_amount = least(r.amount, greatest(v_left, 0))
     where id = r.id and paid_amount is distinct from least(r.amount, greatest(v_left, 0));
    v_left := v_left - r.amount;
  end loop;
end $$;

-- ضبط جدول الاستحقاقات: المجموع = إجمالي العقد؛ لا يُعاد ضبطه بعد السداد الكامل
create or replace function set_contract_installments(p_contract uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c contracts%rowtype; v_sum numeric; v_n integer;
begin
  if not (has_perm('contracts', 'edit') or has_perm('contracts', 'create')) then
    raise exception 'لا تملك صلاحية تعديل جدول الاستحقاقات';
  end if;
  select * into c from contracts where id = p_contract;
  if not found or not contract_in_my_scope(p_contract) then raise exception 'العقد غير موجود'; end if;
  if c.status::text in ('cancelled', 'completed') then raise exception 'العقد مغلق'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'أضف استحقاقاً واحداً على الأقل';
  end if;
  select sum((x->>'amount')::numeric), count(*) into v_sum, v_n from jsonb_array_elements(p_items) x;
  if exists (select 1 from jsonb_array_elements(p_items) x
              where coalesce((x->>'amount')::numeric, 0) <= 0 or nullif(x->>'due_date', '') is null) then
    raise exception 'كل استحقاق يحتاج مبلغاً موجباً وتاريخاً';
  end if;
  if abs(v_sum - c.total_amount) > 0.01 then
    raise exception 'مجموع الاستحقاقات (%) لا يساوي إجمالي العقد (%)', v_sum, c.total_amount;
  end if;
  delete from contract_installments where contract_id = p_contract;
  insert into contract_installments (contract_id, seq, due_date, amount)
  select p_contract, ord, (x->>'due_date')::date, round((x->>'amount')::numeric, 2)
    from jsonb_array_elements(p_items) with ordinality as t(x, ord);
  perform contract_installments_allocate(p_contract);
end $$;
grant execute on function set_contract_installments(uuid, jsonb) to authenticated;

create or replace view contract_installments_v with (security_invoker = true) as
  select i.*, i.amount - i.paid_amount as remaining,
         case when i.paid_amount >= i.amount then 'paid'
              when i.due_date < current_date then 'overdue'
              when i.paid_amount > 0 then 'partial'
              else 'due' end as status
    from contract_installments i;
grant select on contract_installments_v to authenticated;
