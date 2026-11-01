-- =============================================================
-- Masiat Alsharq ERP — 0061 Branch-based access hardening + audit trail
-- المرحلة 0 من خطة تطوير المبيعات والعملاء: أساس الصلاحيات قبل أي وحدة جديدة.
-- يُبنى فوق get_my_branch / is_cross_branch / has_perm (0013) وسياسات الفروع
-- (0036) — لا جداول جديدة لمفاهيم قائمة، لا حذف بيانات.
-- التراجع: supabase/rollback/0061_branch_access_and_audit_down.sql
--
--  1. in_my_branch(): السجل بلا فرع لا يراه إلا الأدوار العابرة للفروع. كانت
--     السياسات تسمح بـ «branch_id is null» فيرى كل مدير فرع سجلات الفروع الأخرى
--     التي لم يُحدَّد فرعها (العملاء، العقود، الطلبات، العمالة، السائقون…).
--  2. الجداول التابعة (المدفوعات، الغرامات، المسح، الولاء…) كانت «with check
--     (true)» فيمكن الكتابة على سجل فرع آخر — الآن نفس شرط القراءة.
--  3. جداول قابلة للكتابة لأي مستخدم مسجّل (campaigns / rewards / faq_items)
--     صارت مشروطة بالصلاحية. سجل التدقيق لم يعد قابلاً للتزوير من الواجهة.
--  4. فرع افتراضي عند الإدراج: موظف الفرع يكتب في فرعه تلقائيًا، وطلب الموقع
--     يُوجَّه لفرع مدينة العميل؛ ثم تعبئة الفرع للسجلات القائمة من مصدرها.
--  5. وحدات صلاحيات جديدة: customers (CRM) · sales_ops (المبيعات) · audit
--     (سجل التدقيق) + leads.approve (اعتماد عروض الأسعار في المرحلة 1).
--  6. سجل تدقيق تلقائي (audit_row_change) على العقود والعروض والمبيعات
--     والخصومات والحملات والصلاحيات والمستخدمين والمدفوعات والعملاء.
-- =============================================================

-- ---------- 1) the strict branch predicate ----------------------------------
create or replace function in_my_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select is_cross_branch() or (p_branch is not null and p_branch = get_my_branch()) $$;

grant execute on function in_my_branch(uuid) to authenticated;

-- any of these modules lets a role read the customer directory of its branch
create or replace function can_view_customers()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from role_permissions rp
    where rp.role_code = get_my_role() and rp.action = 'view'
      and rp.module in ('customers','contracts','leads','call_center','loyalty',
                        'payments','accounting','orders','sales_ops')
  )
$$;

grant execute on function can_view_customers() to authenticated;

-- ---------- 2) branch-owned tables: no more "branch_id is null" leak ----------
do $$
declare t text;
begin
  foreach t in array array['workers','drivers','employees','targets','housing_dorms']
  loop
    execute format('drop policy if exists %1$s_b_read on %1$s', t);
    execute format('drop policy if exists %1$s_b_write on %1$s', t);
    execute format($f$
      create policy %1$s_b_read on %1$s for select to authenticated
        using (in_my_branch(branch_id));
      create policy %1$s_b_write on %1$s for all to authenticated
        using (in_my_branch(branch_id))
        with check (in_my_branch(branch_id));
    $f$, t);
  end loop;
end $$;

-- customers: branch scope + the new `customers` module for writes
drop policy if exists customers_b_read on customers;
drop policy if exists customers_b_write on customers;
create policy customers_read on customers for select to authenticated
  using (can_view_customers() and in_my_branch(branch_id));
create policy customers_insert on customers for insert to authenticated
  with check (has_perm('customers','create') and in_my_branch(branch_id));
create policy customers_update on customers for update to authenticated
  using (has_perm('customers','edit') and in_my_branch(branch_id))
  with check (has_perm('customers','edit') and in_my_branch(branch_id));
create policy customers_delete on customers for delete to authenticated
  using (has_perm('customers','delete') and in_my_branch(branch_id));

