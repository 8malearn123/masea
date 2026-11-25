-- Rollback for 0107_contract_esignature_all.sql. Signatures and their new columns are kept
-- (evidence). Restores direct inserts (0016 policy) and the 0089 guard.
drop function if exists sign_contract_party(uuid, text, text, text, text, text, text, text, text);
drop trigger if exists trg_guard_signed_contract_content on contracts;
drop function if exists guard_signed_contract_content();
create policy cs_insert on contract_signatures for insert to authenticated with check (has_perm('contracts', 'edit'));
