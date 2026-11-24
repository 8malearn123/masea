-- Rollback for 0098_customer_source_attribution.sql. Recorded sources stay (columns kept —
-- data-safe); functions/triggers are removed. Re-apply convert_lead_to_customer from 0044
-- and create_contract_draft from 0096 after running this.
drop trigger if exists trg_contracts_snapshot_acquisition on contracts;
drop function if exists contracts_snapshot_acquisition();
drop trigger if exists trg_leads_guard_source on leads;
drop function if exists leads_guard_source();
drop trigger if exists trg_customers_guard_acquisition on customers;
drop function if exists customers_guard_acquisition();
drop function if exists set_contract_marketing(uuid, jsonb);
drop function if exists change_customer_acquisition(uuid, text, text, text);
drop function if exists set_customer_acquisition(uuid, jsonb);
drop function if exists apply_contract_marketing(uuid, jsonb);
drop function if exists apply_customer_acquisition(uuid, jsonb);
drop function if exists source_note_ok(text, text);
update lead_sources set is_active = true where code = 'campaign';
