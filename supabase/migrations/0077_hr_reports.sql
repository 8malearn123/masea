-- =============================================================
-- 0077 — المرحلة ي: تقارير الموارد البشرية
--   1) nitaqat_bands: نطاقات السعودة (بلاتيني/أخضر/…/أحمر) بحد أدنى قابل
--      للتعديل — تختلف حسب النشاط والحجم في «قوى»، فلا تُكتب في الكود.
--   2) قواعد احتساب السعودي في نطاقات (قيم نظام): الأجر الأدنى للاحتساب الكامل،
--      ووزن من يقل أجره عنه.
--   3) hr_report_rows(from, to): صف واحد لكل موظف في نطاق المستخدم بالبيانات
--      التي تُبنى عليها كل التقارير — التكلفة (من مسيرات الرواتب المعتمدة، وتقدير
--      بنفس محرك calculate_payslip للأشهر غير المعتمدة)، الحضور والغياب والتأخير،
--      الإجازات، تاريخ الالتحاق وانتهاء الخدمة، وأهلية السعودة.
--      التكلفة تظهر لمن يملك hr.manage أو عرض المحاسبة فقط (رواتب).
-- =============================================================

create table if not exists nitaqat_bands (
  code       text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name_ar    text not null check (length(btrim(name_ar)) between 1 and 40),
  min_pct    numeric(5,2) not null check (min_pct between 0 and 100),
  tone       text not null default 'navy' check (tone in ('success','gold','danger','navy')),
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);
-- defaults for a small recruitment office — adjust to the activity/size in «قوى»
insert into nitaqat_bands (code, name_ar, min_pct, tone) values
  ('platinum', 'بلاتيني', 40, 'success'),
  ('green_high', 'أخضر مرتفع', 30, 'success'),
  ('green_mid', 'أخضر متوسط', 23, 'success'),
  ('green_low', 'أخضر منخفض', 17, 'gold'),
  ('red', 'أحمر', 0, 'danger')
on conflict do nothing;

alter table nitaqat_bands enable row level security;
drop policy if exists nitaqat_read on nitaqat_bands;
drop policy if exists nitaqat_insert on nitaqat_bands;
drop policy if exists nitaqat_update on nitaqat_bands;
create policy nitaqat_read on nitaqat_bands for select to authenticated using (true);
create policy nitaqat_insert on nitaqat_bands for insert to authenticated with check (has_perm('hr','manage'));
create policy nitaqat_update on nitaqat_bands for update to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
drop trigger if exists trg_audit_row on nitaqat_bands;
create trigger trg_audit_row after insert or update or delete on nitaqat_bands
  for each row execute function audit_row_change();

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('saudization_full_wage', 'أجر السعودي الأدنى ليُحتسب كاملاً في نطاقات', 'الموارد البشرية', 4000, 'ريال', 42),
  ('saudization_half_weight', 'وزن السعودي الأقل أجرًا في نطاقات', 'الموارد البشرية', 0.5, 'موظف', 43)
on conflict (key) do nothing;
alter table app_config drop constraint if exists app_config_saudization_chk;
alter table app_config add constraint app_config_saudization_chk check (
  (key <> 'saudization_full_wage' or value >= 0) and (key <> 'saudization_half_weight' or value between 0 and 1));

-- ---------- the one dataset behind every HR report ------------------------------
create or replace function hr_report_rows(p_from date, p_to date)
returns table (
  employee_id uuid, full_name text, branch text, department text, job_title text,
  nationality text, is_saudi boolean, counts_saudization boolean, nitaqat_wage numeric,
  status text, hire_date date, termination_date date, termination_reason text,
  cost numeric, cost_estimated boolean,
  present_days int, late_days int, absent_days int, late_minutes numeric, leave_days int)
language plpgsql stable security definer set search_path = public as $$
declare
  e record; m date; v_period text; v_slip record; v_calc jsonb;
  v_cost numeric; v_est boolean; v_money boolean;
begin
  if not has_perm('hr','view') then
    raise exception 'تقارير الموارد البشرية لمن يملك صلاحية عرض الموارد البشرية' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'الفترة غير صحيحة'; end if;
  if p_to - p_from > 731 then raise exception 'الفترة حتى سنتين كحد أقصى'; end if;
  v_money := has_perm('hr','manage') or has_perm('accounting','view');

  for e in
    select x.*, d.department as dept, d.counts_in_saudization as cis, d.housing_allowance as housing,
           b.city
      from employees x
      left join employee_details d on d.employee_id = x.id
      left join branches b on b.id = x.branch_id
     where hr_in_scope(x.id)
       and coalesce(x.hire_date, p_to) <= p_to
       and (x.termination_date is null or x.termination_date >= p_from)
  loop
    v_cost := null; v_est := false;
    if v_money then
      v_cost := 0;
      m := date_trunc('month', p_from)::date;
      while m <= p_to loop
        v_period := to_char(m, 'YYYY-MM');
        select s.gross, s.gosi_employer into v_slip
          from payslips s join payroll_runs r on r.id = s.run_id
         where s.employee_id = e.id and r.period = v_period and r.status in ('approved','paid')
         limit 1;
        if found then
          v_cost := v_cost + v_slip.gross + v_slip.gosi_employer;
        elsif (e.hire_date is null or e.hire_date <= (m + interval '1 month - 1 day')::date)
              and (e.termination_date is null or e.termination_date >= m) then
          v_calc := calculate_payslip(e.id, v_period);
          v_cost := v_cost + coalesce((v_calc->>'gross')::numeric, 0) + coalesce((v_calc->>'gosi_employer')::numeric, 0);
          v_est := true;
        end if;
        m := (m + interval '1 month')::date;
      end loop;
    end if;

    return query
    select e.id, e.full_name, coalesce(e.city, ''), coalesce(e.dept, ''), coalesce(e.job_title, ''),
           coalesce(e.nationality, ''), e.nationality = 'السعودية', coalesce(e.cis, e.nationality = 'السعودية'),
           (coalesce(e.basic_salary, 0) + coalesce(e.housing, 0))::numeric,
           case when e.termination_date is not null and e.termination_date <= p_to then 'terminated' else 'active' end,
           e.hire_date, e.termination_date, e.termination_reason,
           round(v_cost, 2)::numeric, v_est,
           (select count(*)::int from attendance a where a.employee_id = e.id and a.date between p_from and p_to and a.status = 'present'),
           (select count(*)::int from attendance a where a.employee_id = e.id and a.date between p_from and p_to and a.status = 'late'),
           (select count(*)::int from attendance a where a.employee_id = e.id and a.date between p_from and p_to and a.status = 'absent'),
           (select coalesce(sum(a.late_minutes), 0)::numeric from attendance a where a.employee_id = e.id and a.date between p_from and p_to),
           (select coalesce(sum(least(l.end_date, p_to) - greatest(l.start_date, p_from) + 1), 0)::int
              from leave_requests l
             where l.employee_id = e.id and l.status = 'approved'
               and l.start_date <= p_to and l.end_date >= p_from);
  end loop;
end $$;
grant execute on function hr_report_rows(date, date) to authenticated;
