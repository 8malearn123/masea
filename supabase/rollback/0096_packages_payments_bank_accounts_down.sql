-- Rollback for 0096_packages_payments_bank_accounts.sql.
-- Re-apply calc_price / create_contract_draft from 0065 / 0056 and the payment
-- functions from 0089 after running this. Added columns are kept (data-safe);
-- drop them manually only once no row depends on them.
drop view if exists contract_installments_v;
drop function if exists set_contract_installments(uuid, jsonb);
drop function if exists contract_installments_allocate(uuid) cascade;
drop table if exists contract_installments;
drop function if exists set_payment_status(uuid, text, text);
drop function if exists record_contract_payment(uuid, numeric, payment_method, date, uuid, text, text, text);
drop function if exists post_payment_bounced(uuid);
drop function if exists payment_cash_account(payments);
drop function if exists upsert_bank_account(uuid, text, text, text, text, text, text, text, text, boolean);
drop function if exists bank_account_options();
drop function if exists pricing_packages(text, text, text);
alter table payments drop constraint if exists payments_status_check;
alter table bank_accounts drop constraint if exists bank_accounts_iban_check;
alter table bank_accounts drop constraint if exists bank_accounts_currency_check;
drop trigger if exists trg_audit_row on bank_accounts;
alter table pricing_rules drop constraint if exists pricing_rules_package_check;
