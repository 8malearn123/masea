-- =============================================================
-- 0092 — تجربة عاملة بغرض نقل الخدمات (المرحلة 4)
--
-- مسار مستقل عن التأجير العادي وعن عقد نقل الخدمات النهائي، ومبني فوق القائم:
--   1) الخدمة transfer_trial في services (غير ظاهرة للعموم حتى تُسعَّر وتُعتمد
--      شروطها). شروط التجربة قالب منظَّم في contract_templates (نفس الاعتماد
--      والقفل 0087) — لا شروط مزروعة: تكتبها الشركة وتعتمدها قبل أول تجربة.
--   2) كل تجربة لها عقد في contracts (service_code = transfer_trial) فتعمل
--      الدفعات والقيود ومنع تداخل العاملة والتسوية والإرجاع عليها كما هي.
--   3) trial_agreements: بيانات التجربة وحالاتها التسع + قائمة المتطلبات النظامية
--      قبل التسليم (من contract_lookups/trial_requirement) — لا تسليم قبل اكتمالها.
--   4) القبول الإلكتروني: رابط آمن برمز عشوائي يُحفظ مُجزّأً (sha256) وله صلاحية
--      ومحاولات محدودة. فتح الرابط لا يغيّر شيئاً؛ القبول يتطلب آخر 4 أرقام من
--      الهوية وآخر 4 من الجوال المسجّلين (ورمز OTP عند تفعيله وربط مزوّد الرسائل)
--      ثم ضغط «أوافق». يُحفظ سجل قبول غير قابل للتعديل بالبصمة والوقت وعنوان IP.
--   5) outbound_messages: طابور رسائل العميل (رابط، تأكيد، رمز) لمزوّد معتمد —
--      الإرسال الفعلي عند ربط المزوّد (docs/INTEGRATIONS.md).
--   6) نهاية التجربة: رغبة بالنقل ← مسودة عقد نقل كفالة على مسار مساند (لا نقل
--      فعلي في النظام)؛ عدم الرغبة ← إرجاع وتسوية بالشروط المعتمدة فقط.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) the service + config --------------------------------------------
insert into services (code, name_ar, tagline_ar, unit, is_active, sort_order, contract_origin)
values ('transfer_trial', 'تجربة عاملة بغرض نقل الخدمات',
        'تجربة العاملة لدى العميل قبل نقل خدماتها عبر مساند', 'day', false, 90, 'internal')
on conflict (code) do nothing;

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('trial_max_days', 'أقصى مدة لتجربة العاملة (لائحة العمالة المنزلية — المادة التاسعة)', 'تجربة نقل الخدمات', 90, 'يوم', 70),
  ('trial_link_valid_hours', 'صلاحية رابط قبول التجربة', 'تجربة نقل الخدمات', 72, 'ساعة', 71),
  ('trial_link_max_attempts', 'عدد محاولات التحقق المسموحة على رابط القبول', 'تجربة نقل الخدمات', 5, 'محاولة', 72),
  ('trial_otp_required', 'اشتراط رمز تحقق SMS عند القبول (1 = نعم — يتطلب ربط مزوّد الرسائل)', 'تجربة نقل الخدمات', 0, 'مفتاح', 73),
  ('trial_expiring_alert_days', 'تنبيه التجارب التي تنتهي خلال', 'تجربة نقل الخدمات', 3, 'يوم', 74)
on conflict (key) do nothing;

insert into contract_lookups (kind, code, name_ar, flag, sort_order) values
  ('trial_requirement', 'iqama_valid', 'إقامة العاملة سارية', true, 1),
  ('trial_requirement', 'not_absent', 'العاملة غير مسجّلة كمتغيبة عن العمل', true, 2),
  ('trial_requirement', 'worker_consent', 'موافقة العاملة على التجربة', true, 3),
  ('trial_requirement', 'employer_eligible', 'أهلية العميل على مساند (القدرة المالية والحد الأقصى)', true, 4),
  ('trial_requirement', 'payment_received', 'سداد قيمة التجربة', false, 5)
