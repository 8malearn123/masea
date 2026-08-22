-- =============================================================
-- Masiat Alsharq ERP — 0045 App config (managed business values)
-- Business numbers (VAT, commission, late fees, guarantee…) must be editable
-- from the UI — never hardcoded downstream (CLAUDE.md). A simple key/value
-- catalog, grouped, admin-managed. lead_sources/lead_stages (0044) cover the
-- managed reference lists; this covers the tunable numeric values.
-- =============================================================

create table app_config (
  key        text primary key,
  label_ar   text not null,
  grp        text not null default 'عام',   -- group for the settings UI
  value      numeric(12,3) not null default 0,
  unit       text,                          -- ٪ / يوم / ريال …
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('vat_rate',                   'ضريبة القيمة المضافة', 'الضرائب والرسوم', 15, '٪', 1),
  ('commission_rate',            'نسبة عمولة المبيعات',  'المبيعات',        2.5, '٪', 2),
  ('quote_validity_days',        'صلاحية عرض السعر',     'المبيعات',        7,  'يوم', 3),
  ('late_grace_days',            'مهلة سماح التأخير',    'الغرامات',        3,  'يوم', 4),
  ('late_daily_pct',             'غرامة التأخير اليومية','الغرامات',        1,  '٪', 5),
  ('late_max_pct',               'حد غرامة التأخير',     'الغرامات',        15, '٪', 6),
  ('replacement_guarantee_days', 'ضمان استبدال العاملة', 'الخدمة',          90, 'يوم', 7)
on conflict (key) do nothing;

alter table app_config enable row level security;
create policy cfg_read on app_config for select to authenticated using (true);
create policy cfg_admin on app_config for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- settings module permission (admin + operations manager) ------------
insert into permissions (module, action, label)
select 'settings', a.code, a.name_ar || ' الإعدادات'
from (values ('view','عرض'),('manage','إدارة')) as a(code, name_ar)
on conflict (module, action) do nothing;

insert into role_permissions (role_code, module, action)
select r, 'settings', act
from (values ('admin'), ('operations_manager')) as g(r)
cross join (values ('view'), ('manage')) as a(act)
on conflict do nothing;
