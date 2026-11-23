-- Rollback for 0093_it_mail_registry.sql.
drop function if exists cancel_account_request(uuid);
drop function if exists execute_account_request(uuid, text);
drop function if exists decide_account_request(uuid, boolean, text);
drop function if exists submit_account_request(text, uuid, text, jsonb, text);
drop function if exists update_mail_ownership(jsonb);
drop table if exists it_account_requests;
drop table if exists it_mail_accounts;
drop table if exists it_mail_ownership;
delete from role_permissions where module = 'it_admin';
delete from permissions where module = 'it_admin';
