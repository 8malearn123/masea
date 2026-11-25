-- =============================================================
-- 0107 — التوقيع الإلكتروني لكل أنواع العقود (تعميم توقيع العقد القائم)
--
-- يُعاد استخدام القائم نفسه: جدول contract_signatures (0016/0047) ونافذة التوقيع ونفس
-- الحقول (الاسم، رقم الهوية، IP، توقيع الطرفين). الجديد:
--   * sign_contract_party: توقيع كل طرف على الخادم — الصلاحية (العميل: contracts.edit،
--     ممثل الشركة: contracts.approve)، تطابق هوية العميل مع ملفه (أو وكيل بموجب وكالة موثقة)،
--     صورة التوقيع مخزّنة مع السجل، بصمة محتوى العقد وقت التوقيع (contract_content_sha256)،
--     IP والمتصفح والموظف الذي أدار التوقيع، وسجل تدقيق. توقيع الطرفين على نفس البصمة ← «موقّع».
--   * لا إدخال مباشر في contract_signatures (الدالة فقط)؛ السجل لا يُعدَّل ولا يُحذف (0089).
--   * محتوى العقد الموقّع (الأطراف والمبالغ والقالب وبياناته) لا يتغيّر — التعديل بنسخة جديدة.
--   * عقود مساند: يُسجَّل توقيع الطرفين على نسخة المكتب دون تغيير مسار مساند (التوقيع الرسمي هناك).
--   * عقود التجربة: التوقيع الحضوري يكافئ القبول (نفس انتقال القبول عن بُعد في 0092).
-- العقود والتوقيعات السابقة لا تتغيّر. آمن لإعادة التشغيل.
-- =============================================================

alter table contract_signatures
  add column if not exists signer_capacity  text,          -- الصفة: العميل (الطرف الثاني) / ممثل الشركة (الطرف الأول) / وكيل
  add column if not exists method           text,          -- in_person | agent | remote_link (null = سجل سابق)
  add column if not exists poa_no           text,          -- رقم الوكالة عند التوقيع بالوكالة
  add column if not exists signed_by        uuid references auth.users(id) on delete set null,  -- الموظف الذي أدار التوقيع
  add column if not exists user_agent       text,
  add column if not exists document_sha256  text,          -- بصمة محتوى العقد الموقّع
  add column if not exists contract_version integer,
  add column if not exists image_sha256     text;

-- ---------- 1) the content fingerprint ----------
create or replace function contract_content_sha256(p_contract uuid) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'contract_no', k.contract_no, 'version', k.version, 'service', k.service_code,
    'customer', k.customer_id, 'worker', k.worker_profile_id, 'start', k.start_date, 'end', k.end_date,
    'gross', k.gross_amount, 'discount', k.discount_amount, 'base', k.base_amount, 'vat', k.vat_amount,
    'total', k.total_amount, 'template', k.template_id, 'template_version', k.template_version,
    'doc_fields', k.doc_fields,
    'clauses', (select coalesce(jsonb_agg(c.body order by c.sort_order, c.created_at, c.id), '[]'::jsonb)
                  from contract_clauses c where c.contract_id = k.id),
    'trial', (select jsonb_build_object('fields', t.document_fields, 'terms', t.terms_snapshot, 'price', t.price,
                                        'days', t.trial_days, 'receipt', t.receipt_date)
                from trial_agreements t where t.contract_id = k.id)
  )::text, 'UTF8')), 'hex')
  from contracts k where k.id = p_contract
$$;
revoke execute on function contract_content_sha256(uuid) from public, anon;
grant execute on function contract_content_sha256(uuid) to authenticated;

-- ---------- 2) signatures only through the signing functions ----------
drop policy if exists cs_insert on contract_signatures;

create or replace function guard_contract_signatures() returns trigger
language plpgsql as $$
declare v_status text; v_created timestamptz;
begin
  select status::text, created_at into v_status, v_created
    from contracts where id = coalesce(new.contract_id, old.contract_id);
  if tg_op in ('UPDATE', 'DELETE') and v_created <> now() then
    raise exception 'سجل التوقيع غير قابل للتعديل أو الحذف';
  end if;
  if tg_op = 'INSERT' and v_status not in ('draft','pending_approval','approved','awaiting_signature','musaned_created')
     and v_created <> now() then
    raise exception 'لا يُضاف توقيع على عقد موقّع مسبقاً';
  end if;
  return coalesce(new, old);
end $$;