-- contracts (+ the recruitment children that inherit its scope)
drop policy if exists contracts_read on contracts;
create policy contracts_read on contracts for select to authenticated
  using (
    has_perm('contracts','view') and (
      is_cross_branch()
      or assigned_office_id = auth.uid()
      or (get_my_role() <> 'external_office' and in_my_branch(branch_id))
    )
  );
drop policy if exists contracts_insert on contracts;
create policy contracts_insert on contracts for insert to authenticated
  with check (has_perm('contracts','create') and in_my_branch(branch_id));
drop policy if exists contracts_update_draft on contracts;
create policy contracts_update_draft on contracts for update to authenticated
  using (has_perm('contracts','edit') and status = 'draft' and in_my_branch(branch_id))
  with check (status = 'draft' and in_my_branch(branch_id));
drop policy if exists contracts_delete_draft on contracts;
create policy contracts_delete_draft on contracts for delete to authenticated
  using (has_perm('contracts','delete') and status = 'draft' and in_my_branch(branch_id));

drop policy if exists rf_read on recruitment_followups;
create policy rf_read on recruitment_followups for select to authenticated using (
  exists (select 1 from contracts c where c.id = recruitment_followups.contract_id and (
    is_cross_branch() or c.assigned_office_id = auth.uid()
    or (get_my_role() <> 'external_office' and in_my_branch(c.branch_id))))
);
drop policy if exists rdoc_read on recruitment_documents;
create policy rdoc_read on recruitment_documents for select to authenticated using (
  exists (select 1 from contracts c where c.id = recruitment_documents.contract_id and (
    is_cross_branch() or c.assigned_office_id = auth.uid()
    or (get_my_role() <> 'external_office' and in_my_branch(c.branch_id))))
);

-- service requests (orders): strict read, and an update can't move it to another branch
drop policy if exists sr_orders_read on service_requests;
create policy sr_orders_read on service_requests for select to authenticated
  using (has_perm('orders','view') and in_my_branch(branch_id));
drop policy if exists sr_orders_update on service_requests;
create policy sr_orders_update on service_requests for update to authenticated
  using (has_perm('orders','edit') and in_my_branch(branch_id))
  with check (in_my_branch(branch_id));

drop policy if exists drivers_orders_read on drivers;

-- ---------- 3) child tables: read AND write through the parent's branch -------
drop policy if exists payments_b on payments;
create policy payments_b on payments for all to authenticated
  using (is_cross_branch() or exists (
    select 1 from contracts c where c.id = payments.contract_id and in_my_branch(c.branch_id)))
  with check (is_cross_branch() or exists (
    select 1 from contracts c where c.id = payments.contract_id and in_my_branch(c.branch_id)));

do $$
declare r record;
begin
  for r in select * from (values
    ('absence_reports',      'absence_b', 'contracts',     'contract_id'),
    ('penalties',            'penalties_b','contracts',    'contract_id'),
    ('loyalty_transactions', 'loyalty_b', 'customers',     'customer_id'),
    ('abandoned_carts',      'carts_b',   'customers',     'customer_id'),
    ('housing_attendance',   'hattend_b', 'housing_dorms', 'dorm_id'),
    ('target_progress',      'tprog_b',   'targets',       'target_id')
  ) as v(child, pol, parent, fk)
  loop
    execute format('drop policy if exists %I on %I', r.pol, r.child);
    execute format($f$
      create policy %1$I on %2$I for all to authenticated
        using (is_cross_branch() or exists (
          select 1 from %3$I p where p.id = %2$I.%4$I and in_my_branch(p.branch_id)))
        with check (is_cross_branch() or exists (
          select 1 from %3$I p where p.id = %2$I.%4$I and in_my_branch(p.branch_id)));
    $f$, r.pol, r.child, r.parent, r.fk);
  end loop;
end $$;

drop policy if exists scans_b on scans_log;
create policy scans_b on scans_log for all to authenticated
  using (is_cross_branch()
    or exists (select 1 from contracts c where c.id = scans_log.contract_id and in_my_branch(c.branch_id))
    or exists (select 1 from workers w where w.id = scans_log.worker_id and in_my_branch(w.branch_id)))
  with check (is_cross_branch()
    or exists (select 1 from contracts c where c.id = scans_log.contract_id and in_my_branch(c.branch_id))
    or exists (select 1 from workers w where w.id = scans_log.worker_id and in_my_branch(w.branch_id)));

