-- =============================================================
-- Masiat Alsharq ERP — 0031 Bank accounts (Accounting Phase 5)
-- Managed bank/cash accounts mapped to chart leaves + bank transfers.
-- Reuses chart_of_accounts (1111/1112/1113), journal engine, branches, has_perm.
-- =============================================================

create table bank_accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  account_code text not null references chart_of_accounts(code),
  bank         text,
  iban         text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (account_code)
);

insert into bank_accounts (name, account_code, bank, iban) values
  ('الصندوق (نقدية)', '1111', 'نقدية', null),
  ('الحساب الجاري - الراجحي', '1112', 'مصرف الراجحي', 'SA0380000000608010167519'),
  ('الحساب الجاري - الأهلي', '1113', 'البنك الأهلي', 'SA4420000001234567891234')
on conflict (account_code) do nothing;

-- تحويل بين حسابين نقديين/بنكيين: DR الحساب المستلم / CR الحساب المُحوَّل منه
create or replace function post_bank_transfer(
  p_from text, p_to text, p_amount numeric, p_date date, p_branch uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_period uuid;
begin
  if p_amount <= 0 then raise exception 'مبلغ غير صحيح'; end if;
  if p_from = p_to then raise exception 'لا يمكن التحويل لنفس الحساب'; end if;
  v_period := ensure_period(p_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type)
  values (p_date, v_period, p_branch, coalesce(p_note, 'تحويل بنكي'), 'TRF', 'manual')
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id(p_to),   p_amount, 0, p_branch, 'تحويل وارد'),
    (v_entry, acc_id(p_from), 0, p_amount, p_branch, 'تحويل صادر');
  return v_entry;
end; $$;

grant execute on function post_bank_transfer(text, text, numeric, date, uuid, text) to authenticated;

alter table bank_accounts enable row level security;
create policy bank_read on bank_accounts for select using (has_perm('accounting', 'view'));
create policy bank_write on bank_accounts for all
  using (has_perm('accounting', 'create')) with check (has_perm('accounting', 'create'));
