-- Rollback for 0108_vat_inclusive_prices.sql. Stored amounts of contracts and invoices are kept
-- as recorded (financial records). Re-apply set_contract_vat (0085), create_trial_agreement (0092)
-- and issue_contract_invoice_core (0097) afterwards; the generated line columns keep working
-- (line_vat_fixed stays null for new lines).
drop function if exists vat_split_inclusive(numeric);
