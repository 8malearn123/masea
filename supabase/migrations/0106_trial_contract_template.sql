-- =============================================================
-- 0106 — «نقل كفالة» في «عقد جديد»: عقد التجربة الرسمي (contract_final_black.pdf)
--
--   * القالب: ملف الشركة المرفق نفسه نسخةً معتمدة من شروط التجربة (transfer_trial_terms)
--     — الترويسة والتذييل والإقرار والبنود العشرة حرفياً؛ الفراغات فقط حقول ({{…}}).
--     النسخ السابقة تُوقف، والتجارب السابقة تبقى على لقطتها (terms_snapshot) دون تغيير.
--   * trial_agreements.document_fields: بيانات المستند غير الموجودة في الجداول (الكفيل الحالي،
--     نوع الهوية وتاريخ ومكان إصدارها، الجنسية، المدينة، أجر اليوم، المدفوع، العنوان، العمل…).
--   * create_trial_agreement(…, p_fields): نفس الإنشاء القائم + التحقق من الحقول وحفظها؛ رقم
--     الهوية والجوال من ملف العميل (يُكمَّلان إن كانا فارغين ولا يُستبدلان) لأن القبول يتحقق بهما.
--   * trial_document يعيد الحقول ونسخة القالب؛ الصفحة العامة تُخفي رقم الهوية إلا آخر 4.
--   * القبول الإلكتروني لا يُعد عقد نقل خدمات ولا يغني عن إجراءات مساند (كما في 0092).
-- آمن لإعادة التشغيل.
-- =============================================================

alter table trial_agreements add column if not exists document_fields jsonb not null default '{}'::jsonb;

-- ---------- 1) the official template (verbatim from the company's PDF) ----------
do $$
declare v_doc jsonb; v_ver int; v_id uuid;
begin
  if exists (select 1 from contract_templates where template_code = 'transfer_trial_terms'
              and doc->>'layout' = 'trial_contract_black_v1') then
    return;
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from contract_templates
   where template_code = 'transfer_trial_terms' and service_code = 'transfer_trial';
  v_doc := jsonb_build_object(
    'code', 'transfer_trial_terms', 'version', v_ver, 'title', 'عقد تجربة',
    'layout', 'trial_contract_black_v1', 'source_file', 'contract_final_black.pdf',
    'letterhead_ar', jsonb_build_array('شركة ماسية الشرق للاستقدام', 'ت: 0175444404 - ج: 0539344414', 'س.ت: 5950115029'),
    'letterhead_en', jsonb_build_array('MASIAT AL SHARQ RECRUITMENT CO.', 'TEL: 0175444404 - MOB: 0539344414',
                                       'm.alshrq.recruitment@gmail.com', 'C.R : 5950115029'),
    'footer', jsonb_build_array(
      'المملكة العربية السعودية - نجران - حي دحضة - شارع الملك عبد العزيز - ت: 0175444404 - ج: 0539344414',
      'Kingdom of Saudi Arabia - Najran - Dahda District - King Abdelaziz Road - Tel: 0175444404 - Mob: 0539344414'),
    'lines', jsonb_build_array(
      'أنا السيد/ {{customer_name}} ( {{customer_nationality}} ) الجنسية بموجب {{id_kind:بطاقة / إقامة}}',
      'رقم ( {{id_number}} ) بتاريخ {{id_issue_date}} صادر من {{id_issue_place}}',
      'قد استلمت {{worker_kind:العاملة / السائق}} والتي تحت كفالة السيد / {{sponsor_name}}',
      'باسم {{worker_name}} الجنسية {{worker_nationality}}',
      'وذلك للتجربة ونقل الكفالة بعد الصلاحية لدي في مدة التجربة المحددة وذلك وفقاً للشروط التالية:'),
    'amounts', jsonb_build_array('المبلغ الإجمالي', 'المبلغ المدفوع', 'المبلغ المتبقي'),
    'clauses', jsonb_build_array(
      'يكون العمل لدي في المدينة ( {{city}} ) وسوف تكون التجربة ( {{trial_period}} ) فقط',
      'أتعهد بالمعاملة الحسنة وحسب تعاليم الدين الإسلامي الحنيف',
      'أكون مسؤول عن العاملة مسؤولية كاملة أمام الله ثم أمام النظام في فترة التجربة',
      'أقوم بتوفير السكن الملائم للعاملة والراحة الكافية',
      'في حالة عدم الصلاحية أتعهد بإعادة العاملة للمكتب قبل انتهاء مدة التجربة',
      'في حالة انتهاء مدة التجربة على الكفيل الجديد مراجعة المكتب لاستلام الجواز والإقامة خلال شهر من تاريخه والمكتب غير مسؤول عن أي جواز أو الإقامة بعد شهر من تاريخه',
      'يكون أجر العاملة في حال عدم الصلاحية أثناء فترة التجربة ( {{daily_wage}} ) ريال عن كل يوم عمل لدي',
      'في حالة انتهت فترة التجربة ولم يلتزم بتسليم الخادمة للمكتب لا يحق له المطالبة بأي مبلغ تم دفعه لأنه سوف يتم تحويل المبلغ للكفيل الأول',
      'في حالة هروب الخادمة أثناء فترة التجربة يلزم إثبات في محضر بالشرطة ويتم التفاوض مع الكفيل الأول حول التعويض بواسطة المكتب',
      'أقر بعدم وجود خادمة على اسمي وفي حال وجود أكثر من خادمة يدفع رسوم إضافية للمعقب'),
    'declaration', 'بهذا أقر بأنني قد قرأت الشروط أعلاه وعلى ما جاء فيها من بنود وموافق عليها موافقة غير مشروطة',
    'signature', jsonb_build_array('الاسم :', 'التوقيع :', 'العنوان :', 'العمل :', 'الجوال :'));

  update contract_templates set status = 'retired', is_active = false
   where template_code = 'transfer_trial_terms' and service_code = 'transfer_trial' and status = 'approved';
  insert into contract_templates (service_code, name, clauses, is_active, template_code, doc, version, status,
                                  content_sha256, locked, approved_at)
  values ('transfer_trial', 'عقد تجربة', v_doc->'clauses', true, 'transfer_trial_terms', v_doc, v_ver, 'approved',
          encode(sha256(convert_to(v_doc::text, 'UTF8')), 'hex'), true, now())
  returning id into v_id;
end $$;

-- ---------- 2) create with the document fields ----------
create or replace function create_trial_agreement(
  p_customer uuid, p_worker uuid, p_branch text, p_price numeric, p_days int, p_receipt date, p_fields jsonb)