drop policy if exists payruns_read on payroll_runs;
create policy payruns_read on payroll_runs for select to authenticated
  using (has_perm('hr','view') and in_my_branch(branch_id));

drop policy if exists htarget_read on housing_targets;
create policy htarget_read on housing_targets for select to authenticated
  using (supervisor_id = auth.uid() or (has_perm('housing','view') and in_my_branch(branch_id)));

-- ---------- 4) tables any signed-in user could write --------------------------
drop policy if exists campaigns_write on campaigns;
create policy campaigns_write on campaigns for all to authenticated
  using (has_perm('loyalty','manage')) with check (has_perm('loyalty','manage'));
drop policy if exists rewards_write on rewards;
create policy rewards_write on rewards for all to authenticated
  using (has_perm('targets','edit')) with check (has_perm('targets','edit'));
drop policy if exists faq_items_write on faq_items;
create policy faq_items_write on faq_items for all to authenticated
  using (has_perm('settings','manage')) with check (has_perm('settings','manage'));

-- ---------- 5) default branch on insert + backfill from the source -----------
create or replace function set_default_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null and not is_cross_branch() then
    new.branch_id := get_my_branch();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers','contracts','service_requests','leads','quotes',
                           'workers','drivers','targets','housing_dorms']
  loop
    execute format('drop trigger if exists trg_default_branch on %I', t);
    execute format('create trigger trg_default_branch before insert on %I
                    for each row execute function set_default_branch()', t);
  end loop;
end $$;

-- a website / call-center order without a branch goes to the branch of the customer's city
create or replace function route_request_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    new.branch_id := coalesce(
      resolve_branch_id(nullif(new.details->>'branch', '')),
      resolve_branch_id(nullif(new.customer_city, '')));
  end if;
  return new;
end $$;
drop trigger if exists trg_route_request_branch on service_requests;
create trigger trg_route_request_branch before insert on service_requests
  for each row execute function route_request_branch();

-- backfill: only rows without a branch, only from a reliable source
update service_requests r
   set branch_id = coalesce(resolve_branch_id(nullif(r.details->>'branch', '')),
                            resolve_branch_id(nullif(r.customer_city, '')))
 where r.branch_id is null;
update contracts c set branch_id = cu.branch_id
  from customers cu
 where c.branch_id is null and cu.id = c.customer_id and cu.branch_id is not null;
update customers cu set branch_id = coalesce(
    (select c.branch_id from contracts c where c.customer_id = cu.id and c.branch_id is not null
      order by c.created_at desc limit 1),
    (select r.branch_id from service_requests r where r.customer_id = cu.id and r.branch_id is not null
      order by r.created_at desc limit 1),
    resolve_branch_id(nullif(cu.city, '')))
 where cu.branch_id is null;
update workers w set branch_id = (
    select c.branch_id from contracts c where c.worker_id = w.id and c.branch_id is not null
     order by c.created_at desc limit 1)
 where w.branch_id is null;

-- ---------- 6) permission modules -------------------------------------------
insert into permissions (module, action, label)
select m.module, a.code, a.name_ar || ' ' || m.label_ar
from (values ('customers','العملاء'), ('sales_ops','المبيعات'), ('audit','سجل التدقيق')) as m(module, label_ar)
cross join (values ('view','عرض'),('create','إنشاء'),('edit','تعديل'),('delete','حذف'),
                   ('approve','اعتماد'),('export','تصدير')) as a(code, name_ar)
where (m.module, a.code) not in (('audit','create'),('audit','edit'),('audit','delete'),('audit','approve'),
                                 ('sales_ops','create'),('sales_ops','delete'))
  and not exists (select 1 from permissions p where p.module = m.module and p.action = a.code);

insert into permissions (module, action, label)
select 'leads', 'approve', 'اعتماد عروض الأسعار'
where not exists (select 1 from permissions where module = 'leads' and action = 'approve');

