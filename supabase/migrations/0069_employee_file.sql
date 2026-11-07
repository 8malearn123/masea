-- =============================================================
-- Masiat Alsharq ERP — 0069 Employee file (المرحلة ج)
-- يُبنى فوق employees + employee_details (0004/0021) و hr_in_scope (0068):
--   1) إنهاء الخدمة: تاريخ + سبب + ملاحظة (أساس مكافأة نهاية الخدمة لاحقاً)،
--      ومسار تصحيح (إعادة تفعيل) — لا حذف نهائي.
--   2) رقم وظيفي تلقائي EMP-xxxx، وحساب دخول واحد لكل موظف.
--   3) قيود صحة سعودية: الهوية/الإقامة (10 أرقام تبدأ 1 أو 2)، الآيبان SA+22.
--      NOT VALID: تُفرض على الجديد ولا تُسقط الترحيل إن وُجدت بيانات قديمة.
--   4) مدير الفرع (hr.edit) يدير البيانات غير المالية لموظفي فرعه؛ المالية
--      (آيبان/بنك/بدلات/تأمينات) تبقى لـ hr.manage — نفس مبدأ guard_employee_pay.
--   5) نسب البدلات الافتراضية (سكن/نقل) في payroll_config — تُدار من الإعدادات.
-- =============================================================

-- ---------- 1) termination fields ------------------------------------------
alter table employees
  add column if not exists termination_date   date,
  add column if not exists termination_reason text,
  add column if not exists termination_note   text;

alter table employees drop constraint if exists employees_termination_reason_chk;
alter table employees add constraint employees_termination_reason_chk check (
  termination_reason is null or termination_reason in
    ('resignation','employer_termination','contract_end','article_80','retirement','death','other'));

-- ---------- 2) employee number + one account per employee -----------------
create sequence if not exists employee_no_seq start 1001;
select setval('employee_no_seq', greatest(1000, coalesce(
  (select max(substring(employee_no from '^EMP-([0-9]+)$')::int) from employees), 1000)));

create or replace function set_employee_no() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.employee_no is null or new.employee_no = '' then
    new.employee_no := 'EMP-' || nextval('employee_no_seq');
  end if;
  return new;
end $$;
drop trigger if exists trg_set_employee_no on employees;
create trigger trg_set_employee_no before insert on employees
  for each row execute function set_employee_no();

create unique index if not exists ux_employees_no   on employees(employee_no) where employee_no is not null;
create unique index if not exists ux_employees_user on employees(user_id)     where user_id is not null;

-- ---------- 3) Saudi validity rules -----------------------------------------
alter table employees drop constraint if exists employees_national_id_chk;
alter table employees add constraint employees_national_id_chk
  check (national_id is null or national_id ~ '^[12][0-9]{9}$') not valid;

alter table employee_details drop constraint if exists employee_details_iban_chk;
alter table employee_details add constraint employee_details_iban_chk
  check (iban is null or iban ~ '^SA[0-9]{22}$') not valid;
alter table employee_details drop constraint if exists employee_details_iqama_chk;
alter table employee_details add constraint employee_details_iqama_chk
  check (iqama_no is null or iqama_no ~ '^2[0-9]{9}$') not valid;

-- ---------- 4) non-financial details for hr.edit (branch manager) ----------
create or replace function guard_employee_details_pay() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or has_perm('hr','manage') then return new; end if;
  if tg_op = 'INSERT' then
    if new.iban is not null or new.bank_name is not null
       or coalesce(new.housing_allowance,0) <> 0 or coalesce(new.other_allowance,0) <> 0
       or new.gosi_reg_date is not null or new.gosi_subscription_no is not null then
      raise exception 'البيانات المالية من صلاحية الموارد البشرية' using errcode = '42501';
    end if;
  elsif new.iban is distinct from old.iban or new.bank_name is distinct from old.bank_name
     or new.housing_allowance is distinct from old.housing_allowance
     or new.other_allowance is distinct from old.other_allowance
     or new.gosi_system is distinct from old.gosi_system
     or new.gosi_reg_date is distinct from old.gosi_reg_date
     or new.gosi_subscription_no is distinct from old.gosi_subscription_no
     or new.employment_status is distinct from old.employment_status then
    raise exception 'البيانات المالية وحالة التوظيف من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_details_pay on employee_details;
