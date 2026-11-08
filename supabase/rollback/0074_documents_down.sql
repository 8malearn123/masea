-- Rollback for 0074_documents.sql.
-- Data stays: documents (incl. worker documents and renewal history), the 5160
-- account, journal entries and the config row are kept (real records); only the
-- functions, guards and policies go, and the original policies come back.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists hr_docs_read on storage.objects';
    execute 'drop policy if exists hr_docs_insert on storage.objects';
    execute 'drop policy if exists hr_docs_update on storage.objects';
  end if;
end $$;

drop function if exists pending_document_costs();
drop function if exists post_document_cost(uuid, date, text);
drop function if exists renew_document(uuid, text, date, date, numeric, text, text, text, integer, text);

drop trigger if exists trg_guard_employee_document on employee_documents;
drop function if exists guard_employee_document();

drop policy if exists emp_docs_read   on employee_documents;
drop policy if exists emp_docs_insert on employee_documents;
drop policy if exists emp_docs_update on employee_documents;
create policy emp_docs_read on employee_documents for select to authenticated
  using (employee_id is not null and hr_can_see(employee_id));
create policy emp_docs_write on employee_documents for all
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

drop function if exists hr_doc_path_writable(text);
drop function if exists hr_doc_path_visible(text);
drop function if exists hr_doc_path_owner(text);
drop function if exists hr_doc_writable(uuid, uuid);
drop function if exists hr_doc_visible(uuid, uuid);
drop function if exists worker_in_my_branch(uuid);
drop function if exists hr_doc_status(date);
drop function if exists doc_alert_days();

drop trigger if exists trg_audit_row on app_config;
drop policy if exists cfg_hr_update on app_config;
alter table app_config drop constraint if exists app_config_doc_alert_chk;
alter table employee_documents drop constraint if exists employee_documents_size_chk;
alter table employee_documents drop constraint if exists employee_documents_dates_chk;
alter table employee_documents drop constraint if exists employee_documents_cost_chk;
-- owner check and nullable employee_id stay: worker documents may already exist
