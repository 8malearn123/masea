-- Rollback for 0090_settlements_returns_refunds.sql.
-- WARNING: drops settlements, returns, refunds and their operations log. Posted journal
-- entries (credit notes, refund payouts) are kept — reverse them with reverse_journal_entry.
drop trigger if exists trg_guard_contract_cancel on contracts;
drop function if exists guard_contract_cancel();
drop function if exists record_refund_payout(uuid, numeric, text, date, text);
drop function if exists refund_step(uuid, text, text);
drop function if exists update_refund_details(uuid, text, text, text, text, text);
drop function if exists allocate_refund(uuid);
drop table if exists refund_payouts;
drop table if exists refund_allocations;
drop table if exists refunds;
drop function if exists guard_refund_totals();
drop function if exists guard_refund_ledgers();
drop function if exists worker_return_step(uuid, text, date, text, text, uuid);
drop function if exists request_worker_return(uuid, date, text, text, uuid, uuid, text, uuid);
alter table if exists contract_settlements drop constraint if exists contract_settlements_return_fk;
drop table if exists worker_returns;
drop function if exists settle_contract_settlement(uuid);
drop function if exists settlement_step(uuid, text, text);
drop function if exists set_settlement_manual_due(uuid, numeric, text);
drop function if exists prepare_contract_settlement(uuid, date, text, text, jsonb, uuid);
drop function if exists compute_contract_settlement(uuid, date, jsonb);
drop table if exists contract_settlements;
drop function if exists next_ops_no(text);
drop function if exists log_contract_op(uuid, text, uuid, text, text, text, text);
drop table if exists contract_ops_events;
drop function if exists guard_ops_events();
drop function if exists contract_term_ref(uuid, text);
drop function if exists contract_term_value(uuid, text);
drop table if exists contract_settlement_terms;
drop table if exists contract_lookups;
drop function if exists ops_cfg(text, numeric);
drop function if exists contract_in_my_scope(uuid);
delete from app_config where key = 'settlement_count_return_day';
