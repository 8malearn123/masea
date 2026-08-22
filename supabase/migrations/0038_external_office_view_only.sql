-- =============================================================
-- Masiat Alsharq ERP — 0038 External office is view-only on contracts
-- The external office follows up recruitment requests (view + advance stage +
-- notes via advance_recruitment_stage, which is assignment-gated) but must NOT
-- create or edit contracts. Drop its create/edit grant down to view only.
-- =============================================================
delete from role_permissions where role_code = 'external_office';
insert into role_permissions (role_code, module, action)
values ('external_office', 'contracts', 'view');
