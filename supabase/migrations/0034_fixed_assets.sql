-- =============================================================
-- Masiat Alsharq ERP — 0034 Fixed assets (Accounting Phase 8)
-- Asset register + acquisition posting + straight-line depreciation.
--   acquisition: DR أصل ثابت (121x/122x/123x) / CR بنك/نقدية
--   depreciation: DR مصروف الإهلاك (5900) / CR مجمع الإهلاك (1290)
-- Reuses chart_of_accounts, journal engine, branches, has_perm.
-- =============================================================

create table fixed_assets (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  category         text not null check (category in ('furniture','devices','vehicles')),
  asset_code       text not null references chart_of_accounts(code), -- 1210/1220/1230
  cost             numeric(14,2) not null check (cost > 0),
  salvage_value    numeric(14,2) not null default 0 check (salvage_value >= 0),
  useful_life_years integer not null default 5 check (useful_life_years > 0),
  acquisition_date date not null default current_date,
  branch_id        uuid references branches(id) on delete set null,
  accumulated_dep  numeric(14,2) not null default 0,
  status           text not null default 'active' check (status in ('active','disposed')),
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index idx_fixed_assets_status on fixed_assets(status);

-- monthly straight-line depreciation amount for an asset
create or replace function asset_monthly_dep(p_cost numeric, p_salvage numeric, p_life integer)
returns numeric language sql immutable as $$
  select round((p_cost - p_salvage) / nullif(p_life * 12, 0), 2)
$$;

-- acquisition entry: DR asset / CR pay account
create or replace function post_asset_acquisition(p_asset_id uuid, p_pay_code text default '1112')
returns uuid language plpgsql security definer set search_path = public as $$
declare a fixed_assets%rowtype; v_entry uuid; v_period uuid;
begin
  select * into a from fixed_assets where id = p_asset_id;
  if not found then raise exception 'الأصل غير موجود'; end if;
  select id into v_entry from journal_entries where reference = 'ASSET-' || a.id;
  if v_entry is not null then return v_entry; end if;
  v_period := ensure_period(a.acquisition_date);
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (a.acquisition_date, v_period, a.branch_id, 'شراء أصل ثابت: ' || a.name, 'ASSET-' || a.id, 'manual', p_asset_id)
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description) values
    (v_entry, acc_id(a.asset_code), a.cost, 0, a.branch_id, 'تكلفة الأصل'),
    (v_entry, acc_id(p_pay_code), 0, a.cost, a.branch_id, 'سداد ثمن الأصل');
  update fixed_assets set journal_entry_id = v_entry where id = p_asset_id;
  return v_entry;
end; $$;

-- period depreciation: one entry summing all active assets — DR 5900 / CR 1290
create or replace function post_depreciation(p_period text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_period uuid; v_total numeric := 0; v_date date;
begin
  select id into v_entry from journal_entries where reference = 'DEP-' || p_period;
  if v_entry is not null then return v_entry; end if;

  select coalesce(sum(
    least(
      asset_monthly_dep(cost, salvage_value, useful_life_years),
      greatest(cost - salvage_value - accumulated_dep, 0)  -- never depreciate below salvage
    )), 0)
    into v_total
  from fixed_assets where status = 'active';

  if v_total <= 0 then raise exception 'لا يوجد إهلاك مستحق لهذه الفترة'; end if;

  v_date := (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  v_period := ensure_period(v_date);
  insert into journal_entries (entry_date, period_id, description, reference, source_type)
  values (v_date, v_period, 'إهلاك الأصول الثابتة ' || p_period, 'DEP-' || p_period, 'manual')
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, description) values
    (v_entry, acc_id('5900'), v_total, 0, 'مصروف الإهلاك'),
    (v_entry, acc_id('1290'), 0, v_total, 'مجمع الإهلاك');

  update fixed_assets set accumulated_dep = accumulated_dep + least(
    asset_monthly_dep(cost, salvage_value, useful_life_years),
    greatest(cost - salvage_value - accumulated_dep, 0)
  ) where status = 'active';
  return v_entry;
end; $$;

grant execute on function post_asset_acquisition(uuid, text), post_depreciation(text) to authenticated;

alter table fixed_assets enable row level security;
create policy fa_read on fixed_assets for select using (
  has_perm('accounting','view')
  and (has_perm('accounting','create') or branch_id = current_branch_id() or branch_id is null)
);
create policy fa_write on fixed_assets for all
  using (has_perm('accounting','create')) with check (has_perm('accounting','create'));
