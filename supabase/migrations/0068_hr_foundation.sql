-- =============================================================
-- Masiat Alsharq ERP — 0068 HR foundation (المرحلة أ)
-- واجهة الموارد البشرية تقرأ وتكتب الآن في الجداول القائمة (0004/0021/0022)
-- بدل البيانات الثابتة. هذا الملف يكمّل ما ينقصها فقط — لا جداول مكررة:
--   1) أعمدة ناقصة: employees.job_title · employee_documents.doc_number ·
--      worker_profiles (جواز/إقامة/فرع/مهارات) — شاشة العاملات في HR صارت
--      تدير نفس ملف العاملة الذي يعرضه الكتالوج والعقود (لا قائمة موازية).
--   2) performance_reviews — الجدول الوحيد الجديد (لم يكن للتقييمات جدول).
--   3) سدّ ثغرات صلاحيات:
--      • employees / employee_details / attendance / leave_requests / shifts
--        كانت تُقرأ بشرط الفرع فقط ⇒ أي موظف (مبيعات مثلاً) يرى رواتب زملائه.
--        الآن: hr.view ضمن نطاق الفرع، أو الموظف لسجله هو.
--      • payroll_adjustments: أي مستخدم في الفرع كان يرفع تعديلاً لزميله.
--      • calculate_payslip(): security definer بلا تحقق ⇒ يحسب راتب أي موظف لأي مستخدم.
--   4) تدقيق كل تعديل عبر audit_row_change (0061).
-- مدير الفرع (المصفوفة القائمة 0036: hr view/create/edit/approve لفرعه): يرى موظفي
-- فرعه فقط ويعتمد إجازاتهم، ويرفع تعديلات الرواتب دون اعتمادها، ولا يغيّر الراتب مباشرة.
-- الحذف = تعطيل (is_active) — لا سياسة delete على الجداول المُدارة.
-- =============================================================

-- ---------- 1) missing columns -------------------------------------------
alter table employees          add column if not exists job_title  text;
alter table employee_documents add column if not exists doc_number text;

alter table worker_profiles
  add column if not exists passport_no text,
  add column if not exists iqama_no    text,
  add column if not exists branch_id   uuid references branches(id) on delete set null,
  add column if not exists skills      text[] not null default '{}';

-- ---------- 2) performance reviews ---------------------------------------
create table if not exists performance_reviews (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  period        text not null,                       -- «الربع الأول 2026»
  score         numeric(5,2) not null check (score between 0 and 100),
  reviewer_name text,
  review_date   date not null default current_date,
  is_active     boolean not null default true,       -- archive, never delete
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_perf_employee on performance_reviews(employee_id);
alter table performance_reviews enable row level security;

-- ---------- 3) scope helpers ---------------------------------------------
-- may the current user see this employee's HR records?
create or replace function hr_in_scope(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select has_perm('hr','view') and (is_cross_branch() or emp_in_my_branch(p_employee_id))
$$;
create or replace function hr_can_see(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select owns_employee(p_employee_id) or hr_in_scope(p_employee_id)
$$;
grant execute on function hr_in_scope(uuid), hr_can_see(uuid) to authenticated;

-- ---------- 4) employees -------------------------------------------------
drop policy if exists employees_b_read  on employees;
drop policy if exists employees_b_write on employees;
drop policy if exists employees_read    on employees;
drop policy if exists employees_insert  on employees;
drop policy if exists employees_update  on employees;
drop policy if exists employees_read on employees;
create policy employees_read on employees for select to authenticated
  using ((has_perm('hr','view') and in_my_branch(branch_id)) or user_id = auth.uid());
drop policy if exists employees_insert on employees;
create policy employees_insert on employees for insert to authenticated
  with check (has_perm('hr','create') and in_my_branch(branch_id));
drop policy if exists employees_update on employees;
create policy employees_update on employees for update to authenticated
  using (has_perm('hr','edit') and in_my_branch(branch_id))
  with check (has_perm('hr','edit') and in_my_branch(branch_id));

-- pay fields are money: only hr.manage (HR / GM) sets them. A branch manager
-- (hr.edit, own branch) manages the team but proposes pay changes through
-- payroll_adjustments — never edits the salary directly. Owner/service context
-- (migrations, seeds — no auth.uid()) is not restricted.
create or replace function guard_employee_pay() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or has_perm('hr','manage') then return new; end if;
  if (tg_op = 'INSERT' and (coalesce(new.basic_salary,0) <> 0 or coalesce(new.transport_allowance,0) <> 0))
     or (tg_op = 'UPDATE' and (new.basic_salary is distinct from old.basic_salary
                               or new.transport_allowance is distinct from old.transport_allowance)) then
    raise exception 'تعديل الراتب من صلاحية الموارد البشرية — ارفع طلب تعديل بدلاً من ذلك'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_employee_pay on employees;
create trigger trg_guard_employee_pay before insert or update on employees
  for each row execute function guard_employee_pay();

-- ---------- 5) employee profile children (reads were branch-wide) -------
drop policy if exists emp_details_read on employee_details;
create policy emp_details_read on employee_details for select to authenticated
  using (hr_can_see(employee_id));
