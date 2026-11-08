-- Rollback for 0069_employee_file.sql.
-- Data stays: termination dates/reasons, employee numbers and the default
-- allowance percentages are kept (real records); only behaviour is reverted.
drop function if exists terminate_employee(uuid, date, text, text);
drop function if exists reactivate_employee(uuid);
drop function if exists hr_account_options();
drop function if exists user_display_names(uuid[]);
drop policy if exists emp_details_edit on employee_details;
drop trigger if exists trg_guard_details_pay on employee_details;
drop function if exists guard_employee_details_pay();
alter table employee_details drop constraint if exists employee_details_iban_chk;
alter table employee_details drop constraint if exists employee_details_iqama_chk;
alter table employees drop constraint if exists employees_national_id_chk;
alter table employees drop constraint if exists employees_termination_reason_chk;
drop index if exists ux_employees_user;
drop index if exists ux_employees_no;
drop trigger if exists trg_set_employee_no on employees;
drop function if exists set_employee_no();
alter table payroll_config drop constraint if exists payroll_config_bounds;
alter table payroll_config add constraint payroll_config_bounds check (
  standard_work_days between 20 and 31
  and daily_hours > 0 and daily_hours <= 12
  and overtime_multiplier >= 1 and overtime_multiplier <= 3
  and shift_start_hour >= 0 and shift_start_hour < 24
  and late_grace_minutes between 0 and 120
);
