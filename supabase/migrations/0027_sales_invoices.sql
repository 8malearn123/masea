-- =============================================================
-- Masiat Alsharq ERP — 0027 Sales & Invoices posting (Accounting Phase 3)
-- Posts AD-HOC invoices (not tied to a contract) to the journal:
--   DR ذمم العملاء (total) / CR إيراد (pre-VAT) + CR ضريبة مخرجات.
-- Contract-linked invoices are NOT posted here — revenue was already booked
-- when the contract was signed (0023). Reuses invoices, chart, journal engine.
-- =============================================================

-- which revenue account an ad-hoc invoice credits (default: other revenue)
alter table invoices add column if not exists revenue_code text
  references chart_of_accounts(code);
alter table invoices alter column revenue_code set default '4500';

-- post an ad-hoc (contract-less) invoice; idempotent; skips contract invoices
create or replace function post_invoice_issued(p_invoice_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv      invoices%rowtype;
  v_entry  uuid;
  v_period uuid;
  v_rev    text;
begin
  select * into inv from invoices where id = p_invoice_id;
  if not found then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.contract_id is not null then
    return null; -- إيراد العقد مُثبت مسبقًا — لا ترحيل مزدوج
  end if;

  select id into v_entry from journal_entries
   where source_type = 'manual' and reference = 'SINV-' || inv.invoice_no;
  if v_entry is not null then return v_entry; end if;

  v_rev := coalesce(inv.revenue_code, '4500');
  v_period := ensure_period(inv.issue_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (inv.issue_date, v_period, inv.branch_id,
          'فاتورة مبيعات #' || inv.invoice_no, 'SINV-' || inv.invoice_no, 'manual', p_invoice_id)
  returning id into v_entry;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('1120'), inv.total, 0, inv.branch_id, 'ذمة العميل');
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id(v_rev), 0, inv.subtotal, inv.branch_id, 'إيراد (قبل الضريبة)');
  if inv.vat_amount > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('2120'), 0, inv.vat_amount, inv.branch_id, 'ضريبة مخرجات');
  end if;

  update invoices set journal_entry_id = v_entry, status = 'issued' where id = p_invoice_id;
  return v_entry;
end;
$$;

grant execute on function post_invoice_issued(uuid) to authenticated;
