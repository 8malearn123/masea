-- Rollback for 0087_rental_contract_template.sql.
-- Removes the structured rental template, its guards/approval, the contract pin,
-- the first-party reader/editor, the worker-doc reader and the proposed policy row.
-- Contracts keep their rows; only the 0087 columns are dropped.
drop trigger if exists trg_contracts_pin_template on contracts;
drop function if exists contracts_pin_template();
drop trigger if exists trg_contract_templates_guard on contract_templates;
drop function if exists contract_templates_guard();
drop function if exists approve_contract_template(uuid);
drop function if exists contract_company_profile();
drop function if exists update_contract_company_profile(jsonb);
drop function if exists contract_worker_doc(uuid);
drop function if exists set_contract_doc_fields(uuid, jsonb);

update contracts set template_id = null
 where template_id in (select id from contract_templates where template_code = 'rental_labor_services');
delete from contract_templates where template_code = 'rental_labor_services';
delete from app_config where key = 'replacement_max_proposed';

alter table contracts drop column if exists template_version;
alter table contracts drop column if exists template_sha256;
alter table contracts drop column if exists work_location;
alter table contracts drop column if exists doc_fields;

drop index if exists uq_contract_templates_code_version;
alter table contract_templates drop constraint if exists contract_templates_status_chk;
alter table contract_templates drop column if exists template_code;
alter table contract_templates drop column if exists doc;
alter table contract_templates drop column if exists version;
alter table contract_templates drop column if exists status;
alter table contract_templates drop column if exists content_sha256;
alter table contract_templates drop column if exists locked;
alter table contract_templates drop column if exists approved_by;
alter table contract_templates drop column if exists approved_at;
alter table contract_templates drop column if exists updated_at;

alter table company_tax_profile drop column if exists seller_name_en;
alter table company_tax_profile drop column if exists mol_license_no;
alter table company_tax_profile drop column if exists phone;
alter table company_tax_profile drop column if exists mobile;
alter table company_tax_profile drop column if exists email;