create trigger trg_guard_details_pay before insert or update on employee_details
  for each row execute function guard_employee_details_pay();

drop policy if exists emp_details_edit on employee_details;
create policy emp_details_edit on employee_details for all to authenticated
  using (has_perm('hr','edit') and hr_in_scope(employee_id))
  with check (has_perm('hr','edit') and hr_in_scope(employee_id));

-- ---------- 5) default allowance percentages (config, not code) -----------
alter table payroll_config
  add column if not exists default_housing_pct   numeric(5,2) not null default 25,
  add column if not exists default_transport_pct numeric(5,2) not null default 10;
alter table payroll_config drop constraint if exists payroll_config_bounds;
alter table payroll_config add constraint payroll_config_bounds check (
  standard_work_days between 20 and 31
  and daily_hours > 0 and daily_hours <= 12
  and overtime_multiplier >= 1 and overtime_multiplier <= 3
  and shift_start_hour >= 0 and shift_start_hour < 24
  and late_grace_minutes between 0 and 120
  and default_housing_pct between 0 and 100
  and default_transport_pct between 0 and 100
);

-- ---------- 6) terminate / reactivate (atomic, permission-checked) --------
create or replace function terminate_employee(
  p_employee_id uuid, p_date date, p_reason text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_hire date; v_active boolean;
begin
  if not (has_perm('hr','manage') and hr_in_scope(p_employee_id)) then
    raise exception 'إنهاء الخدمة من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  select hire_date, is_active into v_hire, v_active from employees where id = p_employee_id;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if not v_active then raise exception 'الموظف منتهي الخدمة بالفعل'; end if;
  if p_date is null then raise exception 'تاريخ إنهاء الخدمة مطلوب'; end if;
  if v_hire is not null and p_date < v_hire then
    raise exception 'تاريخ إنهاء الخدمة قبل تاريخ التعيين';
  end if;
  if p_reason is null then raise exception 'سبب إنهاء الخدمة مطلوب'; end if;

  update employees
     set is_active = false, termination_date = p_date,
         termination_reason = p_reason, termination_note = nullif(p_note, '')
   where id = p_employee_id;
  insert into employee_details (employee_id, employment_status)
  values (p_employee_id, 'terminated')
  on conflict (employee_id) do update set employment_status = 'terminated', updated_at = now();
end $$;

-- correction path: a termination recorded by mistake is reversed, never deleted
create or replace function reactivate_employee(p_employee_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('hr','manage') and hr_in_scope(p_employee_id)) then
    raise exception 'إعادة التفعيل من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  update employees
     set is_active = true, termination_date = null, termination_reason = null, termination_note = null
   where id = p_employee_id and not is_active;
  if not found then raise exception 'الموظف على رأس العمل'; end if;
  update employee_details set employment_status = 'active', updated_at = now()
   where employee_id = p_employee_id;
end $$;

grant execute on function terminate_employee(uuid, date, text, text), reactivate_employee(uuid)
  to authenticated;

-- ---------- 7) account linking + display names (user_profiles is GM-only) ---
-- HR links an employee to an existing login account (accounts are created by
-- the GM in «الصلاحيات»). Returns only what the picker needs.
create or replace function hr_account_options()
returns table (id uuid, full_name text, role text, branch text, linked_employee uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('hr','manage') then
    raise exception 'ربط الحسابات من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  return query
    select u.id, u.full_name, u.role::text, b.city, e.id
      from user_profiles u
      left join branches b on b.id = u.branch_id
      left join employees e on e.user_id = u.id
     order by u.full_name;
end $$;

-- names of the people who submitted/decided HR requests (no other profile data)
create or replace function user_display_names(p_ids uuid[])
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name from user_profiles u
   where u.id = any(p_ids) and has_perm('hr','view')
$$;

grant execute on function hr_account_options(), user_display_names(uuid[]) to authenticated;
