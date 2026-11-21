-- =============================================================
-- 0085 — عقد تأجير خدمات عمالية (القالب الإلكتروني المطابق للأصل)
--
-- يبني فوق وحدة العقود القائمة (0016/0046/0052) — لا جداول موازية:
--   1) contract_templates: قالب «منظَّم» (doc jsonb) مع رقم نسخة وحالة
--      (draft → pending_review → approved → retired) وبصمة SHA-256 للنص.
--      القالب المعتمد مقفل: لا يُعدَّل نصه ولا يُحذف — التصحيح = نسخة جديدة.
--   2) approve_contract_template(): اعتماد رسمي بصلاحية contracts.approve
--      (يُسجَّل في audit_log) ويُقاعد النسخ الأقدم من نفس القالب.
--   3) contracts: رقم نسخة القالب وبصمته تُثبَّت مع كل عقد (trigger) — العقد
--      لا يُنشأ على قالب منظَّم غير معتمد. العقود القديمة لا تُمسّ (أعمدة nullable).
--      + مكان العمل (work_location) ولقطة بيانات الأطراف (doc_fields) تُثبَّت في المسودة.
--   4) بيانات الطرف الأول: أعمدة إضافية على company_tax_profile (نفس كيان
--      الشركة) + دالة قراءة contract_company_profile() لمن يملك contracts.view
--      ودالة تعديل update_contract_company_profile() بصلاحية الاعتماد.
--   5) contract_worker_doc(): رقم الجواز/الإقامة وجوال العاملة للعقد فقط
--      (worker_details خاص بالموارد البشرية — 0078).
--   6) «سياسة الاستبدال المقترحة» (مرتان) كإعداد تشغيلي في app_config —
--      مقترحة وغير مفعّلة، ولا تدخل في نص العقد ولا تُطبَّق كشرط تعاقدي.
--
-- البذرة: النسخة 1 بحالة pending_review — لا تُعتمد تلقائياً؛ يعتمدها
-- المخوَّل من «مراجعة قالب عقد التأجير» بعد مراجعة تقرير المطابقة.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) structured, versioned templates ----------------------------------
alter table contract_templates
  add column if not exists template_code  text,
  add column if not exists doc            jsonb,
  add column if not exists version        integer not null default 1,
  add column if not exists status         text not null default 'approved',
  add column if not exists content_sha256 text,
  add column if not exists locked         boolean not null default false,
  add column if not exists approved_by    uuid references auth.users(id) on delete set null,
  add column if not exists approved_at    timestamptz,
  add column if not exists updated_at     timestamptz not null default now();

do $$ begin
  alter table contract_templates
    add constraint contract_templates_status_chk
    check (status in ('draft', 'pending_review', 'approved', 'retired'));
exception when duplicate_object then null; end $$;

create unique index if not exists uq_contract_templates_code_version
  on contract_templates(template_code, service_code, version)
  where template_code is not null;

-- an approved template is frozen: its legal text never changes in place
create or replace function contract_templates_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.locked then
      raise exception 'قالب العقد المعتمد لا يُحذف — يمكن إيقافه (retired) وإصدار نسخة جديدة';
    end if;
    return old;
  end if;
  if old.locked and (
       new.doc is distinct from old.doc
    or new.clauses is distinct from old.clauses
    or new.version is distinct from old.version
    or new.content_sha256 is distinct from old.content_sha256
    or new.service_code is distinct from old.service_code
  ) then
    raise exception 'نص قالب العقد المعتمد لا يُعدَّل — أنشئ نسخة جديدة واعتمدها رسمياً';
  end if;
  if old.locked and new.status not in ('approved', 'retired') then
    raise exception 'القالب المعتمد لا يعود مسودة — أنشئ نسخة جديدة';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_contract_templates_guard on contract_templates;
create trigger trg_contract_templates_guard
  before update or delete on contract_templates
  for each row execute function contract_templates_guard();