on conflict do nothing;

-- ---------- 2) trial terms = a structured template (draft → approved, locked) ---
create or replace function save_trial_terms_draft(p_title text, p_clauses text[])
returns contract_templates language plpgsql security definer set search_path = public as $$
declare v_row contract_templates; v_ver int; v_doc jsonb;
begin
  if not has_perm('contracts', 'approve') then raise exception 'تحرير شروط التجربة لمن يملك اعتماد العقود'; end if;
  if coalesce(array_length(p_clauses, 1), 0) = 0 then raise exception 'اكتب بنداً واحداً على الأقل'; end if;
  if exists (select 1 from unnest(p_clauses) c where nullif(btrim(c), '') is null) then
    raise exception 'لا بنود فارغة';
  end if;
  select * into v_row from contract_templates
   where template_code = 'transfer_trial_terms' and service_code = 'transfer_trial' and not locked
   order by version desc limit 1;
  if v_row.id is null then
    select coalesce(max(version), 0) + 1 into v_ver from contract_templates
     where template_code = 'transfer_trial_terms' and service_code = 'transfer_trial';
  else
    v_ver := v_row.version;
  end if;
  v_doc := jsonb_build_object('code', 'transfer_trial_terms', 'version', v_ver,
                              'title', coalesce(nullif(btrim(p_title), ''), 'شروط تجربة العاملة بغرض نقل الخدمات'),
                              'clauses', to_jsonb(p_clauses));
  if v_row.id is null then
    insert into contract_templates (service_code, name, clauses, is_active, template_code, doc, version, status,
                                    content_sha256, locked)
    values ('transfer_trial', v_doc->>'title', to_jsonb(p_clauses), false, 'transfer_trial_terms', v_doc, v_ver,
            'pending_review', encode(sha256(convert_to(v_doc::text, 'UTF8')), 'hex'), false)
    returning * into v_row;
  else
    update contract_templates set name = v_doc->>'title', clauses = to_jsonb(p_clauses), doc = v_doc,
      content_sha256 = encode(sha256(convert_to(v_doc::text, 'UTF8')), 'hex'), status = 'pending_review'
     where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end $$;
grant execute on function save_trial_terms_draft(text, text[]) to authenticated;

