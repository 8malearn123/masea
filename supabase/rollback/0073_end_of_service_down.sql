-- Rollback for 0073_end_of_service.sql.
-- Data stays: settlements, journal entries, the three accounts and the config
-- column are kept (real records); only the functions, guards and policies go.
drop trigger if exists trg_audit_row on eos_settlements;
drop trigger if exists trg_guard_eos on eos_settlements;
drop function if exists guard_eos_frozen();
drop function if exists post_eos_provision(text);
drop function if exists eos_provision_target(date);
drop function if exists pay_eos_settlement(uuid, date, text);
drop function if exists post_eos_settlement(uuid);
drop function if exists cancel_eos_settlement(uuid);
drop function if exists approve_eos_settlement(uuid);
drop function if exists prepare_eos_settlement(uuid, boolean, numeric, numeric, text);
drop function if exists eos_calculate(uuid, date, text, boolean);
drop function if exists eos_wages(uuid);
drop function if exists eos_award(numeric, numeric, text);
drop function if exists eos_service_years(date, date);
drop policy if exists eos_read on eos_settlements;
alter table employees drop constraint if exists employees_termination_reason_chk;
alter table employees add constraint employees_termination_reason_chk check (
  termination_reason is null or termination_reason in
    ('resignation','employer_termination','contract_end','article_80','retirement','death','other')) not valid;
