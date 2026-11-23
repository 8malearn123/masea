-- Rollback for 0092_transfer_trials.sql.
-- Trial contracts (service_code = transfer_trial) and their journal entries are kept.
drop function if exists trial_step(uuid, text, date, text);
drop function if exists trial_missing_requirements(uuid);
drop function if exists set_trial_requirement(uuid, text, boolean, text);
drop function if exists trial_request_otp(text, text, text);
drop function if exists trial_accept(text, text, text, text, text);
drop function if exists trial_public_view(text);
drop function if exists trial_link_row(text);
drop function if exists issue_trial_link(uuid);
drop function if exists create_trial_agreement(uuid, uuid, text, numeric, int, date);
drop function if exists trial_contract_to(uuid, text, text);
drop function if exists trial_set_status(uuid, text, text);
drop function if exists trial_document(uuid);
drop table if exists outbound_messages;
drop table if exists trial_acceptances;
drop function if exists guard_trial_acceptance();
drop table if exists trial_links;
drop table if exists trial_agreements;
drop function if exists save_trial_terms_draft(text, text[]);
delete from app_config where key in ('trial_max_days','trial_link_valid_hours','trial_link_max_attempts',
                                     'trial_otp_required','trial_expiring_alert_days');
-- contracts_sync_worker_status: re-apply its 0089 definition after this rollback.
