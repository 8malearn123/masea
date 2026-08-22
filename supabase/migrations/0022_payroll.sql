-- =============================================================
-- Masiat Alsharq ERP — 0022 Payroll engine (module 05)
-- Salary is COMPUTED from sources: attendance + employee file + approved
-- adjustments + config. No manual numbers in the run screen.
-- Reuses: employees, employee_details (0021), attendance (0004), has_perm,
-- owns_employee. Adds runs + payslips (frozen snapshot) + adjustments + config.
-- =============================================================

-- ---------- tunable config (singletons) -------------------------
create table payroll_config (
  id                  integer primary key default 1 check (id = 1),
  standard_work_days  integer       not null default 30,
  daily_hours         numeric(4,1)  not null default 8,
  overtime_multiplier numeric(4,2)  not null default 1.5,   -- نظام العمل السعودي
  shift_start_hour    numeric(4,1)  not null default 8,      -- 08:00
  late_grace_minutes  integer       not null default 15,
  updated_at          timestamptz   not null default now()
);
insert into payroll_config (id) values (1);

create table gosi_config (
  id                 integer primary key default 1 check (id = 1),
  ceiling            numeric(12,2) not null default 45000,  -- وعاء التأمينات
  saudi_old_employee numeric(6,4)  not null default 0.0975, -- نظام قديم (قبل 2024-07-03)
  saudi_old_company  numeric(6,4)  not null default 0.1175,
  saudi_new_employee numeric(6,4)  not null default 0.10,   -- نظام جديد (متصاعد، قابل للتعديل)
  saudi_new_company  numeric(6,4)  not null default 0.12,
  nonsaudi_company   numeric(6,4)  not null default 0.02,   -- أخطار مهنية فقط
  updated_at         timestamptz   not null default now()
);
insert into gosi_config (id) values (1);

-- ---------- adjustment requests (approval workflow) -------------
create table payroll_adjustments (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  type          text not null check (type in ('bonus','penalty','advance','allowance','overtime')),
  amount        numeric(12,2) not null check (amount >= 0),
  reason        text,
  period        text not null,  -- 'YYYY-MM'
  submitted_by  uuid references auth.users(id) on delete set null,
  approved_by   uuid references auth.users(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index idx_payadj_emp_period on payroll_adjustments(employee_id, period);

-- ---------- runs + payslips (frozen snapshot) -------------------
create table payroll_runs (
  id               uuid primary key default gen_random_uuid(),
  period           text not null,                 -- 'YYYY-MM'
  branch_id        uuid references branches(id) on delete set null, -- null = كل الفروع
  status           text not null default 'draft' check (status in ('draft','calculated','approved','paid')),
  total_gross      numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  total_net        numeric(14,2) not null default 0,
  run_by           uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table payslips (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references payroll_runs(id) on delete cascade,
  employee_id         uuid not null references employees(id) on delete cascade,
  basic               numeric(12,2) not null default 0,
  housing_allowance   numeric(12,2) not null default 0,
  transport_allowance numeric(12,2) not null default 0,
  other_allowance     numeric(12,2) not null default 0,
  overtime_amount     numeric(12,2) not null default 0,
  additions           numeric(12,2) not null default 0,
  absence_deduction   numeric(12,2) not null default 0,
  late_deduction      numeric(12,2) not null default 0,
  gosi_employee       numeric(12,2) not null default 0,
  manual_deductions   numeric(12,2) not null default 0,
  gross               numeric(12,2) not null default 0,
  total_deductions    numeric(12,2) not null default 0,
  net                 numeric(12,2) not null default 0,
  present_days        integer not null default 0,
  absent_days         integer not null default 0,
  overtime_hours      numeric(8,2) not null default 0,
  breakdown           jsonb not null default '{}',  -- frozen source detail
  created_at          timestamptz not null default now()
);
create index idx_payslips_run on payslips(run_id);
create index idx_payslips_emp on payslips(employee_id);

-- =============================================================
-- calculate_payslip(): the engine — reads sources, returns full breakdown.
-- =============================================================
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

grant execute on function calculate_payslip(uuid, text) to authenticated;

-- =============================================================
-- RLS
-- =============================================================
alter table payroll_config       enable row level security;
alter table gosi_config          enable row level security;
alter table payroll_adjustments  enable row level security;
alter table payroll_runs         enable row level security;
alter table payslips             enable row level security;

create policy paycfg_read on payroll_config for select using (has_perm('hr','view'));
create policy paycfg_write on payroll_config for all using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
create policy gosicfg_read on gosi_config for select using (has_perm('hr','view'));
create policy gosicfg_write on gosi_config for all using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

-- adjustments: managers/supervisors submit (their scope); HR approves; employee sees own.
create policy payadj_read on payroll_adjustments for select
  using (has_perm('hr','view') or emp_in_my_branch(employee_id) or owns_employee(employee_id));
create policy payadj_submit on payroll_adjustments for insert
  with check (has_perm('hr','manage') or emp_in_my_branch(employee_id));
create policy payadj_decide on payroll_adjustments for update
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

create policy payruns_read on payroll_runs for select using (has_perm('hr','view'));
create policy payruns_write on payroll_runs for all using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

create policy payslips_read on payslips for select
  using (has_perm('hr','view') or owns_employee(employee_id));
create policy payslips_write on payslips for all using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
