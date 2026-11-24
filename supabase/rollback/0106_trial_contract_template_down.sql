-- Rollback for 0106_trial_contract_template.sql. The approved template version, document
-- fields and accepted documents are kept (contract records). Re-apply trial_document and
-- trial_public_view from 0092 afterwards.
drop function if exists create_trial_agreement(uuid, uuid, text, numeric, int, date, jsonb);
drop function if exists trial_document_for(uuid);
