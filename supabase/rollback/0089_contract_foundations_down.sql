-- Rollback for 0089_contract_foundations.sql.
-- Restores the 0023 posting functions' behaviour (manual calls only) and drops the guards.
-- Journal entries already posted are kept (they are real accounting events).
drop trigger if exists trg_guard_contract_delete on contracts;
drop trigger if exists trg_guard_contract_signatures on contract_signatures;
drop trigger if exists trg_guard_contract_clauses on contract_clauses;
drop trigger if exists trg_payments_guard_posted on payments;
drop trigger if exists trg_payments_after_change on payments;
drop trigger if exists trg_contracts_auto_post on contracts;
drop trigger if exists trg_contracts_sync_worker on contracts;
drop function if exists guard_contract_delete();
drop function if exists guard_contract_signatures();
drop function if exists guard_contract_clauses();
drop function if exists contract_text_locked(uuid);
drop function if exists payments_guard_posted();
drop function if exists payments_after_change();
drop function if exists contracts_recalc_paid(uuid);
drop function if exists contracts_auto_post();
drop function if exists post_contract_manual(uuid);
drop function if exists contracts_sync_worker_status();
drop function if exists worker_profile_has_other_live(uuid, uuid);
drop function if exists set_contract_worker(uuid, uuid);
drop function if exists worker_contract_conflict(uuid, date, date, uuid);
alter table contracts drop constraint if exists contracts_worker_no_overlap;
drop function if exists contract_status_is_live(contract_status);
alter table contracts drop column if exists worker_profile_id;
grant execute on function post_contract_signed(uuid)  to authenticated;
grant execute on function post_payment_received(uuid) to authenticated;
delete from app_config where key = 'acc_auto_post_contracts';
