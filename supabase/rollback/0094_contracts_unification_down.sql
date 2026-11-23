-- Rollback for 0094_contracts_unification.sql.
drop trigger if exists trg_contracts_aa_default_rental_template on contracts;
drop function if exists contracts_default_rental_template();
drop function if exists approved_rental_template(text);
update contract_templates set is_active = true
 where template_code is null and service_code in ('monthly_rental','daily_rental','hourly_rental');
-- it_admin grants: re-run section 1 of 0093_it_mail_registry.sql and its GRANT EXECUTE lines.
