-- =============================================================
-- Masiat Alsharq ERP — 0017 Contracts seed (templates + samples)
-- =============================================================

-- ---------- clause templates (one per service type) ----------
insert into contract_templates (service_code, name, clauses) values
  ('recruitment', 'قالب عقد الاستقدام',
    '["يلتزم الطرف الأول (ماسية الشرق للاستقدام) باستقدام عاملة من جنسية {{nationality}} لمهنة {{profession}} لصالح الطرف الثاني {{customer_name}}.",
      "مدة العقد {{duration}} شهرًا تبدأ من تاريخ {{start_date}}.",
      "إجمالي رسوم الاستقدام {{total}} ريال سعودي شاملة ضريبة القيمة المضافة (15%).",
      "يلتزم الطرف الثاني بسداد الرسوم وفق الجدول المتفق عليه.",
      "يخضع هذا العقد لأنظمة وزارة الموارد البشرية والتنمية الاجتماعية ومنصة مساند."]'::jsonb),
  ('monthly_rental', 'قالب عقد التأجير الشهري',
    '["يؤجّر الطرف الأول للطرف الثاني {{customer_name}} خدمات عاملة منزلية بعقد شهري.",
      "قيمة الإيجار الشهري {{monthly}} ريال، ومدة العقد {{duration}} أشهر تبدأ من {{start_date}}.",
      "الإجمالي {{total}} ريال شامل ضريبة القيمة المضافة (15%).",
      "يجدد العقد تلقائيًا ما لم يُشعر أحد الطرفين بخلاف ذلك قبل انتهائه بأسبوع."]'::jsonb),
  ('daily_rental', 'قالب عقد التأجير اليومي',
    '["يقدّم الطرف الأول للطرف الثاني {{customer_name}} خدمة منزلية ({{task}}) ليوم/أيام محددة.",
      "عدد الأيام {{days}} ابتداءً من {{start_date}} بقيمة إجمالية {{total}} ريال شاملة الضريبة (15%).",
      "يلتزم الطرف الأول بتوفير عاملة مؤهلة وفق طبيعة المهمة."]'::jsonb),
  ('sponsorship_transfer', 'قالب عقد نقل الكفالة',
    '["ينظّم هذا العقد نقل كفالة العاملة لصالح الطرف الثاني {{customer_name}}.",
      "رسوم النقل {{total}} ريال شاملة ضريبة القيمة المضافة (15%).",
      "تتم الإجراءات عبر منصتي مساند وأبشر وفق الأنظمة المعمول بها.",
      "يلتزم الطرفان بإكمال المتطلبات النظامية خلال المدة المحددة."]'::jsonb)
on conflict do nothing;

-- ---------- sample contracts in different states ----------
do $$
declare
  v_cust   uuid;
  v_branch uuid;
  v_tmpl   uuid;
  v_id     uuid;
begin
  select id into v_cust from customers limit 1;
  select id into v_branch from branches where name = 'نجران' limit 1;
  if v_cust is null or v_branch is null then
    raise notice 'skipping sample contracts — seed customers/branches first';
    return;
  end if;
  select id into v_tmpl from contract_templates where service_code = 'recruitment' limit 1;

  -- draft
  insert into contracts (contract_no, service_code, service_type, template_id, customer_id, branch_id, start_date, base_amount, status)
    values (generate_contract_no(2026), 'recruitment', 'kafala', v_tmpl, v_cust, v_branch, '2026-02-01', 16000, 'draft');

  -- pending_approval
  insert into contracts (contract_no, service_code, service_type, template_id, customer_id, branch_id, start_date, base_amount, status)
    values (generate_contract_no(2026), 'monthly_rental', 'monthly', v_tmpl, v_cust, v_branch, '2026-02-05', 7500, 'pending_approval');

  -- approved
  insert into contracts (contract_no, service_code, service_type, template_id, customer_id, branch_id, start_date, base_amount, status)
    values (generate_contract_no(2026), 'daily_rental', 'daily', v_tmpl, v_cust, v_branch, '2026-02-10', 540, 'approved');

  -- signed + active (set signed_at)
  insert into contracts (contract_no, service_code, service_type, template_id, customer_id, branch_id, start_date, base_amount, status, signed_at)
    values (generate_contract_no(2026), 'recruitment', 'kafala', v_tmpl, v_cust, v_branch, '2026-01-10', 14000, 'active', now())
    returning id into v_id;

  insert into contract_clauses (contract_id, sort_order, body) values
    (v_id, 0, 'يلتزم الطرف الأول باستقدام عاملة لصالح الطرف الثاني وفق الأنظمة.'),
    (v_id, 1, 'إجمالي القيمة 16100 ريال شامل ضريبة القيمة المضافة (15%).');

  insert into contract_status_history (contract_id, from_status, to_status) values
    (v_id, 'awaiting_signature', 'signed'),
    (v_id, 'signed', 'active');
end $$;
