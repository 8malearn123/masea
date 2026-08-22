-- =============================================================
-- Masiat Alsharq ERP — 0015 Contracts state-machine enum values
-- Extends the existing contract_status enum (draft/active/completed/cancelled)
-- with the four new states. Kept in its own migration because new enum
-- values must be committed before they can be used (seed / casts).
-- =============================================================

alter type contract_status add value if not exists 'pending_approval' after 'draft';
alter type contract_status add value if not exists 'approved' after 'pending_approval';
alter type contract_status add value if not exists 'awaiting_signature' after 'approved';
alter type contract_status add value if not exists 'signed' after 'awaiting_signature';