-- ---------- 3) signed content is frozen ----------
create or replace function guard_signed_contract_content() returns trigger
language plpgsql as $$
begin
  if old.status::text in ('signed', 'active', 'completed')
     and coalesce(current_setting('masea.settling', true), 'off') <> 'on'
     and (new.contract_no is distinct from old.contract_no or new.service_code is distinct from old.service_code
       or new.customer_id is distinct from old.customer_id or new.base_amount is distinct from old.base_amount
       or new.gross_amount is distinct from old.gross_amount or new.discount_amount is distinct from old.discount_amount
       or new.start_date is distinct from old.start_date or new.template_id is distinct from old.template_id
       or new.template_version is distinct from old.template_version or new.doc_fields is distinct from old.doc_fields
       or new.version is distinct from old.version) then
    raise exception 'العقد الموقّع لا يُعدَّل — أي تعديل يتطلب نسخة جديدة تُعتمد وتُوقَّع';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_signed_contract_content on contracts;
create trigger trg_guard_signed_contract_content before update on contracts
  for each row execute function guard_signed_contract_content();

-- ---------- 4) sign one party ----------
-- انتقال حالة من مسار التوقيع: نفس سجل الحالات وسجل التدقيق كالانتقالات اليدوية
create or replace function contract_sign_transition(p_contract uuid, p_to text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_from text;
begin
  select status::text into v_from from contracts where id = p_contract;
  if v_from = p_to then return; end if;
  perform trial_contract_to(p_contract, p_to, p_note);
  insert into audit_log (user_id, action, table_name, record_id, details)
  values (auth.uid(), 'contract.transition', 'contracts', p_contract,
          jsonb_build_object('from', v_from, 'to', p_to, 'via', 'e-signature'));
end $$;
revoke execute on function contract_sign_transition(uuid, text, text) from public, anon, authenticated;

create or replace function sign_contract_party(
  p_contract uuid, p_party text, p_signer_name text, p_national_id text, p_image text,
  p_ip text default null, p_user_agent text default null, p_method text default 'in_person', p_poa_no text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k contracts%rowtype; v_origin text; v_status text; v_hash text; v_other contract_signatures%rowtype;
  v_cust customers%rowtype; v_name text; v_id text := regexp_replace(coalesce(p_national_id, ''), '\D', '', 'g');
  v_capacity text; v_complete boolean; t trial_agreements%rowtype;
begin
  if p_party not in ('customer', 'company') then raise exception 'طرف التوقيع غير معروف'; end if;
  select * into k from contracts where id = p_contract for update;
  if k.id is null or not contract_in_my_scope(p_contract) then raise exception 'العقد غير موجود'; end if;
  if not has_perm('contracts', 'edit') then raise exception 'لا تملك صلاحية إدارة توقيع العقود'; end if;
  if p_party = 'company' and not has_perm('contracts', 'approve') then
    raise exception 'توقيع ممثل الشركة لمن يملك صلاحية اعتماد العقود';
  end if;
  if coalesce(p_image, '') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_image) < 200 or length(p_image) > 400000 then
    raise exception 'ارسم التوقيع في المساحة المخصّصة';
  end if;

  select coalesce(contract_origin, 'internal') into v_origin from services where code = k.service_code;
  v_status := k.status::text;
  if v_status in ('signed', 'musaned_signed', 'active', 'completed') then
    raise exception 'العقد موقّع — أي تعديل يتطلب نسخة جديدة تُعتمد وتُوقَّع';
  end if;
  if v_status = 'cancelled' then raise exception 'العقد ملغى'; end if;
  if k.service_code = 'transfer_trial' then
    if v_status not in ('draft', 'awaiting_signature') then raise exception 'التجربة ليست بانتظار التوقيع'; end if;
  elsif coalesce(v_origin, 'internal') = 'musaned' then
    if v_status not in ('draft', 'musaned_created') then raise exception 'العقد ليس بانتظار التوقيع'; end if;
  else
    if v_status not in ('approved', 'awaiting_signature') then
      raise exception 'يُوقَّع العقد بعد اعتماده — أرسله للاعتماد أولاً';
    end if;
    if v_status = 'approved' then
      perform contract_sign_transition(p_contract, 'awaiting_signature', 'بدء التوقيع الإلكتروني');
    end if;
  end if;

  if p_party = 'customer' then
    if p_method not in ('in_person', 'agent') then raise exception 'طريقة التوقيع غير معروفة'; end if;
    v_name := btrim(coalesce(p_signer_name, ''));
    if length(v_name) < 3 then raise exception 'أدخل اسم الموقّع كاملاً'; end if;
    if v_id !~ '^[12][0-9]{9}$' then raise exception 'رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2'; end if;
    select * into v_cust from customers where id = k.customer_id;
    if p_method = 'in_person' then
      -- لا يوقّع أحد عن العميل إلا بوكالة موثقة
      if nullif(btrim(coalesce(v_cust.national_id, '')), '') is not null
         and regexp_replace(v_cust.national_id, '\D', '', 'g') <> v_id then
        raise exception 'رقم الهوية لا يطابق ملف العميل — للتوقيع نيابة عنه اختر «وكيل بموجب وكالة»';
      end if;
      v_capacity := 'العميل (الطرف الثاني)';
    else
      if length(btrim(coalesce(p_poa_no, ''))) < 3 then raise exception 'أدخل رقم الوكالة الموثقة'; end if;
      v_capacity := 'وكيل عن العميل بموجب الوكالة ' || btrim(p_poa_no);
    end if;
  else
    select full_name into v_name from user_profiles where id = auth.uid();
    v_name := coalesce(nullif(btrim(v_name), ''), 'ممثل الشركة');
    v_id := null;
    v_capacity := 'ممثل الشركة (الطرف الأول) — ماسية الشرق للاستقدام';
  end if;

  v_hash := contract_content_sha256(p_contract);
  if exists (select 1 from contract_signatures where contract_id = p_contract and signer_type = p_party
              and document_sha256 = v_hash) then
    raise exception 'سبق توقيع هذا الطرف على هذا العقد';
  end if;
  select * into v_other from contract_signatures
   where contract_id = p_contract and signer_type <> p_party and document_sha256 is not null
   order by signed_at desc limit 1;
  if v_other.id is not null and v_other.document_sha256 <> v_hash then
    raise exception 'تغيّر محتوى العقد بعد توقيع الطرف الآخر — يُصدر نسخة جديدة ويُعاد التوقيع';
  end if;

  insert into contract_signatures (contract_id, signer_type, signer_name, national_id, signature_image, ip_address,
                                   signer_capacity, method, poa_no, signed_by, user_agent, document_sha256,
                                   contract_version, image_sha256)
  values (p_contract, p_party, v_name, v_id, p_image, nullif(btrim(coalesce(p_ip, '')), ''),
          v_capacity, case when p_party = 'company' then 'in_person' else p_method end,
          case when p_method = 'agent' and p_party = 'customer' then btrim(p_poa_no) end,
          auth.uid(), left(p_user_agent, 300), v_hash, k.version,
          encode(sha256(convert_to(p_image, 'UTF8')), 'hex'));

  v_complete := exists (select 1 from contract_signatures where contract_id = p_contract and signer_type = 'customer' and document_sha256 = v_hash)
            and exists (select 1 from contract_signatures where contract_id = p_contract and signer_type = 'company' and document_sha256 = v_hash);

  insert into audit_log (user_id, action, table_name, record_id, details)
  values (auth.uid(), 'contract.sign', 'contracts', p_contract,
          jsonb_build_object('party', p_party, 'method', case when p_party = 'company' then 'in_person' else p_method end,
                             'signer', v_name, 'document_sha256', v_hash, 'ip', p_ip, 'complete', v_complete));

  if v_complete then
    if k.service_code = 'transfer_trial' then
      perform contract_sign_transition(p_contract, 'signed', 'توقيع الطرفين حضورياً على عقد التجربة');
      select * into t from trial_agreements where contract_id = p_contract for update;
      if t.id is not null and t.status in ('draft', 'awaiting_acceptance') then
        update trial_links set revoked_at = now() where trial_id = t.id and used_at is null and revoked_at is null;
        update trial_agreements set accepted_at = now() where id = t.id;
        perform trial_set_status(t.id, 'accepted', 'توقيع حضوري — بصمة ' || left(v_hash, 12));
        perform trial_set_status(t.id, 'awaiting_handover', 'بانتظار استكمال متطلبات التسليم');
      end if;
    elsif coalesce(v_origin, 'internal') = 'musaned' then
      null;   -- نسخة المكتب موقّعة؛ مسار مساند (إنشاء/توقيع على المنصة) يبقى كما هو
    else
      perform contract_sign_transition(p_contract, 'signed', 'اكتمل التوقيع الإلكتروني للطرفين');
    end if;
  end if;

  return jsonb_build_object('complete', v_complete, 'document_sha256', v_hash,
                            'status', (select status::text from contracts where id = p_contract));
end $$;
grant execute on function sign_contract_party(uuid, text, text, text, text, text, text, text, text) to authenticated;
