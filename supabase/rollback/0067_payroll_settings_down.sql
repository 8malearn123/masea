-- Rollback for 0067_payroll_settings.sql.
-- Saved values stay (they are the company's real settings); only the grant,
-- the bounds and the audit triggers go.
drop trigger if exists trg_audit_row on payroll_config;
drop trigger if exists trg_audit_row on gosi_config;
alter table payroll_config drop constraint if exists payroll_config_bounds;
alter table gosi_config    drop constraint if exists gosi_config_bounds;
delete from role_permissions
 where module = 'hr' and action = 'manage' and role_code in ('admin', 'hr');
