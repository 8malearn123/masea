-- Rollback for 0097_contract_tax_invoices.sql. Issued invoices and notes are kept
-- (tax documents are never deleted); only the automation and functions are removed.
drop function if exists contract_tax_documents(uuid);
drop trigger if exists trg_settlements_tax_note on contract_settlements;
drop function if exists settlements_tax_note();
drop function if exists issue_contract_note(uuid, text, numeric, text);
drop function if exists issue_contract_note_core(uuid, text, numeric, text, uuid, uuid);
drop function if exists invoice_net_total(uuid);
drop trigger if exists trg_contracts_sync_invoice_paid on contracts;
drop function if exists contracts_sync_invoice_paid();
drop trigger if exists trg_contracts_auto_invoice on contracts;
drop function if exists contracts_auto_invoice();
drop function if exists issue_contract_invoice(uuid);
drop function if exists issue_contract_invoice_core(uuid);
drop policy if exists inv_contract_read on invoices;
drop policy if exists invl_contract_read on invoice_lines;
drop policy if exists scn_contract_read on sales_credit_notes;
drop index if exists invoices_one_per_contract;
drop function if exists zatca_qr_tlv(timestamptz, numeric, numeric);
drop function if exists seller_tax_identity();
drop function if exists zatca_tlv(int, text);
delete from app_config where key = 'contract_auto_invoice';
