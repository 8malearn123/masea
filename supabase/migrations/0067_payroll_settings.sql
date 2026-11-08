-- =============================================================
-- Masiat Alsharq ERP — 0067 Payroll & GOSI settings become editable
-- Bug (نفس خلل 0050 في التسعير و0054 في الولاء): payroll_config و gosi_config
-- (0022) محروسة بـ has_perm('hr','manage') لكن رمز 'full' لا يتضمّن 'manage'،
-- فلا أحد يستطيع تعديلها — فكانت قيم الرواتب والتأمينات ثابتة فعلياً.
-- الإصلاح: منح hr.manage للمدير العام ولدور الموارد البشرية، وقيود سلامة على
-- القيم، وتدقيق كل تعديل عبر audit_row_change (0061).
-- يُبنى فوق الجداول القائمة (0022) — لا جداول جديدة.
-- =============================================================

insert into role_permissions (role_code, module, action)
values
  ('admin', 'hr', 'manage'),
  ('hr', 'hr', 'manage')
on conflict (role_code, module, action) do nothing;

-- ---------- sanity bounds (a typo must not break the whole payroll) ----------
alter table payroll_config drop constraint if exists payroll_config_bounds;
alter table payroll_config add constraint payroll_config_bounds check (
  standard_work_days between 20 and 31
  and daily_hours > 0 and daily_hours <= 12
  and overtime_multiplier >= 1 and overtime_multiplier <= 3
  and shift_start_hour >= 0 and shift_start_hour < 24
  and late_grace_minutes between 0 and 120
);

alter table gosi_config drop constraint if exists gosi_config_bounds;
alter table gosi_config add constraint gosi_config_bounds check (
  ceiling > 0
  and saudi_old_employee between 0 and 0.5 and saudi_old_company between 0 and 0.5
  and saudi_new_employee between 0 and 0.5 and saudi_new_company between 0 and 0.5
  and nonsaudi_company   between 0 and 0.5
);

-- ---------- every edit is audited (old → new, changed fields only) ----------
drop trigger if exists trg_audit_row on payroll_config;
create trigger trg_audit_row after insert or update or delete on payroll_config
  for each row execute function audit_row_change();
drop trigger if exists trg_audit_row on gosi_config;
create trigger trg_audit_row after insert or update or delete on gosi_config
  for each row execute function audit_row_change();
