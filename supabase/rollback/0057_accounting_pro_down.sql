-- =============================================================
-- Rollback for 0057_accounting_pro.sql — run MANUALLY, after a backup:
--   pg_dump --format=custom --file=before_0057_down.dump "$DATABASE_URL"
-- Removes the professional layer and restores the 0023 trigger behaviour.
-- PRECONDITION: entries in the new statuses (draft/pending/approved) are
-- discarded; POSTED entries (incl. reversals) stay — they are valid ledger
-- history and the original engine reads them unchanged.
-- =============================================================
begin;

-- triggers & guards
drop trigger if exists trg_je_guard_posted on journal_entries;
drop trigger if exists trg_jel_guard_posted on journal_entry_lines;
drop trigger if exists trg_je_audit on journal_entries;
drop trigger if exists trg_period_audit on accounting_periods;
drop trigger if exists trg_coa_audit on chart_of_accounts;
drop function if exists je_guard_posted();
drop function if exists jel_guard_posted();

-- workflow functions
drop function if exists submit_journal_entry(uuid);
drop function if exists approve_journal_entry(uuid);
drop function if exists post_journal_entry(uuid);
drop function if exists void_journal_entry(uuid);
drop function if exists reverse_journal_entry(uuid, date);
drop function if exists je_errors(uuid);
drop function if exists close_period(int, int);
drop function if exists reopen_period(int, int, text);
drop function if exists trial_balance(date, date, uuid);
drop view if exists v_general_ledger;

-- unposted workflow rows cannot exist under the 0023 constraint
delete from journal_entry_lines where entry_id in (select id from journal_entries where status in ('draft','pending','approved'));
delete from journal_entries where status in ('draft','pending','approved');

-- restore 0023 integrity triggers (balance on every entry; closed period on any write)
create or replace function je_assert_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_debit numeric(14,2); v_credit numeric(14,2); v_cnt integer;
begin
  if not exists (select 1 from journal_entries where id = v_entry) then return null; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into v_debit, v_credit, v_cnt
  from journal_entry_lines where entry_id = v_entry;
  if v_cnt > 0 and v_debit <> v_credit then
    raise exception 'القيد غير متوازن: مدين % ≠ دائن %', v_debit, v_credit;
  end if;
  return null;
end;
$$;
create or replace function je_period_open() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from accounting_periods p where p.id = new.period_id and p.status = 'closed') then
    raise exception 'لا يمكن الترحيل في فترة محاسبية مقفلة';
  end if;
  return new;
end;
$$;

-- tables (new in 0057)
drop table if exists bank_matches, bank_statement_lines, bank_statements, bank_rules,
  budget_lines, budgets, allocation_rules, recurring_entries, journal_entry_attachments,
  fixed_asset_events, payment_reminders, sales_credit_notes, einvoice_documents,
  company_tax_profile, fin_alert_states, period_reopen_log, fiscal_years,
  user_accounting_duties, accounting_duties, assistant_log, ai_provider_config cascade;
drop function if exists einv_guard();
alter table journal_entries drop column if exists cost_center_id;
drop table if exists cost_centers cascade;
-- the audit log is kept as history: swap its policy to admin-only before dropping the helper
drop policy if exists aud_read on accounting_audit_log;
create policy aud_read_admin on accounting_audit_log for select to authenticated using (is_admin());
drop function if exists has_acc_perm(text, text);

-- columns (new in 0057)
drop index if exists ux_je_idempotency;
alter table journal_entries
  drop column if exists kind, drop column if exists submitted_at,
  drop column if exists approved_by, drop column if exists approved_at,
  drop column if exists posted_by, drop column if exists posted_at,
  drop column if exists reversed_by, drop column if exists reversal_of,
  drop column if exists idempotency_key;
alter table journal_entries drop constraint if exists journal_entries_status_check;
alter table journal_entries add constraint journal_entries_status_check check (status in ('posted','void'));
update journal_entries set source_type = 'adjustment'
  where source_type not in ('manual','contract','payment','payroll','loyalty','penalty','adjustment');
alter table journal_entries drop constraint if exists journal_entries_source_type_check;
alter table journal_entries add constraint journal_entries_source_type_check
  check (source_type in ('manual','contract','payment','payroll','loyalty','penalty','adjustment'));
alter table chart_of_accounts drop column if exists fs_class, drop column if exists cf_class;
alter table fixed_assets drop column if exists method, drop column if exists disposed_at, drop column if exists disposal_proceeds;
alter table customers drop column if exists credit_limit;
alter table bills drop column if exists planned_pay_date;

-- the audit log is kept (history); only its write-protection trigger stays.
-- accounts 4600/5960 are kept if any line references them, else removed.
delete from chart_of_accounts c where c.code in ('4600','5960')
  and not exists (select 1 from journal_entry_lines l where l.account_id = c.id);
delete from app_config where key like 'acc\_%';
delete from role_permissions where module = 'accounting' and action in ('post','reopen');
delete from permissions where module = 'accounting' and action in ('post','reopen');

commit;