-- ---------- 2) formal approval -----------------------------------------------
create or replace function approve_contract_template(p_template_id uuid)
returns contract_templates
language plpgsql security definer set search_path = public
as $$
declare v_row contract_templates;
begin
  if not (is_admin() or has_perm('contracts', 'approve')) then
    raise exception 'لا تملك صلاحية اعتماد قوالب العقود';
  end if;
  select * into v_row from contract_templates where id = p_template_id for update;
  if v_row.id is null then raise exception 'القالب غير موجود'; end if;
  if v_row.doc is null then raise exception 'هذا القالب ليس قالباً منظَّماً'; end if;
  if v_row.status not in ('draft', 'pending_review') then
    raise exception 'القالب معتمد مسبقاً أو موقوف';
  end if;

  update contract_templates
     set status = 'approved', locked = true, is_active = true,
         approved_by = auth.uid(), approved_at = now()
   where id = v_row.id
   returning * into v_row;

  -- older approved versions of the same template stop being offered for new contracts
  update contract_templates
     set status = 'retired', is_active = false
   where template_code = v_row.template_code and service_code = v_row.service_code
     and id <> v_row.id and status = 'approved' and version < v_row.version;

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract_template.approve', 'contract_templates', v_row.id,
          jsonb_build_object('template_code', v_row.template_code, 'service_code', v_row.service_code,
                             'version', v_row.version, 'content_sha256', v_row.content_sha256));
  return v_row;
end $$;
grant execute on function approve_contract_template(uuid) to authenticated;

-- ---------- 3) contracts pin the template version they were issued on ----------
alter table contracts
  add column if not exists template_version integer,
  add column if not exists template_sha256  text,
  add column if not exists work_location    text;

create or replace function contracts_pin_template()
returns trigger language plpgsql set search_path = public as $$
declare v_t contract_templates;
begin
  if new.template_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.template_id is not distinct from old.template_id then
    return new;
  end if;
  select * into v_t from contract_templates where id = new.template_id;
  if v_t.doc is not null then
    if v_t.status <> 'approved' then
      raise exception 'قالب العقد «%» لم يُعتمد بعد — لا يُصدر عليه عقد', v_t.name;
    end if;
    new.template_version := v_t.version;
    new.template_sha256  := v_t.content_sha256;
  end if;
  return new;
end $$;

drop trigger if exists trg_contracts_pin_template on contracts;
create trigger trg_contracts_pin_template
  before insert or update of template_id on contracts
  for each row execute function contracts_pin_template();

-- the party data printed in the contract (customer, worker, first party) is frozen
-- with the draft — the signed document never changes when a profile is edited later.
alter table contracts add column if not exists doc_fields jsonb;

create or replace function set_contract_doc_fields(p_contract_id uuid, p_fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_c contracts;
begin
  if not (has_perm('contracts', 'create') or has_perm('contracts', 'edit')) then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  select * into v_c from contracts where id = p_contract_id for update;
  if v_c.id is null then raise exception 'العقد غير موجود'; end if;
  if not (is_cross_branch() or v_c.branch_id = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;
  if v_c.status <> 'draft' then
    raise exception 'بيانات العقد تُثبَّت في المسودة فقط — العقد الموقّع لا يُعدَّل';
  end if;
  if jsonb_typeof(p_fields) <> 'object' then raise exception 'بيانات العقد غير صالحة'; end if;
  update contracts set doc_fields = p_fields,
         work_location = coalesce(nullif(p_fields->>'work_location', ''), work_location)
   where id = p_contract_id;
  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'contract.doc_fields', 'contracts', p_contract_id, v_c.doc_fields, p_fields);
end $$;
grant execute on function set_contract_doc_fields(uuid, jsonb) to authenticated;

-- ---------- 4) first party (company) data for the contract ----------------------
alter table company_tax_profile
  add column if not exists seller_name_en text,
  add column if not exists mol_license_no text,
  add column if not exists phone          text,
  add column if not exists mobile         text,
  add column if not exists email          text;

-- seed from the original contract (بنود العقد.pdf) — only fills what is empty
insert into company_tax_profile (id, seller_name, vat_number, cr_number, address, city,
                                 seller_name_en, mol_license_no, phone, mobile, email)
