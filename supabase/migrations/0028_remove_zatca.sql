-- =============================================================
-- Masiat Alsharq ERP — 0028 Remove ZATCA e-invoice integration
-- The ZATCA (Fatoora) e-invoice link is excluded from scope. Drop the QR /
-- UUID / cryptographic-stamp columns from invoices. Tax invoices keep their
-- separated 15% VAT; they are simply no longer ZATCA e-invoice documents.
-- =============================================================

alter table invoices drop column if exists zatca_qr;
alter table invoices drop column if exists zatca_hash;
alter table invoices drop column if exists zatca_uuid;
