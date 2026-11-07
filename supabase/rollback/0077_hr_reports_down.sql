-- Rollback for 0077_hr_reports.sql. Reports are read-only views of existing data;
-- only the report function, the nitaqat settings table and its checks go.
drop function if exists hr_report_rows(date, date);
drop trigger if exists trg_audit_row on nitaqat_bands;
drop table if exists nitaqat_bands;
alter table app_config drop constraint if exists app_config_saudization_chk;
