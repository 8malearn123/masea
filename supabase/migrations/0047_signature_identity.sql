-- =============================================================
-- Masiat Alsharq ERP — 0047 Signature identity (name · national id · IP)
-- The e-signature record must capture who signed: their full name, national
-- ID / iqama number, and the IP address the signature was made from — the
-- evidentiary trail for a signed contract. `contract_signatures` already has
-- signer_name + ip_address (0016); this adds the national id.
-- =============================================================

alter table contract_signatures
  add column if not exists national_id text;
