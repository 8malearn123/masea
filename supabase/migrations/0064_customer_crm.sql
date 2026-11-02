-- =============================================================
-- Masiat Alsharq ERP — 0064 Customers CRM (المرحلة 3)
-- يُبنى فوق customers / contracts / payments / lead_activities — لا جداول جديدة:
--   • customers.is_active: الحذف = تعطيل (soft delete).
--   • lead_activities يصبح سجل التواصل الموحّد: يُربط بعميل محتمل أو بعميل
--     (customer_id)، فتاريخ آخر تواصل والملاحظات الداخلية من مصدر واحد.
--   • customer_insights (view, security_invoker): مؤشرات كل عميل محسوبة من
--     العمليات الفعلية (العقود المبيعة، المدفوعات، العقود السارية، التواصل) —
--     تخضع لـ RLS الجداول الأصلية فيرى مدير الفرع عملاء فرعه فقط.
--   • عتبات التصنيف (جديد/خامل/متابعة/عودة متوقعة) في app_config تُدار من الإعدادات.
-- التراجع: supabase/rollback/0064_customer_crm_down.sql
-- =============================================================

alter table customers add column if not exists is_active boolean not null default true;

-- ---------- unified contact log -------------------------------------------------
alter table lead_activities alter column lead_id drop not null;
alter table lead_activities add column if not exists customer_id uuid references customers(id) on delete cascade;
alter table lead_activities drop constraint if exists lead_activities_parent_chk;
alter table lead_activities add constraint lead_activities_parent_chk
  check (lead_id is not null or customer_id is not null);
create index if not exists idx_lead_act_customer on lead_activities(customer_id, created_at desc);

drop policy if exists lact_read on lead_activities;
create policy lact_read on lead_activities for select to authenticated using (
  (lead_id is not null and exists (select 1 from leads l where l.id = lead_activities.lead_id
     and can_act_on_sales_row(l.branch_id, l.assigned_to)))
  or (customer_id is not null and can_view_customers() and exists (
        select 1 from customers c where c.id = lead_activities.customer_id and in_my_branch(c.branch_id)))
);
drop policy if exists lact_write on lead_activities;
create policy lact_write on lead_activities for all to authenticated using (
  (lead_id is not null and has_perm('leads','edit') and exists (select 1 from leads l where l.id = lead_activities.lead_id
     and can_act_on_sales_row(l.branch_id, l.assigned_to)))
  or (customer_id is not null and has_perm('customers','edit') and exists (
        select 1 from customers c where c.id = lead_activities.customer_id and in_my_branch(c.branch_id)))
) with check (
  created_by = auth.uid() and (
    (lead_id is not null and exists (select 1 from leads l where l.id = lead_activities.lead_id
       and can_act_on_sales_row(l.branch_id, l.assigned_to)))
    or (customer_id is not null and has_perm('customers','edit') and exists (
          select 1 from customers c where c.id = lead_activities.customer_id and in_my_branch(c.branch_id))))
);
alter table lead_activities alter column created_by set default auth.uid();

-- ---------- managed thresholds ----------------------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('crm_new_customer_days',  'العميل «جديد» خلال',                         'العملاء', 30, 'يوم', 1),
  ('crm_inactive_days',      'العميل «خامل» إذا لم يشترِ منذ',             'العملاء', 90, 'يوم', 2),
  ('crm_followup_days',      'يحتاج متابعة تسويقية إذا لم نتواصل معه منذ', 'العملاء', 45, 'يوم', 3),
  ('crm_return_window_days', 'عودة متوقعة: ينتهي عقده الساري خلال',        'العملاء', 30, 'يوم', 4)
on conflict (key) do nothing;

-- ---------- per-customer insights from real operations ---------------------------
create or replace view customer_insights with (security_invoker = true) as
with ct as (
  select c.customer_id,
         count(*)                                                        as contracts_count,
         count(*) filter (where contract_is_sold(c.status::text))       as purchases,
         min(coalesce(c.signed_at, c.created_at)) filter (where contract_is_sold(c.status::text)) as first_purchase_at,
         max(coalesce(c.signed_at, c.created_at)) filter (where contract_is_sold(c.status::text)) as last_purchase_at,
         coalesce(sum(c.base_amount) filter (where contract_is_sold(c.status::text)), 0) as sales_value,
         count(*) filter (where c.status::text in ('signed','active','musaned_signed')
                           and (c.end_date is null or c.end_date >= current_date))       as active_contracts,
         min(c.end_date) filter (where c.status::text in ('signed','active','musaned_signed')
                                  and c.end_date >= current_date)                       as next_end_date,
         max(c.end_date) filter (where contract_is_sold(c.status::text))               as last_end_date
    from contracts c
   group by c.customer_id
), pay as (
  select c.customer_id, coalesce(sum(p.amount), 0) as total_paid
    from payments p join contracts c on c.id = p.contract_id
   group by c.customer_id
), act as (
  select coalesce(a.customer_id, l.customer_id) as customer_id, max(a.created_at) as last_contact_at
    from lead_activities a left join leads l on l.id = a.lead_id
   where coalesce(a.customer_id, l.customer_id) is not null
   group by 1
)
select cu.id, cu.full_name, cu.phone, cu.city, cu.branch_id, cu.created_at, cu.is_active, cu.segment,
       coalesce(ct.contracts_count, 0)  as contracts_count,
       coalesce(ct.purchases, 0)        as purchases,
       ct.first_purchase_at, ct.last_purchase_at,
       coalesce(ct.sales_value, 0)      as sales_value,
       coalesce(pay.total_paid, 0)      as total_paid,
       coalesce(ct.active_contracts, 0) as active_contracts,
       ct.next_end_date, ct.last_end_date,
       act.last_contact_at,
       (current_date - ct.last_purchase_at::date) as days_since_purchase,
       (current_date - act.last_contact_at::date) as days_since_contact
  from customers cu
  left join ct  on ct.customer_id  = cu.id
  left join pay on pay.customer_id = cu.id
  left join act on act.customer_id = cu.id;

grant select on customer_insights to authenticated;
