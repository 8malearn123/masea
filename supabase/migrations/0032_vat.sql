-- =============================================================
-- Masiat Alsharq ERP — 0032 VAT returns (Accounting Phase 6)
-- Periodic VAT return: output VAT (2120) − input VAT (1140) = net due to ZATCA.
-- Editable VAT config (rate / registration / frequency) — no hardcoded rate.
-- Reuses journal_entry_lines + chart_of_accounts + has_perm.
-- =============================================================

create table vat_config (
  id           integer primary key default 1 check (id = 1),
  rate         numeric(5,4) not null default 0.15,
  tax_number   text not null default '300000000000003',
  frequency    text not null default 'monthly' check (frequency in ('monthly','quarterly')),
  updated_at   timestamptz not null default now()
);
insert into vat_config (id) values (1) on conflict (id) do nothing;

create table vat_returns (
  id          uuid primary key default gen_random_uuid(),
  period      text not null unique,          -- 'YYYY-MM' or 'YYYY-Qn'
  output_vat  numeric(14,2) not null default 0,  -- ضريبة المخرجات المحصّلة
  input_vat   numeric(14,2) not null default 0,  -- ضريبة المدخلات القابلة للخصم
  net_vat     numeric(14,2) not null default 0,  -- المستحق للهيئة (+) أو المسترد (−)
  status      text not null default 'draft' check (status in ('draft','filed','paid')),
  filed_at    timestamptz,
  filed_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- compute a period's VAT from the journal (output 2120 − input 1140)
create or replace function compute_vat_return(p_period text)
returns table(output_vat numeric, input_vat numeric, net_vat numeric)
language sql stable security definer set search_path = public as $$
  with je as (
    select l.account_id, l.debit, l.credit
    from journal_entry_lines l
    join journal_entries e on e.id = l.entry_id
    where to_char(e.entry_date, 'YYYY-MM') = p_period and e.status = 'posted'
  )
  select
    coalesce(sum(credit - debit) filter (where account_id = acc_id('2120')), 0) as output_vat,
    coalesce(sum(debit - credit) filter (where account_id = acc_id('1140')), 0) as input_vat,
    coalesce(sum(credit - debit) filter (where account_id = acc_id('2120')), 0)
      - coalesce(sum(debit - credit) filter (where account_id = acc_id('1140')), 0) as net_vat
  from je;
$$;
grant execute on function compute_vat_return(text) to authenticated;

alter table vat_config  enable row level security;
alter table vat_returns enable row level security;
create policy vatcfg_read on vat_config for select using (has_perm('accounting','view'));
create policy vatcfg_write on vat_config for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
create policy vatret_read on vat_returns for select using (has_perm('accounting','view'));
create policy vatret_write on vat_returns for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