values (1, 'شركة ماسية الشرق للاستقدام', '311499536700003', '5950115029',
        'نجران- حي دحضه – شارع الملك عبدالعزيز', 'نجران',
        'Masiat Alsharq For Recruitment Company', '4018961', '0175444404', '0539344414',
        'm.alshrq.recruitment@gmail.com')
on conflict (id) do update set
  seller_name_en = coalesce(company_tax_profile.seller_name_en, excluded.seller_name_en),
  mol_license_no = coalesce(company_tax_profile.mol_license_no, excluded.mol_license_no),
  phone          = coalesce(company_tax_profile.phone, excluded.phone),
  mobile         = coalesce(company_tax_profile.mobile, excluded.mobile),
  email          = coalesce(company_tax_profile.email, excluded.email),
  cr_number      = coalesce(company_tax_profile.cr_number, excluded.cr_number),
  address        = coalesce(company_tax_profile.address, excluded.address);

create or replace function contract_company_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when has_perm('contracts', 'view') then (
    select jsonb_build_object(
      'name', seller_name, 'name_en', coalesce(seller_name_en, ''),
      'vat_number', vat_number, 'cr_number', coalesce(cr_number, ''),
      'mol_license_no', coalesce(mol_license_no, ''), 'phone', coalesce(phone, ''),
      'mobile', coalesce(mobile, ''), 'address', coalesce(address, ''), 'email', coalesce(email, ''))
    from company_tax_profile where id = 1)
  end
$$;
grant execute on function contract_company_profile() to authenticated;

create or replace function update_contract_company_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not (is_admin() or has_perm('contracts', 'approve')) then
    raise exception 'لا تملك صلاحية تعديل بيانات الطرف الأول';
  end if;
  select to_jsonb(t) into v_old from company_tax_profile t where id = 1;
  update company_tax_profile set
    seller_name    = coalesce(nullif(btrim(p->>'name'), ''), seller_name),
    seller_name_en = coalesce(p->>'name_en', seller_name_en),
    vat_number     = coalesce(nullif(btrim(p->>'vat_number'), ''), vat_number),
    cr_number      = coalesce(p->>'cr_number', cr_number),
    mol_license_no = coalesce(p->>'mol_license_no', mol_license_no),
    phone          = coalesce(p->>'phone', phone),
    mobile         = coalesce(p->>'mobile', mobile),
    address        = coalesce(p->>'address', address),
    email          = coalesce(p->>'email', email),
    updated_at     = now()
  where id = 1;
  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'company_profile.update', 'company_tax_profile', null, v_old, p);
  return contract_company_profile();
end $$;
grant execute on function update_contract_company_profile(jsonb) to authenticated;

-- ---------- 5) worker identity for the contract only ----------------------------
create or replace function contract_worker_doc(p_worker uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when has_perm('contracts', 'view') then (
    select jsonb_build_object('passport_no', d.passport_no, 'iqama_no', d.iqama_no, 'phone', d.phone)
    from worker_details d where d.worker_id = p_worker)
  end
$$;
grant execute on function contract_worker_doc(uuid) to authenticated;

-- ---------- 6) proposed replacement policy (operational, NOT contractual) -------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('replacement_max_proposed',
   'الحد الأقصى المقترح لمرات الاستبدال (مقترح — غير مُضاف للعقد وغير مفعّل كشرط تعاقدي)',
   'سياسة الاستبدال المقترحة', 2, 'مرة', 60)
on conflict (key) do nothing;

-- ---------- 7) seed: «عقد تأجير خدمات عمالية» v1 — pending review ---------------
insert into contract_templates
  (service_code, name, clauses, is_active, template_code, doc, version, status, content_sha256, locked)