drop policy if exists emp_docs_read on employee_documents;
create policy emp_docs_read on employee_documents for select to authenticated
  using (hr_can_see(employee_id));
drop policy if exists emp_emergency_read on employee_emergency_contacts;
create policy emp_emergency_read on employee_emergency_contacts for select to authenticated
  using (hr_can_see(employee_id));

-- ---------- 6) attendance / shifts / leave_requests ---------------------
drop policy if exists attendance_b on attendance;
drop policy if exists attendance_read on attendance;
create policy attendance_read on attendance for select to authenticated
  using (hr_can_see(employee_id));
drop policy if exists attendance_write on attendance;
create policy attendance_write on attendance for all to authenticated
  using (has_perm('hr','edit') and hr_in_scope(employee_id))
  with check (has_perm('hr','edit') and hr_in_scope(employee_id));

drop policy if exists shifts_b on shifts;
drop policy if exists shifts_read on shifts;
create policy shifts_read on shifts for select to authenticated
  using (hr_can_see(employee_id));
drop policy if exists shifts_write on shifts;
create policy shifts_write on shifts for all to authenticated
  using (has_perm('hr','edit') and hr_in_scope(employee_id))
  with check (has_perm('hr','edit') and hr_in_scope(employee_id));

drop policy if exists leave_requests_b on leave_requests;
drop policy if exists leave_read on leave_requests;
create policy leave_read on leave_requests for select to authenticated
  using (hr_can_see(employee_id));
-- anyone in scope (incl. branch manager, or the employee himself) may REQUEST;
-- only an approver may insert an already-approved leave (HR assigning leave).
drop policy if exists leave_request on leave_requests;
create policy leave_request on leave_requests for insert to authenticated
  with check (hr_can_see(employee_id) and (status = 'pending' or has_perm('hr','approve')));
drop policy if exists leave_decide on leave_requests;
create policy leave_decide on leave_requests for update to authenticated
  using (has_perm('hr','approve') and hr_in_scope(employee_id))
  with check (has_perm('hr','approve') and hr_in_scope(employee_id));

-- ---------- 7) payroll adjustments (submit needed no HR permission) -----
drop policy if exists payadj_read   on payroll_adjustments;
drop policy if exists payadj_submit on payroll_adjustments;
drop policy if exists payadj_read on payroll_adjustments;
create policy payadj_read on payroll_adjustments for select to authenticated
  using (hr_can_see(employee_id));
create policy payadj_submit on payroll_adjustments for insert to authenticated
  with check (hr_in_scope(employee_id) and status = 'pending');
-- payadj_decide (hr.manage) from 0022 stays.

-- ---------- 8) performance reviews --------------------------------------
drop policy if exists perf_read on performance_reviews;
create policy perf_read on performance_reviews for select to authenticated
  using (hr_can_see(employee_id));
drop policy if exists perf_write on performance_reviews;
create policy perf_write on performance_reviews for insert to authenticated
  with check (has_perm('hr','edit') and hr_in_scope(employee_id));
drop policy if exists perf_update on performance_reviews;
create policy perf_update on performance_reviews for update to authenticated
  using (has_perm('hr','edit') and hr_in_scope(employee_id))
  with check (has_perm('hr','edit') and hr_in_scope(employee_id));

-- ---------- 9) worker profiles: HR manages the same catalog record ------
drop policy if exists wp_hr_write on worker_profiles;
create policy wp_hr_write on worker_profiles for all to authenticated
  using (has_perm('hr','edit')) with check (has_perm('hr','edit'));

-- ---------- 10) audit every change --------------------------------------
do $$
declare t text;
begin
  foreach t in array array['employees','employee_details','employee_documents',
                           'employee_emergency_contacts','leave_requests',
                           'payroll_adjustments','performance_reviews','worker_profiles']
  loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- 11) calculate_payslip: same engine, now permission-checked --