-- ---------- 3) trials --------------------------------------------------------------
create table if not exists trial_agreements (
  id                    uuid primary key default gen_random_uuid(),
  trial_no              text unique,
  contract_id           uuid not null unique references contracts(id) on delete restrict,
  customer_id           uuid not null references customers(id) on delete restrict,
  worker_profile_id     uuid not null references worker_profiles(id) on delete restrict,
  branch_id             uuid references branches(id) on delete set null,
  price                 numeric(12,2) not null check (price > 0),      -- قبل الضريبة
  vat_amount            numeric(12,2) not null,
  total_amount          numeric(12,2) not null,
  pricing_reference     numeric(12,2),                                  -- calc_price للتوثيق
  trial_days            integer not null check (trial_days > 0),
  receipt_date          date not null,
  end_date              date not null,
  terms_template_id     uuid not null references contract_templates(id) on delete restrict,
  terms_snapshot        jsonb not null,                                 -- نص الشروط المعتمد وقت الإنشاء
  regulatory_checklist  jsonb not null default '{}'::jsonb,              -- {code: {done, note, by, at}}
  status                text not null default 'draft' check (status in
                          ('draft','awaiting_acceptance','accepted','awaiting_handover','in_trial',
                           'completed','wants_transfer','declined','cancelled')),
  accepted_at           timestamptz,
  transfer_contract_id  uuid references contracts(id) on delete restrict,
  decision_note         text,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_trials_status on trial_agreements(status);
create index if not exists idx_trials_end on trial_agreements(end_date);
alter table trial_agreements enable row level security;
drop policy if exists ta_read on trial_agreements;
create policy ta_read on trial_agreements for select to authenticated
  using (has_perm('contracts', 'view') and contract_in_my_scope(contract_id));

create table if not exists trial_links (
  id           uuid primary key default gen_random_uuid(),
  trial_id     uuid not null references trial_agreements(id) on delete restrict,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  otp_hash     text,
  otp_expires  timestamptz,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table trial_links enable row level security;   -- no policies: only definer functions touch it

create table if not exists trial_acceptances (
  id                 uuid primary key default gen_random_uuid(),
  trial_id           uuid not null unique references trial_agreements(id) on delete restrict,
  link_id            uuid not null references trial_links(id) on delete restrict,
  accepted_at        timestamptz not null default now(),
  verified_by        text not null,       -- id_last4+phone_last4 | +otp
  national_id_last4  text not null,
  phone_masked       text,
  ip_address         text,
  user_agent         text,
  document           jsonb not null,      -- the exact document the customer accepted
  document_sha256    text not null
);
alter table trial_acceptances enable row level security;
drop policy if exists tac_read on trial_acceptances;
create policy tac_read on trial_acceptances for select to authenticated
  using (exists (select 1 from trial_agreements t where t.id = trial_id
                   and has_perm('contracts', 'view') and contract_in_my_scope(t.contract_id)));
create or replace function guard_trial_acceptance() returns trigger language plpgsql as $$
begin raise exception 'سجل القبول الإلكتروني لا يُعدَّل ولا يُحذف'; end $$;
drop trigger if exists trg_guard_trial_acceptance on trial_acceptances;
create trigger trg_guard_trial_acceptance before update or delete on trial_acceptances
  for each row execute function guard_trial_acceptance();

create table if not exists outbound_messages (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (channel in ('sms','email','whatsapp')),
  to_address  text not null,
  template    text not null,             -- trial_link | trial_accepted | trial_otp
  body        text not null,
  entity      text,
  entity_id   uuid,
  status      text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  provider_ref text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
alter table outbound_messages enable row level security;
drop policy if exists om_read on outbound_messages;
create policy om_read on outbound_messages for select to authenticated using (has_perm('settings', 'manage'));

do $$
declare t text;
begin
  foreach t in array array['trial_agreements','trial_acceptances'] loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- the document the customer sees and accepts (no national ID, masked phone)
create or replace function trial_document(p_trial uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trial_no', t.trial_no, 'customer_name', cu.full_name,
    'worker_name', w.full_name, 'nationality', w.nationality, 'profession', w.profession,
    'price', t.price, 'vat_amount', t.vat_amount, 'total_amount', t.total_amount,
    'trial_days', t.trial_days, 'receipt_date', t.receipt_date, 'end_date', t.end_date,
    'terms_title', t.terms_snapshot->>'title', 'terms_version', (t.terms_snapshot->>'version')::int,
    'terms', t.terms_snapshot->'clauses',
    'notice', 'قبول هذه التجربة لا يُعد عقد نقل خدمات ولا يغني عن إجراءات منصة مساند الرسمية.')
  from trial_agreements t
  join customers cu on cu.id = t.customer_id
  join worker_profiles w on w.id = t.worker_profile_id
  where t.id = p_trial
$$;
revoke execute on function trial_document(uuid) from public, anon, authenticated;

create or replace function trial_set_status(p_trial uuid, p_to text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_from text; v_contract uuid;
begin
  select status, contract_id into v_from, v_contract from trial_agreements where id = p_trial for update;
  update trial_agreements set status = p_to, updated_at = now() where id = p_trial;
  perform log_contract_op(v_contract, 'trial', p_trial, 'status', v_from, p_to, p_note);
end $$;
revoke execute on function trial_set_status(uuid, text, text) from public, anon, authenticated;

-- contract status changes for the trial run outside the internal approval track
create or replace function trial_contract_to(p_contract uuid, p_to text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_from text;
begin
  select status::text into v_from from contracts where id = p_contract;
  if v_from = p_to then return; end if;
  perform set_config('masea.settling', 'on', true);
  update contracts set status = p_to::contract_status,
    signed_at = case when p_to = 'signed' then now() else signed_at end, updated_at = now()
   where id = p_contract;
  perform set_config('masea.settling', 'off', true);
  insert into contract_status_history (contract_id, from_status, to_status, changed_by, note)
  values (p_contract, v_from, p_to, auth.uid(), p_note);
end $$;
revoke execute on function trial_contract_to(uuid, text, text) from public, anon, authenticated;

create or replace function create_trial_agreement(
  p_customer uuid, p_worker uuid, p_branch text, p_price numeric, p_days int, p_receipt date)
returns trial_agreements language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid := resolve_branch_id(p_branch); v_tpl contract_templates; v_max int;
  v_ref numeric; v_contract contracts; v_row trial_agreements; v_end date; v_hit contracts; v_wname text;
begin
  if not has_perm('contracts', 'create') then raise exception 'لا تملك صلاحية إنشاء التجارب'; end if;
  if v_branch is null then raise exception 'الفرع غير معروف'; end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then raise exception 'لا يمكنك الإنشاء خارج فرعك'; end if;
  if p_customer is null then raise exception 'اختر العميل'; end if;
  if coalesce(p_price, 0) <= 0 then raise exception 'حدّد سعر التجربة المتفق عليه'; end if;
  v_max := ops_cfg('trial_max_days', 90)::int;
  if coalesce(p_days, 0) <= 0 or p_days > v_max then
    raise exception 'مدة التجربة بين يوم و% يوماً (لائحة العمالة المنزلية — المادة التاسعة)', v_max;
  end if;
  if p_receipt is null then raise exception 'حدّد تاريخ استلام العاملة'; end if;
  select * into v_tpl from contract_templates
   where template_code = 'transfer_trial_terms' and service_code = 'transfer_trial' and status = 'approved'
   order by version desc limit 1;
  if v_tpl.id is null then
    raise exception 'لا توجد شروط تجربة معتمدة — تكتبها الشركة وتعتمدها من الإعدادات أولاً';
  end if;
  select full_name into v_wname from worker_profiles where id = p_worker and is_active;
  if v_wname is null then raise exception 'العاملة غير موجودة أو معطّلة'; end if;
  v_end := p_receipt + p_days - 1;
  v_hit := worker_contract_conflict(p_worker, p_receipt, v_end, null);
  if v_hit.id is not null then
    raise exception 'العاملة % محجوزة على العقد % في فترة التجربة', v_wname, coalesce(v_hit.contract_no, v_hit.id::text);
  end if;
  -- مرجع التسعير الموحّد (calc_price) يُحفظ للتوثيق؛ السعر المعتمد هو المتفق عليه
  begin
    v_ref := nullif((calc_price('transfer_trial', jsonb_build_object('quantity', 1))->>'base')::numeric, 0);
  exception when others then v_ref := null;
  end;

  insert into contracts (contract_no, service_code, template_id, customer_id, branch_id, start_date, end_date,
                         gross_amount, discount_amount, base_amount, pricing_params, status, created_by)
  values (generate_contract_no(), 'transfer_trial', v_tpl.id, p_customer, v_branch, p_receipt, v_end,
          p_price, 0, p_price, jsonb_build_object('agreed_price', p_price, 'calc_price_reference', v_ref,
          'trial_days', p_days), 'draft', auth.uid())
  returning * into v_contract;
  update contracts set worker_profile_id = p_worker where id = v_contract.id returning * into v_contract;
  insert into contract_status_history (contract_id, from_status, to_status, changed_by, note)
  values (v_contract.id, null, 'draft', auth.uid(), 'تجربة نقل خدمات');

  insert into trial_agreements (trial_no, contract_id, customer_id, worker_profile_id, branch_id, price, vat_amount,
    total_amount, pricing_reference, trial_days, receipt_date, end_date, terms_template_id, terms_snapshot, created_by)
  values (next_ops_no('TR'), v_contract.id, p_customer, p_worker, v_branch, p_price, v_contract.vat_amount,
    v_contract.total_amount, v_ref, p_days, p_receipt, v_end, v_tpl.id, v_tpl.doc, auth.uid())
  returning * into v_row;
  perform log_contract_op(v_contract.id, 'trial', v_row.id, 'create', null, 'draft', null);
  return v_row;
end $$;
grant execute on function create_trial_agreement(uuid, uuid, text, numeric, int, date) to authenticated;

-- issue (or re-issue) the secure link: returns the raw token ONCE; only its hash is stored
create or replace function issue_trial_link(p_trial uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t trial_agreements; v_token text; v_link uuid; v_phone text; v_exp timestamptz;
begin
  select * into t from trial_agreements where id = p_trial for update;
  if not found then raise exception 'التجربة غير موجودة'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(t.contract_id) then
    raise exception 'لا تملك صلاحية إرسال رابط القبول';
  end if;
  if t.status not in ('draft','awaiting_acceptance') then raise exception 'قُبلت التجربة أو انتهت — لا رابط جديد'; end if;
  update trial_links set revoked_at = now() where trial_id = p_trial and used_at is null and revoked_at is null;
  v_token := encode(gen_random_bytes(24), 'hex');
  v_exp := now() + make_interval(hours => ops_cfg('trial_link_valid_hours', 72)::int);
  insert into trial_links (trial_id, token_hash, expires_at, created_by)
  values (p_trial, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_exp, auth.uid())
  returning id into v_link;
  if t.status = 'draft' then
    perform trial_contract_to(t.contract_id, 'awaiting_signature', 'أُرسل رابط قبول التجربة');
    perform trial_set_status(p_trial, 'awaiting_acceptance', null);
  end if;
  select phone into v_phone from customers where id = t.customer_id;
  if nullif(btrim(coalesce(v_phone, '')), '') is not null then
    insert into outbound_messages (channel, to_address, template, body, entity, entity_id)
    values ('sms', v_phone, 'trial_link',
            'ماسية الشرق: مستند تجربة العاملة رقم ' || t.trial_no || ' جاهز لمراجعتك وقبوله عبر الرابط المرسل من الفرع.',
            'trial', p_trial);
  end if;
  perform log_contract_op(t.contract_id, 'trial', p_trial, 'issue_link', null, null,
                          'صالح حتى ' || to_char(v_exp at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI'));
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;
grant execute on function issue_trial_link(uuid) to authenticated;

create or replace function trial_link_row(p_token text) returns trial_links
language sql stable security definer set search_path = public as $$
  select * from trial_links where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;
revoke execute on function trial_link_row(text) from public, anon, authenticated;

-- PUBLIC: view only. Opening the link changes nothing.
create or replace function trial_public_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l trial_links; t trial_agreements;
begin
  l := trial_link_row(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  select * into t from trial_agreements where id = l.trial_id;
  return trial_document(t.id) || jsonb_build_object(
    'status', t.status,
    'link_state', case when l.used_at is not null then 'used' when l.revoked_at is not null then 'revoked'
                       when l.expires_at < now() then 'expired'
                       when l.attempts >= ops_cfg('trial_link_max_attempts', 5) then 'locked' else 'open' end,
    'otp_required', ops_cfg('trial_otp_required', 0) = 1,
    'accepted_at', t.accepted_at);
end $$;
grant execute on function trial_public_view(text) to anon, authenticated;

-- PUBLIC: the acceptance itself (identity check + explicit consent)
create or replace function trial_accept(p_token text, p_id_last4 text, p_phone_last4 text,
                                        p_otp text default null, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l trial_links; t trial_agreements; cu customers; v_doc jsonb; v_hash text; v_ip text; v_ok boolean;
begin
  l := trial_link_row(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  select * into l from trial_links where id = l.id for update;
  if l.used_at is not null then raise exception 'سبق قبول هذه التجربة من هذا الرابط'; end if;
  if l.revoked_at is not null then raise exception 'هذا الرابط أُلغي — اطلب رابطاً جديداً من الفرع'; end if;
  if l.expires_at < now() then raise exception 'انتهت صلاحية الرابط — اطلب رابطاً جديداً من الفرع'; end if;
  if l.attempts >= ops_cfg('trial_link_max_attempts', 5) then
    raise exception 'تجاوزت عدد المحاولات — تواصل مع الفرع';
  end if;
  select * into t from trial_agreements where id = l.trial_id for update;
  if t.status <> 'awaiting_acceptance' then raise exception 'التجربة ليست بانتظار القبول'; end if;
  select * into cu from customers where id = t.customer_id;

  v_ok := length(coalesce(cu.national_id, '')) >= 4 and length(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g')) >= 4
      and right(cu.national_id, 4) = btrim(coalesce(p_id_last4, ''))
      and right(regexp_replace(cu.phone, '\D', '', 'g'), 4) = btrim(coalesce(p_phone_last4, ''));
  if v_ok and ops_cfg('trial_otp_required', 0) = 1 then
    v_ok := l.otp_hash is not null and l.otp_expires > now()
        and l.otp_hash = encode(sha256(convert_to(coalesce(p_otp, ''), 'UTF8')), 'hex');
  end if;
  if not v_ok then
    update trial_links set attempts = attempts + 1 where id = l.id;
    -- the failed attempt must persist: return an error payload instead of raising
    return jsonb_build_object('ok', false, 'error', 'بيانات التحقق غير مطابقة لبيانات العميل المسجّلة',
                              'attempts_left', greatest(ops_cfg('trial_link_max_attempts', 5)::int - l.attempts - 1, 0));
  end if;

  v_doc := trial_document(t.id);
  v_hash := encode(sha256(convert_to(v_doc::text, 'UTF8')), 'hex');
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  exception when others then v_ip := null;
  end;
  insert into trial_acceptances (trial_id, link_id, verified_by, national_id_last4, phone_masked, ip_address,
                                 user_agent, document, document_sha256)
  values (t.id, l.id, case when ops_cfg('trial_otp_required', 0) = 1 then 'id_last4+phone_last4+otp'
                           else 'id_last4+phone_last4' end,
          right(cu.national_id, 4), '******' || right(regexp_replace(cu.phone, '\D', '', 'g'), 4),
          nullif(v_ip, ''), left(p_user_agent, 300), v_doc, v_hash);
  update trial_links set used_at = now() where id = l.id;
  update trial_agreements set accepted_at = now() where id = t.id;

  -- the acceptance is the customer's consent (no handwritten signature on a trial)
  insert into contract_signatures (contract_id, signer_type, signer_name, national_id)
  values (t.contract_id, 'customer', cu.full_name || ' — موافقة إلكترونية على شروط التجربة', right(cu.national_id, 4)),
         (t.contract_id, 'company', 'ماسية الشرق للاستقدام — إصدار إلكتروني', null);
  perform trial_contract_to(t.contract_id, 'signed', 'قبول إلكتروني للتجربة ' || t.trial_no);
  perform trial_set_status(t.id, 'accepted', 'قبول إلكتروني — بصمة ' || left(v_hash, 12));
  perform trial_set_status(t.id, 'awaiting_handover', 'بانتظار استكمال متطلبات التسليم');
  if nullif(btrim(coalesce(cu.phone, '')), '') is not null then
    insert into outbound_messages (channel, to_address, template, body, entity, entity_id)
    values ('sms', cu.phone, 'trial_accepted',
            'ماسية الشرق: تم تسجيل قبولك لتجربة العاملة رقم ' || t.trial_no || '. مرجع القبول ' || left(v_hash, 12) || '.',
            'trial', t.id);
  end if;
  return jsonb_build_object('ok', true, 'reference', left(v_hash, 12), 'accepted_at', now(), 'document', v_doc);
end $$;
grant execute on function trial_accept(text, text, text, text, text) to anon, authenticated;

-- PUBLIC: request an OTP (only when required); the code goes to the queued SMS
create or replace function trial_request_otp(p_token text, p_id_last4 text, p_phone_last4 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l trial_links; t trial_agreements; cu customers; v_code text;
begin
  if ops_cfg('trial_otp_required', 0) <> 1 then return jsonb_build_object('ok', false, 'error', 'رمز التحقق غير مفعّل'); end if;
  l := trial_link_row(p_token);
  if l.id is null or l.used_at is not null or l.revoked_at is not null or l.expires_at < now()
     or l.attempts >= ops_cfg('trial_link_max_attempts', 5) then
    return jsonb_build_object('ok', false, 'error', 'الرابط غير صالح');
  end if;
  select * into t from trial_agreements where id = l.trial_id;
  select * into cu from customers where id = t.customer_id;
  if right(coalesce(cu.national_id, ''), 4) <> btrim(coalesce(p_id_last4, ''))
     or right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 4) <> btrim(coalesce(p_phone_last4, '')) then
    update trial_links set attempts = attempts + 1 where id = l.id;
    return jsonb_build_object('ok', false, 'error', 'بيانات التحقق غير مطابقة');
  end if;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update trial_links set otp_hash = encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
    otp_expires = now() + interval '10 minutes' where id = l.id;
  insert into outbound_messages (channel, to_address, template, body, entity, entity_id)
  values ('sms', cu.phone, 'trial_otp', 'رمز التحقق لقبول تجربة العاملة: ' || v_code || ' (صالح 10 دقائق)', 'trial', t.id);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function trial_request_otp(text, text, text) to anon, authenticated;

-- regulatory checklist before handover
create or replace function set_trial_requirement(p_trial uuid, p_code text, p_done boolean, p_note text default null)
returns trial_agreements language plpgsql security definer set search_path = public as $$
declare t trial_agreements;
begin
  select * into t from trial_agreements where id = p_trial for update;
  if not found then raise exception 'التجربة غير موجودة'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(t.contract_id) then
    raise exception 'لا تملك صلاحية تحديث المتطلبات';
  end if;
  if t.status not in ('draft','awaiting_acceptance','accepted','awaiting_handover') then
    raise exception 'تُستكمل المتطلبات قبل التسليم';
  end if;
  if not exists (select 1 from contract_lookups where kind = 'trial_requirement' and code = p_code) then
    raise exception 'متطلب غير معروف';
  end if;
  update trial_agreements set regulatory_checklist = regulatory_checklist || jsonb_build_object(p_code,
      jsonb_build_object('done', p_done, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'by', auth.uid(), 'at', now())),
    updated_at = now()
   where id = p_trial returning * into t;
  perform log_contract_op(t.contract_id, 'trial', t.id, case when p_done then 'requirement_done' else 'requirement_open' end,
                          null, null, (select name_ar from contract_lookups where kind = 'trial_requirement' and code = p_code));
  return t;
end $$;
grant execute on function set_trial_requirement(uuid, text, boolean, text) to authenticated;

create or replace function trial_missing_requirements(p_trial uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.name_ar order by l.sort_order), '{}')
    from contract_lookups l, trial_agreements t
   where t.id = p_trial and l.kind = 'trial_requirement' and l.is_active and l.flag
     and coalesce((t.regulatory_checklist->l.code->>'done')::boolean, false) = false
$$;
grant execute on function trial_missing_requirements(uuid) to authenticated;

create or replace function trial_step(p_trial uuid, p_action text, p_date date default null, p_note text default null)
returns trial_agreements language plpgsql security definer set search_path = public as $$
declare t trial_agreements; v_missing text[]; v_transfer contracts; c contracts;
begin
  select * into t from trial_agreements where id = p_trial for update;
  if not found then raise exception 'التجربة غير موجودة'; end if;
  if not has_perm('contracts', 'edit') or not contract_in_my_scope(t.contract_id) then
    raise exception 'لا تملك صلاحية على هذه التجربة';
  end if;

  if p_action = 'start' then
    if t.status not in ('accepted','awaiting_handover') then raise exception 'تبدأ التجربة بعد قبول العميل'; end if;
    v_missing := trial_missing_requirements(p_trial);
    if array_length(v_missing, 1) > 0 then
      raise exception 'لا تسليم قبل استكمال المتطلبات النظامية: %', array_to_string(v_missing, '، ');
    end if;
    perform trial_contract_to(t.contract_id, 'active', 'تسليم العاملة — بداية التجربة');
    perform trial_set_status(p_trial, 'in_trial', p_note);
  elsif p_action = 'complete' then
    if t.status <> 'in_trial' then raise exception 'التجربة ليست جارية'; end if;
    perform trial_set_status(p_trial, 'completed', p_note);
  elsif p_action = 'transfer' then
    if t.status not in ('in_trial','completed') then raise exception 'القرار بعد بدء التجربة'; end if;
    -- مسودة عقد نقل الكفالة على مسار مساند — النقل الفعلي عبر مساند/أبشر فقط
    select * into c from contracts where id = t.contract_id;
    v_transfer := create_contract_draft(jsonb_build_object(
      'service_code', 'sponsorship_transfer', 'customer_id', t.customer_id, 'branch', t.branch_id::text,
      'start_date', greatest(coalesce(p_date, current_date), t.receipt_date) + 1), '[]'::jsonb);
    update contracts set worker_profile_id = t.worker_profile_id where id = v_transfer.id;
    -- التجربة تنتهي في تاريخ القرار حتى لا تتداخل مع عقد النقل
    update contracts set end_date = least(c.end_date, greatest(coalesce(p_date, current_date), t.receipt_date))
     where id = t.contract_id;
    update trial_agreements set transfer_contract_id = v_transfer.id, decision_note = p_note,
      end_date = least(end_date, greatest(coalesce(p_date, current_date), t.receipt_date)) where id = p_trial;
    perform trial_set_status(p_trial, 'wants_transfer', coalesce(p_note, 'العميل يرغب في نقل الخدمات'));
    perform trial_contract_to(t.contract_id, 'completed', 'انتهاء التجربة برغبة نقل الخدمات');
  elsif p_action = 'decline' then
    if t.status not in ('in_trial','completed') then raise exception 'القرار بعد بدء التجربة'; end if;
    update trial_agreements set decision_note = p_note where id = p_trial;
    perform trial_set_status(p_trial, 'declined', coalesce(p_note, 'العميل لا يرغب في الاستمرار'));
  elsif p_action = 'cancel' then
    if t.status not in ('draft','awaiting_acceptance','accepted','awaiting_handover') then
      raise exception 'بعد التسليم تُنهى التجربة بالإرجاع والتسوية';
    end if;
    update trial_links set revoked_at = now() where trial_id = p_trial and used_at is null and revoked_at is null;
    perform trial_contract_to(t.contract_id, 'cancelled', 'إلغاء التجربة قبل التسليم');
    perform trial_set_status(p_trial, 'cancelled', p_note);
  else
    raise exception 'إجراء غير معروف';
  end if;
  select * into t from trial_agreements where id = p_trial;
  return t;
end $$;
grant execute on function trial_step(uuid, text, date, text) to authenticated;

-- ---------- 4) the worker stays with the customer while the transfer proceeds ----
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
      case when tg_op = 'UPDATE' and old.status = 'active' then 'returning' else 'available' end
    else null end;
  if v_to is null then return new; end if;
  -- 0092: تجربة انتهت برغبة النقل ← العاملة باقية لدى العميل بانتظار إجراءات مساند
  if v_to = 'returning' and exists (select 1 from trial_agreements t
                                     where t.contract_id = new.id and t.status = 'wants_transfer') then
    v_to := 'reserved';
  end if;
  if v_to = 'available' then
    if worker_profile_has_other_live(v_profile, new.id) then return new; end if;
    update worker_profiles set status = 'available' where id = v_profile and status = 'reserved';
    return new;
  end if;
  update worker_profiles set status = v_to where id = v_profile and status is distinct from v_to;
  return new;
end $$;