select s.code, 'عقد تأجير خدمات عمالية — النسخة 1', '[]'::jsonb, false,
       'rental_labor_services', $tpl${"code":"rental_labor_services","version":1,"title":"عقد تأجير خدمات عمالية","source":{"file":"بنود العقد.pdf","pages":4,"note":"نُقلت النصوص القانونية حرفياً من الأصل (الصفحات 2–4) بنفس الترتيب والترقيم والصياغة؛ الحقول بين {{ }} وحدها متغيّرة."},"cover":[{"t":"brand","ar":["{{company_name}}","س.ت:{{company_cr}}","الرقم الضريبي : {{company_vat}}"],"en":["{{company_name_en}}","C.R:{{company_cr}}","Vat No:{{company_vat}}"]},{"t":"kv","rows":[["رقم العقد","{{contract_no}}","اسم العميل","{{customer_name}}"],["التاريخ","{{contract_date_iso}}","هاتف العميل","{{customer_phone}}"],["اسم العامل","{{worker_name}}","عنوان العميل","{{customer_address}}"],["هاتف العامل","{{worker_phone}}","ملاحظات","{{notes}}"]]},{"t":"items","headers":["الخدمة","الوحدة","العدد","الإجمالي","القيمة المضافة","الصافي"]},{"t":"payments","title":"المدفوعات :","headers":["التاريخ","المبلغ","طريقة الدفع"]},{"t":"qr"},{"t":"welcome","text":"مرحبا بكم واهلا وسهلا"}],"sections":[{"id":"title","label":"عنوان العقد","blocks":[{"t":"title","text":"عقد تأجير خدمات عمالية"},{"t":"line","text":"رقم العقد : {{contract_no}}"},{"t":"line","text":"الحمد لله وحده وبعد ..."},{"t":"line","text":"إنه في يوم {{contract_date}} الموافق : {{contract_weekday}} تم الإتفاق بين كل من :"}]},{"id":"first_party","label":"بيانات الطرف الأول","blocks":[{"t":"heading","text":"الطرف الأول:"},{"t":"grid","rows":[["{{company_name}}","الرقم الضريبي : {{company_vat}}"],["ترخيص وزاره العمل رقم : {{company_mol_license}}","{{company_mobile}} : ج – {{company_phone}} :ت"],["سجل تجاري رقم : {{company_cr}}","رقم جوال الموظف المسؤول : {{employee_mobile}}"],["العنوان : {{company_address}}","{{company_email}}"]]}]},{"id":"second_party","label":"بيانات الطرف الثاني","blocks":[{"t":"heading","text":"الطرف الثاني:"},{"t":"grid","rows":[["الاسم : {{customer_name}}","رقم البطاقة : {{customer_id_no}}"],["رقم الهاتف : {{customer_phone}}","العنوان : {{customer_address}}"],["رقم الجوال : {{customer_mobile}}","مكان العمل : {{work_location}}"]]}]},{"id":"preamble","label":"التمهيد","blocks":[{"t":"heading","text":"تمهيد"},{"t":"para","text":"حيث أن الطرف الأول مرخص من قبل الجهات المختصة للعمل في مجال تقديم الخدمات العمالية للغير , ولديه الخبرة والامكانيات اللازمة لتوفير العدد المطلوب من العمالة لتقديم الخدمات التي يطلبها الغير وفق الأنظمة و اللوائح والتعليمات المعمول بها في المملكة العربية السعودية وبما لا يتعارض مع أحكام الشريعة الإسلامية ، ولحاجة الطرف الثاني لخدمات العمالة للعمل لديه وتحت مسؤوليته ، وبناء على ما تقدم فقد اتفق الطرفان بالنوايا الحسنة والثقة المتبادلة وهما بكامل أهليتهما المعتبة شرعا ونظاما ،على أن يقوم الطرف الأول بتأجير عدد (1) من العمالة الموضح بياناتها أدناه ،"}]},{"id":"worker_term","label":"بيانات العاملة ومدة العقد","blocks":[{"t":"grid","rows":[["اسم العامل/ه : {{worker_name}}","مده العقد : {{duration}}"],["الجنسية : {{worker_nationality}}","تبدأ من تاريخ : {{start_date}}"],["رقم الجواز أو الإقامة : {{worker_doc_no}}","وتنتهي بتاريخ : {{end_date}}"]]}]},{"id":"clause_1","label":"البند الأول: قيمة العقد ومدة سريان العقد","blocks":[{"t":"heading","text":"البند الأول/ قيمه العقد ومده س ر يان العقد:"},{"t":"grid","rows":[["اجمالي قيمة العقد : {{total}}","المبلغ المدفوع : {{paid}}","المبلغ المتبقى : {{remaining}}"]]},{"t":"clause","no":"1","text":"المبلغ الإجمالي للعقد يشمل التأمين والراتب وضريبة القيمة المضافة."},{"t":"clause","no":"2","text":"مدة هذا العقد تحدد وفقا لما هو وارد في الجدول المذكور أعلاه، ويبدأ احتساب مدة الخدمة اعتبارا من تاريخ توقيع العقد."},{"t":"clause","no":"3","text":"يجوز تجديد العقد لمدة مماثلة في حال رغبة الطرف الثاني باستمرار الخدمة وقبول الطرف الأول بذلك، بشرط أن يقوم الطرف الثاني بإخطار الطرف الأول بتجديد العقد قبل انتهاؤه بمدة لا تقل عن أسبوع كحد أدنى. علما ان العقد المجدد قد يكون مختلفا في بنوده عن هذا العقد وفي حال عدم الاخطار بالتجديد فإنه سيتم تطبق ما هو وارد في الفقرة رقم (11) من البند الثالث."}]},{"id":"clause_2","label":"البند الثاني: التزامات الطرف الأول","blocks":[{"t":"heading","text":"البند الثاني/ التزامات الطرف الأول:"},{"t":"clause","no":"1","text":"يلتزم الطرف الأول بتسليم العاملة للطرف الثاني في الموعد المتفق عليه."},{"t":"clause","no":"2","text":"يلتزم الطرف الأول أن تكون العمالة المقدمة متوافقة مع الأنظمة والقوانين المعمول بها في المملكة العربية السعودية."},{"t":"clause","no":"3","text":"يلتزم الطرف الأول بتوفير التأمين الطبي للعمالة، وضمان اللياقة الطبية للعمالة وخلوه من الأمراض المزمنة والعاهات الجسمية التي من شأنها عدم قدرة العمالة على تنفيذ ما تكلف به من أعمال جوهرية."},{"t":"clause","no":"4","text":"يلتزم الطرف الأول توفير البديل للطرف الثاني في حال رفض العاملة العمل او مرضها."}]},{"id":"clause_3","label":"البند الثالث: التزامات الطرف الثاني","blocks":[{"t":"heading","text":"البند الثالث / التزامات الطرف الثاني:"},{"t":"clause","no":"1","text":"يلتزم الطرف الثاني بسداد قيمة العقد المتفق عليها عند توقيع هذا العقد."},{"t":"clause","no":"2","text":"أن يعامل الطرف الثاني العمالة المقدمة خدماتها له هو وأفراد أسرته بالاحترام اللائق وأن يمتنع عن كل قول أو فعل يمس كرامتهم أو ديانتهم أو أشيائهم الخاصة، على سبيل المثال لا الحصر التفتيش بالحقيبة أو الجوال، وإذا قدم أي من العمالة للطرف الأول شكوى تتضمن مخالفة هذا البند فللطرف الأول الحق في سحب العمالة وفسخ العقد واللجوء للجهات المختصة لمحاسبة الطرف الثاني أو المتسبب في تلك الشكوى."},{"t":"clause","no":"3","text":"يتحمل الطرف الثاني كامل المسؤولية النظامية والشرعية عن أية تجاوزات تلحق اضرار بالعمالة ، أو أي غرامات مترتبة لارتكاب العمالة مخالفة للأنظمة داخل المملكة نتيجة توجيه الطرف الثاني أو أحد أفراد عائلته العمالة بالقيام بأعمال غير نظامية أو اهمالهم أو توجيههم باستخدام معدات او آليات أو سيارات غير مصرح باستخدامها مما يترتب عليه مخالفات او غرامات او إصابات للعمالة او الغير وفي حال خالف الطرف الثاني أو احد افراد عائلته هذا الشرط فإنه يحق للطرف الأول فسخ العقد أو سحب العمالة وتحميل الطرف الثاني كافة التكاليف والغرامات المترتبة على ذلك سواء للجهات المختصة او الطرف الأول ."},{"t":"clause","no":"4","text":"يلتزم الطرف الثاني بإشعار الطرف الأول كتابيا بأي تجاوزات أو أخطاء ترتكبها العمالة ، وإبلاغه في حالة تغيب العمالة عن العمل خلال مدة أقصاها 24 ساعة من وقت تغيب العمالة عن طريق الحضور إلى مقر الشركة وكتابة إقراراً بذلك ، وفي حالة إذا كان التغيب بسبب سوء المعاملة من جانب الطرف الثاني أو من له علاقه به وثبت ذلك فإن الطرف الثاني يتحمل مسؤولية القانونية الكاملة وكافة ما يترتب عليها من مصاريف وتكاليف مالية ، كما انه في حالة ما إذا ثبت ان الطرف الثاني قد قام ببلاغ تغيب لم ثبت صحته فإن يتحمل غرامة مالية وقدرها (200) مئتي ﷼ عن كل يوم وكذلك قيمة الخدمة اليومية لكل يوم من تاريخ قيامه بالإبلاغ بأثر رجعي وحتى تاريخ ثبوت عدم صحة التبليغ . كما يحق للطرف الأول فسخ العقد دون تعويض الطرف الثاني بعمالة بديله وإعادة قيمة الخدمة اليومية للمدة المتبقية للعقد."},{"t":"clause","no":"5","text":"عدم تشغيل أي من العمالة المقدمة خدماتها للطرف الثاني في أي اعمال تختلف عن المهنة المحددة ضمن هذا العقد المرخص للعامل بها سواء كان ذلك بطريقة مباشرة أو غير مباشرة كما أن لا يحق للطرف الثاني تشغيل العمالة لدى الغير أو إعادة تقديم خدماتهم بغرض تقديم خدماتهم للغير، ويحق للطرف الأول في حال ثبوت عدم التزام الطرف الثاني بما تضمنه هذا البند فسخ العقد وسحب العمالة مع بقاء حقه في الرجوع على الطرف الثاني بكافة المصاريف والتكاليف المترتبة على ذلك"},{"t":"clause","no":"6","text":"يلتزم الطرف الثاني بتوفير بيئة عمل مناسبة تتوفر فيها عوامل السلامة والامان والا يكلف بعمل خطر يهدد صحة او سلامتها الجسدية أو يمس كرامتها الإنسانية."},{"t":"clause","no":null,"text":"يلتزم الطرف الثاني في تمكين العمالة من اخذ قسط من الراحة والنوم يومياً لمدة لا تقل عن 9 ساعات متواصلة على الأقل بالإضافة إلى إعطائه فترات متقطعة من الراحة وأداء الصلاة اثناء ساعات العمل اليومية."},{"t":"clause","no":"8","text":"يلتزم الطرف الثاني بإحضار العمالة للطرف الأول اثناء سريان العقد لأي ظرف طارئ خاصة عند طلب المكتب احضار العاملة لتسليمها الراتب عند طلب الطرف الأول وذلك لمدة أقصاها ثلاث أيام وإلا يعتبر العقد لاغي."},{"t":"clause","no":"9","text":"يلتزم الطرف الثاني في حالة إرجاع العمالة لأي سبب كان )استبدال- نهاية عقد...- إلخ( أن يقوم بتسليم العمالة الي مقر شركه الطرف الأول."},{"t":"clause","no":"10","text":"في حال رغبه الطرف الثاني في الغاء العقد قبل انتهاء مدته المحددة مسبقا يتم خصم مبلغ 200 ﷼ من قيمه العقد المدفوعة مسبقا عن كل يوم عملت العمالة لديه."},{"t":"clause","no":"11","text":"يلتزم الطرف الثاني بإرجاع العاملة في الموعد المحدد من تاريخ انتهاء العقد علي ان يكون العميل مسئول مسئولية تامة عن تسليم العاملة محل المكتب او يتحمل رسوم توصيل لا تقل عن 50 ﷼ وتقدر الرسوم حسب قرب الموقع من الشركة وحسب وقت تسليم العاملة وفي حال تأخر ارجاع العاملة فأن الطرف الأول يلتزم بدفع مبلغ وقدره 300 ﷼ عن كل يوم تأخير"},{"t":"clause","no":"12","text":"في حالة طلب العميل الغاء العقد وارجاع العاملة وعدم استبدالها بعاملة أخري يتم استرجاع المبلغ في مده أقصاها 7 ايام"}]},{"id":"clause_4","label":"البند الرابع: المنازعات والخلافات","blocks":[{"t":"heading","text":"البند ال را بع/ المنازعات والخلافات:"},{"t":"clause","no":"1","text":"في حالة حدوث خلاف بين الطرفين يتم حلها وديا من خلال اللجوء الى الإدارة المختصة بشركة ماسيه الشرق للاستقدام وإذا لم يتم الوصول الى حل يتم رفع الموضوع لإدارة تنفيذية عليا بالشركة واذا لم يحل خلال ) (15 خمسة عشر يوما بتاريخ رفعه فانه يتم إحالة النزاع في المحكمة المختصة في المملكة العربية السعودية في مدينة نجران والنظر فيها."}]},{"id":"clause_5","label":"البند الخامس: الإخطارات والإشعارات","blocks":[{"t":"heading","text":"البند الخامس/ الإخطارات والاشعارات:"},{"t":"clause","no":"1","text":"تتم جميع الإخطارات والاشعارات بين الطرفين كتابة عن طريق البريد الالكتروني المسجل أعلاه او الهواتف أيا كان نوعها وتجه الإخطارات الى العنوان الموضح لكل من الطرفين في صدد هذا العقد والذي سيعتبر تم تسليمه فعلا الى الطرف المرسل له ويلتزم الطرف الثاني بإخطار الطرف الأول كتابيا في حال قيامه بتغيير عنوانه ومكان اقامته او أي من ارقام الاتصال به المسجلة بهذا العقد او أي من الوثائق لدى الطرف الأول ويتحمل الطرف الثاني وحده المسؤولية كاملة وكافة ما يترتب عليه من اثار نظامية او مالية في حال تقصيره في ذلك كما تعتبر كافة الإخطارات والمكاتبات الصادرة عن الطرف الأول والموجهة من الطرف الثاني على العناوين المسجلة لديه في هذه الحالة مرتبة بكافة الاثار القانونية وبحكم المستلمة فعليه ."}]},{"id":"clause_6","label":"البند السادس: نسخ العقد","blocks":[{"t":"heading","text":"البند السادس/ نسخ العقد"},{"t":"para","text":"حرر هذا العقد من ثلاث نسخ أصل وصورتين يلتزم على الطرف الأول تسليم نسخه للطرف الثاني من العقد موقع ومختم بختم الشركة بعد توقيعها وقد استلم كل طرف نسخه"},{"t":"para","text":"وتعتبر جميع النسخ مستند واحد ولها حجتها واقر الطرفان بقراءة العقد لكافة بنوده وشروط العقد وفهمها فهما نافيا للجهالة وبموافقتهما الصريحة على كل ما ورد فيه. وجري التوقيع على ذلك."}]},{"id":"signatures","label":"توقيع الموظف وتوقيع العميل","blocks":[{"t":"signatures","items":["توقيع الموظف","توقيع العميل"]}]}]}$tpl$::jsonb, 1, 'pending_review',
       '2c17375e788419775a8cca949f6d139fcb110c216bad981b899c9739446c1243', false
from services s
where s.code in ('monthly_rental', 'daily_rental')
  and not exists (
    select 1 from contract_templates t
    where t.template_code = 'rental_labor_services' and t.service_code = s.code and t.version = 1
  );
