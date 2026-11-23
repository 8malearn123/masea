-- =============================================================
-- 0094 — توحيد عقود التأجير على قالب واحد + تعطيل وحدة البريد المؤسسي
-- (docs/plans/contracts-unification-plan.md)
--
--   1) قالب «عقد تأجير خدمات عمالية» المعتمد هو مصدر نص كل عقود التأجير
--      (شهري، يومي، بالساعة): أي مسودة تأجير تُنشأ بلا قالب تُربط تلقائياً بأحدث
--      نسخة معتمدة منه (trigger) فتُثبَّت نسختها وبصمتها (0087). لا نسخ للنص.
--      إن لم توجد نسخة معتمدة يبقى العقد بلا قالب (الواجهة تمنع إنشاء التأجير
--      حتى الاعتماد) — الاعتماد فعلٌ مسجَّل باسم المعتمِد من «مراجعة القالب».
--   2) القوالب القديمة المختصرة للتأجير (0046/0065) تُوقف للعقود الجديدة فقط
--      (is_active = false) — العقود السابقة تبقى ببنودها المحفوظة كما هي.
--   3) وحدة «البريد المؤسسي» (0093): تعطيل الوصول فقط — حذف صلاحيات it_admin
--      وسحب تنفيذ دوالها. الجداول وبياناتها تبقى دون حذف حتى قرار لاحق.
--      لا مساس بـ outbound_messages (إشعارات العملاء) ولا بأي بريد آخر.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) one rental template for every rental service --------------------
create or replace function approved_rental_template(p_service text) returns uuid
language sql stable as $$
  select id from contract_templates
   where template_code = 'rental_labor_services' and status = 'approved'
   order by (service_code = p_service) desc, version desc
   limit 1
$$;

create or replace function contracts_default_rental_template() returns trigger
language plpgsql as $$
begin
  if new.template_id is null and new.status = 'draft'
     and new.service_code in ('monthly_rental','daily_rental','hourly_rental') then
    new.template_id := approved_rental_template(new.service_code);
  end if;
  return new;
end $$;
-- the name sorts before trg_contracts_pin_template → the pin sees the template
drop trigger if exists trg_contracts_aa_default_rental_template on contracts;
create trigger trg_contracts_aa_default_rental_template before insert on contracts
  for each row execute function contracts_default_rental_template();

-- ---------- 2) legacy short rental templates: retired for NEW contracts --------
update contract_templates set is_active = false
 where template_code is null
   and service_code in ('monthly_rental','daily_rental','hourly_rental')
   and is_active;

-- ---------- 3) corporate e-mail module: access disabled (data kept) ------------
delete from role_permissions where module = 'it_admin';
delete from permissions where module = 'it_admin';
do $$
declare f text;
begin
  foreach f in array array['update_mail_ownership(jsonb)',
                           'submit_account_request(text, uuid, text, jsonb, text)',
                           'decide_account_request(uuid, boolean, text)',
                           'execute_account_request(uuid, text)',
                           'cancel_account_request(uuid)'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;
comment on table it_mail_accounts is
  'مُعطّل (0094): وحدة البريد المؤسسي أُزيلت من النظام — البيانات محفوظة بانتظار قرار الحذف النهائي.';