insert into role_permissions (role_code, module, action)
select g.role_code, g.module, act
from (values
  ('admin',              'customers', array['view','create','edit','delete','approve','export']),
  ('operations_manager', 'customers', array['view','create','edit','delete','approve','export']),
  ('branch_manager',     'customers', array['view','create','edit','delete','approve','export']),
  ('sales',              'customers', array['view','create','edit']),
  ('call_center',        'customers', array['view','create']),
  ('accountant',         'customers', array['view','export']),
  ('admin',              'sales_ops', array['view','edit','approve','export']),
  ('operations_manager', 'sales_ops', array['view','edit','approve','export']),
  ('branch_manager',     'sales_ops', array['view','edit','approve','export']),
  ('sales',              'sales_ops', array['view']),
  ('accountant',         'sales_ops', array['view','export']),
  ('admin',              'audit',     array['view','export']),
  ('operations_manager', 'audit',     array['view','export']),
  ('branch_manager',     'audit',     array['view']),
  ('admin',              'leads',     array['approve']),
  ('operations_manager', 'leads',     array['approve']),
  ('branch_manager',     'leads',     array['approve']),
  ('sales',              'leads',     array['approve'])
) as g(role_code, module, acts)
cross join lateral unnest(g.acts) as act
on conflict do nothing;

-- the driver app has no honor board (documented in lib/permissions.ts)
delete from role_permissions where role_code = 'driver' and module = 'targets';

-- ---------- 7) audit trail ----------------------------------------------------
alter table audit_log add column if not exists branch_id  uuid references branches(id) on delete set null;
alter table audit_log add column if not exists actor_name text;
create index if not exists idx_audit_log_created on audit_log(created_at desc);
create index if not exists idx_audit_log_record on audit_log(table_name, record_id);

-- append-only: written by triggers / SECURITY DEFINER functions only
drop policy if exists audit_insert on audit_log;
drop policy if exists audit_admin_read on audit_log;
create policy audit_read on audit_log for select to authenticated
  using (is_admin() or (has_perm('audit','view') and in_my_branch(branch_id)));

create or replace function audit_log_immutable() returns trigger
language plpgsql as $$ begin raise exception 'سجل التدقيق غير قابل للتعديل أو الحذف'; end; $$;
drop trigger if exists trg_audit_log_immutable on audit_log;
create trigger trg_audit_log_immutable before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- stamp who did it and which branch the row belongs to (also for explicit inserts)
create or replace function audit_log_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := coalesce(new.user_id, auth.uid());
  new.actor_name := coalesce(new.actor_name, (select full_name from user_profiles where id = new.user_id));
  if new.branch_id is null then
    new.branch_id := coalesce(
      nullif(coalesce(new.new_data, new.old_data)->>'branch_id', '')::uuid,
      case when new.table_name = 'contracts' then (select branch_id from contracts where id = new.record_id) end);
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_log_stamp on audit_log;
create trigger trg_audit_log_stamp before insert on audit_log
  for each row execute function audit_log_stamp();

-- one generic row-change logger; an update stores only the fields that changed
create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_id  text  := v_row->>'id';
  v_chg jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into v_chg
      from jsonb_each(v_new) n
     where n.key not in ('updated_at') and (v_old->n.key) is distinct from n.value;
    if v_chg = '{}'::jsonb then return new; end if;  -- touch without a real change
    v_old := (select jsonb_object_agg(key, v_old->key) from jsonb_object_keys(v_chg) key);
    v_new := v_chg;
  end if;

  insert into audit_log (action, table_name, entity, record_id, old_data, new_data, branch_id, details)
  values (lower(tg_op), tg_table_name, tg_table_name,
          case when v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then v_id::uuid end,
          v_old, v_new,
          nullif(v_row->>'branch_id', '')::uuid,
          case when v_id is null or v_id !~* '^[0-9a-f-]{36}$'
               then jsonb_build_object('key', coalesce(v_row->>'key', v_row->>'code', v_id,
                    concat_ws('.', v_row->>'role_code', v_row->>'module', v_row->>'action'))) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['contracts','quotes','promotions','campaigns','payments','customers',
                           'leads','role_permissions','roles','user_profiles','pricing_rules',
                           'app_config','service_requests']
  loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;
