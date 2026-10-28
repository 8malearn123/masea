-- Rollback for 0060_contract_from_accepted_terms.sql.
-- Contracts already created from accepted terms are kept (they are real
-- contracts with their clauses, signature and order link); only the automation
-- and the acceptance-time column go.

drop trigger if exists service_requests_contract_from_terms on service_requests;
drop function if exists trg_request_contract_from_terms();
drop function if exists contract_from_accepted_terms(uuid);
delete from app_config where key = 'contract_auto_terms_daily';
alter table contracts drop column if exists terms_accepted_at;