returns trial_agreements language plpgsql security definer set search_path = public as $$
declare
  v_row trial_agreements; c customers%rowtype; v_f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_paid numeric; v_wage numeric; v_id text := regexp_replace(coalesce(p_fields->>'id_number', ''), '\D', '', 'g');
  v_phone text := regexp_replace(coalesce(p_fields->>'mobile', ''), '\D', '', 'g'); k text;
begin
  foreach k in array array['customer_nationality', 'id_kind', 'id_issue_date', 'id_issue_place', 'worker_kind',
                           'sponsor_name', 'city', 'address', 'job'] loop
    if nullif(btrim(coalesce(v_f->>k, '')), '') is null then
      raise exception 'بيانات عقد التجربة ناقصة: %', k;
    end if;
  end loop;
  if v_f->>'id_kind' not in ('بطاقة', 'إقامة') then raise exception 'نوع الهوية: بطاقة أو إقامة'; end if;
  if v_f->>'worker_kind' not in ('العاملة', 'السائق') then raise exception 'حدّد العاملة أو السائق'; end if;
  v_wage := nullif(v_f->>'daily_wage', '')::numeric;
  if v_wage is null or v_wage <= 0 then raise exception 'حدّد أجر اليوم أثناء التجربة'; end if;
  v_paid := coalesce(nullif(v_f->>'paid_amount', '')::numeric, 0);
  if v_paid < 0 then raise exception 'المبلغ المدفوع لا يكون سالباً'; end if;
  if v_id !~ '^[12][0-9]{9}$' then raise exception 'رقم الهوية/الإقامة 10 أرقام يبدأ بـ 1 أو 2'; end if;
  if v_phone !~ '^05[0-9]{8}$' then raise exception 'رقم الجوال يبدأ بـ 05 ومكوّن من 10 أرقام'; end if;

  -- القبول الإلكتروني يتحقق من الهوية والجوال في ملف العميل: يُكمَّلان إن كانا فارغين ولا يُستبدلان
  select * into c from customers where id = p_customer for update;
  if c.id is null then raise exception 'اختر العميل'; end if;
  if nullif(btrim(coalesce(c.national_id, '')), '') is not null and regexp_replace(c.national_id, '\D', '', 'g') <> v_id then
    raise exception 'رقم الهوية يختلف عن ملف العميل — صحّحه من ملف العميل';
  end if;
  if nullif(btrim(coalesce(c.phone, '')), '') is not null and regexp_replace(c.phone, '\D', '', 'g') <> v_phone then
    raise exception 'رقم الجوال يختلف عن ملف العميل — صحّحه من ملف العميل';
  end if;
  update customers set national_id = coalesce(nullif(btrim(national_id), ''), v_id),
                       phone = coalesce(nullif(btrim(phone), ''), v_phone)
   where id = p_customer and (nullif(btrim(coalesce(national_id, '')), '') is null or nullif(btrim(coalesce(phone, '')), '') is null);

  v_row := create_trial_agreement(p_customer, p_worker, p_branch, p_price, p_days, p_receipt);
  if v_paid > v_row.total_amount then raise exception 'المبلغ المدفوع أكبر من المبلغ الإجمالي'; end if;
  update trial_agreements
     set document_fields = jsonb_build_object(
           'customer_nationality', btrim(v_f->>'customer_nationality'), 'id_kind', v_f->>'id_kind',
           'id_issue_date', v_f->>'id_issue_date', 'id_issue_place', btrim(v_f->>'id_issue_place'),
           'worker_kind', v_f->>'worker_kind', 'sponsor_name', btrim(v_f->>'sponsor_name'),
           'city', btrim(v_f->>'city'), 'daily_wage', v_wage, 'paid_amount', v_paid,
           'address', btrim(v_f->>'address'), 'job', btrim(v_f->>'job'),
           'customer_no', nullif(btrim(coalesce(v_f->>'customer_no', '')), ''))
   where id = v_row.id returning * into v_row;
  return v_row;