create or replace function calculate_payslip(p_employee_id uuid, p_period text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg   payroll_config%rowtype;
  v_gosi  gosi_config%rowtype;
  v_emp   employees%rowtype;
  v_basic numeric := 0; v_transport numeric := 0; v_housing numeric := 0; v_other numeric := 0;
  v_saudi boolean; v_gosi_sys text := 'new'; v_counts boolean;
  v_start date; v_end date;
  v_absent integer := 0; v_late_min numeric := 0; v_ot_hours numeric := 0; v_present integer := 0;
  v_daily_wage numeric; v_hourly numeric;
  v_ot_amt numeric; v_absence_ded numeric; v_late_ded numeric;
  v_additions numeric := 0; v_manual numeric := 0;
  v_gosi_base numeric; v_gosi_rate numeric; v_gosi_emp numeric;
  v_gross numeric; v_ded numeric; v_net numeric;
begin
  if not hr_can_see(p_employee_id) then
    raise exception 'غير مصرّح بحساب راتب هذا الموظف' using errcode = '42501';
  end if;

  select * into v_cfg from payroll_config where id = 1;
  select * into v_gosi from gosi_config where id = 1;
  select * into v_emp from employees where id = p_employee_id;

  v_basic := coalesce(v_emp.basic_salary, 0);
  v_transport := coalesce(v_emp.transport_allowance, 0);
  v_saudi := (v_emp.nationality = 'السعودية');
  select coalesce(housing_allowance,0), coalesce(other_allowance,0), coalesce(gosi_system,'new'),
         coalesce(counts_in_saudization, v_saudi)
    into v_housing, v_other, v_gosi_sys, v_counts
  from employee_details where employee_id = p_employee_id;

  v_start := to_date(p_period || '-01', 'YYYY-MM-DD');
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;

  -- attendance-driven figures
  select
    count(*) filter (where status = 'present' or status = 'late'),
    count(*) filter (where status = 'absent'),
    coalesce(sum(case when check_in is not null and check_out is not null
                 then greatest(extract(epoch from (check_out - check_in))/3600.0 - v_cfg.daily_hours, 0) else 0 end), 0),
    coalesce(sum(case when status = 'late' and check_in is not null
                 then greatest(extract(epoch from (check_in at time zone 'Asia/Riyadh')::time)/60.0
                               - v_cfg.shift_start_hour * 60 - v_cfg.late_grace_minutes, 0)
                 else 0 end), 0)
    into v_present, v_absent, v_ot_hours, v_late_min
  from attendance where employee_id = p_employee_id and date between v_start and v_end;

  v_daily_wage := round(v_basic / nullif(v_cfg.standard_work_days,0), 2);
  v_hourly     := round(v_basic / nullif(v_cfg.standard_work_days * v_cfg.daily_hours,0), 4);
  v_ot_amt     := round(v_ot_hours * v_hourly * v_cfg.overtime_multiplier, 2);
  v_absence_ded := round(v_daily_wage * v_absent, 2);
  v_late_ded   := round((v_late_min / 60.0) * v_hourly, 2);

  -- approved adjustments only
  select coalesce(sum(amount) filter (where type in ('bonus','allowance','overtime')), 0),
         coalesce(sum(amount) filter (where type in ('penalty','advance')), 0)
    into v_additions, v_manual
  from payroll_adjustments where employee_id = p_employee_id and period = p_period and status = 'approved';

  -- GOSI: base = basic + housing, capped; employee rate by system; expat = 0
  v_gosi_base := least(v_basic + v_housing, v_gosi.ceiling);
  if v_saudi then
    v_gosi_rate := case when v_gosi_sys = 'old' then v_gosi.saudi_old_employee else v_gosi.saudi_new_employee end;
  else
    v_gosi_rate := 0;
  end if;
  v_gosi_emp := round(v_gosi_base * v_gosi_rate, 2);

  v_gross := round(v_basic + v_housing + v_transport + v_other + v_ot_amt + v_additions, 2);
  v_ded   := round(v_absence_ded + v_late_ded + v_gosi_emp + v_manual, 2);
  v_net   := round(v_gross - v_ded, 2);

  return jsonb_build_object(
    'basic', v_basic, 'housing_allowance', v_housing, 'transport_allowance', v_transport,
    'other_allowance', v_other, 'overtime_hours', round(v_ot_hours,2), 'overtime_amount', v_ot_amt,
    'additions', v_additions, 'present_days', v_present, 'absent_days', v_absent,
    'absence_deduction', v_absence_ded, 'late_minutes', round(v_late_min,1), 'late_deduction', v_late_ded,
    'gosi_system', v_gosi_sys, 'gosi_employee', v_gosi_emp, 'manual_deductions', v_manual,
    'gross', v_gross, 'total_deductions', v_ded, 'net', v_net
  );
end;
$$;

