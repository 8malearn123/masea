-- =============================================================
-- Masiat Alsharq ERP — 0026 Accounting foundation (Phase 1 completion)
-- Enriches the chart of accounts, makes accounts editable/disable-able
-- (is_active soft-delete), seeds the current-year periods, and seeds
-- balanced opening entries per branch (cost center). Reuses 0023 engine.
-- =============================================================

-- accounts are manageable from the UI: support disable (soft delete)
alter table chart_of_accounts add column if not exists is_active boolean not null default true;
alter table chart_of_accounts add column if not exists updated_at timestamptz not null default now();

-- ---------- enrich the Saudi chart (idempotent) ----------------
-- fixed-assets header
insert into chart_of_accounts (code, name_ar, type, is_postable, normal_balance) values
  ('1200','الأصول الثابتة','asset',false,'debit')
on conflict (code) do nothing;
update chart_of_accounts set parent_id = acc_id('1000') where code = '1200' and parent_id is null;

-- new postable leaves
insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance) values
  ('1150','مصروفات مدفوعة مقدماً','asset',     acc_id('1100'),'debit'),
  ('1210','أثاث ومفروشات','asset',             acc_id('1200'),'debit'),
  ('1220','أجهزة ومعدات','asset',              acc_id('1200'),'debit'),
  ('1230','سيارات','asset',                    acc_id('1200'),'debit'),
  ('1290','مجمع الإهلاك','asset',              acc_id('1200'),'credit'), -- contra-asset
  ('2160','مقدمات العملاء','liability',        acc_id('2100'),'credit'),
  ('3300','جاري الشركاء','equity',             acc_id('3000'),'credit'),
  ('5600','رسوم المكاتب الخارجية','expense',   acc_id('5000'),'debit'),
  ('5700','الإيجارات','expense',               acc_id('5000'),'debit'),
  ('5800','المرافق والخدمات','expense',        acc_id('5000'),'debit'),
  ('5900','الإهلاك','expense',                 acc_id('5000'),'debit')
on conflict (code) do nothing;

-- ---------- seed the current-year accounting periods -----------
insert into accounting_periods (year, month)
select 2026, m from generate_series(1, 12) as m
on conflict (year, month) do nothing;

-- ---------- seed balanced opening entries per branch -----------
-- رصيد افتتاحي لكل فرع (مركز تكلفة): مدين البنك / دائن جاري الشركاء — متوازن.
do $$
declare
  b record;
  v_entry uuid;
  v_period uuid;
  v_amount numeric := 50000;
begin
  v_period := ensure_period('2026-01-01');
  -- branches has `name` (0002) — not name_ar (that column belongs to chart_of_accounts)
  for b in select id, name from branches loop
    -- skip if this branch already has an opening entry
    if exists (select 1 from journal_entries
               where reference = 'OPEN-' || b.id and source_type = 'manual') then
      continue;
    end if;
    insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type)
    values ('2026-01-01', v_period, b.id, 'رصيد افتتاحي - ' || b.name, 'OPEN-' || b.id, 'manual')
    returning id into v_entry;
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
      (v_entry, acc_id('1112'), v_amount, 0, b.id, 'رصيد بنكي افتتاحي'),
      (v_entry, acc_id('3100'), 0, v_amount, b.id, 'رأس المال');
  end loop;
end $$;