end $$;
grant execute on function create_trial_agreement(uuid, uuid, text, numeric, int, date, jsonb) to authenticated;

-- ---------- 3) the document (fields + template version) ----------
create or replace function trial_document(p_trial uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trial_no', t.trial_no, 'contract_no', k.contract_no, 'issued_on', k.created_at,
    'customer_name', cu.full_name, 'customer_national_id', cu.national_id, 'customer_phone', cu.phone,
    'worker_name', w.full_name, 'nationality', w.nationality, 'profession', w.profession,
    'price', t.price, 'vat_amount', t.vat_amount, 'total_amount', t.total_amount,
    'trial_days', t.trial_days, 'receipt_date', t.receipt_date, 'end_date', t.end_date,
    'terms_title', t.terms_snapshot->>'title', 'terms_version', (t.terms_snapshot->>'version')::int,
    'terms', t.terms_snapshot->'clauses', 'template', t.terms_snapshot,
    'fields', t.document_fields,
    'notice', 'قبول هذه التجربة لا يُعد عقد نقل خدمات ولا يغني عن إجراءات منصة مساند الرسمية.')
  from trial_agreements t
  join contracts k on k.id = t.contract_id
  join customers cu on cu.id = t.customer_id
  join worker_profiles w on w.id = t.worker_profile_id
  where t.id = p_trial
$$;
revoke execute on function trial_document(uuid) from public, anon, authenticated;

-- staff read the full document for preview/print (scope + permission)
create or replace function trial_document_for(p_trial uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_contract uuid;
begin
  select contract_id into v_contract from trial_agreements where id = p_trial;
  if v_contract is null or not has_perm('contracts', 'view') or not contract_in_my_scope(v_contract) then
    raise exception 'لا تملك صلاحية عرض عقد التجربة';
  end if;
  return trial_document(p_trial);
end $$;
grant execute on function trial_document_for(uuid) to authenticated;

-- PUBLIC: view only — the ID number is masked except its last 4 digits
create or replace function trial_public_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l trial_links; t trial_agreements; v_doc jsonb; v_id text;
begin
  l := trial_link_row(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  select * into t from trial_agreements where id = l.trial_id;
  v_doc := trial_document(t.id);
  v_id := coalesce(v_doc->>'customer_national_id', '');
  v_doc := v_doc || jsonb_build_object(
    'customer_national_id', case when length(v_id) > 4 then repeat('•', length(v_id) - 4) || right(v_id, 4) else v_id end,
    'customer_phone', case when length(coalesce(v_doc->>'customer_phone', '')) > 4
                           then repeat('•', length(v_doc->>'customer_phone') - 4) || right(v_doc->>'customer_phone', 4)
                           else v_doc->>'customer_phone' end);
  return v_doc || jsonb_build_object(
    'status', t.status,
    'link_state', case when l.used_at is not null then 'used' when l.revoked_at is not null then 'revoked'
                       when l.expires_at < now() then 'expired'
                       when l.attempts >= ops_cfg('trial_link_max_attempts', 5) then 'locked' else 'open' end,
    'otp_required', ops_cfg('trial_otp_required', 0) = 1,
    'accepted_at', t.accepted_at);
end $$;
grant execute on function trial_public_view(text) to anon, authenticated;
