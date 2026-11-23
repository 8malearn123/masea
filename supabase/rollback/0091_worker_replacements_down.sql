-- Rollback for 0091_worker_replacements.sql.
-- Contract assignments already swapped by completed replacements are kept.
drop function if exists complete_worker_replacement(uuid, date, date, text, text);
drop function if exists schedule_worker_replacement(uuid, uuid, date, date, uuid, uuid);
drop function if exists replacement_step(uuid, text, text);
drop function if exists request_worker_replacement(uuid, text, text, date, uuid, text, text);
drop function if exists replacement_quota(uuid);
alter table if exists worker_returns drop constraint if exists worker_returns_replacement_fk;
drop table if exists contract_replacements;
drop trigger if exists trg_contracts_pin_replacement_policy on contracts;
drop function if exists contracts_pin_replacement_policy();
alter table contracts drop column if exists replacement_policy;
delete from app_config where key = 'replacement_policy_active';
