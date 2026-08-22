-- =============================================================
-- Masiat Alsharq ERP — 0044 Sales CRM (leads pipeline + quotes)
-- A real sales cockpit for the `sales` role: manage the leads assigned to him
-- in his branch, log follow-ups with reminders, send quotes priced by the
-- existing engine, and convert lead → customer → quote → contract.
--   • reuses customers / services / calc_price (0019) / contracts / targets (0006)
--     + RBAC helpers. No parallel "customer/request/contract" concept.
--   • sources & stages are managed config tables (no hardcoded enums).
--   • RLS scopes everything to branch_id = get_my_branch() AND assigned_to = uid
--     for sales; branch managers see their whole branch; cross-branch roles all.
-- =============================================================

-- ---------- 1) managed config: lead sources + pipeline stages ------------------
create table lead_sources (
  code        text primary key,
  name_ar     text not null,
  is_active   boolean not null default true,
  sort_order  integer not null default 0
);
insert into lead_sources (code, name_ar, sort_order) values
  ('website',     'الموقع الإلكتروني', 1),
  ('call_center', 'مركز الاتصال',      2),
  ('referral',    'إحالة',             3),
  ('walk_in',     'زيارة للفرع',       4),
  ('campaign',    'حملة تسويقية',      5)
on conflict (code) do nothing;

create table lead_stages (
  code        text primary key,
  name_ar     text not null,
  sort_order  integer not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  is_active   boolean not null default true
);
insert into lead_stages (code, name_ar, sort_order, is_won, is_lost) values
  ('new',         'جديد',             1, false, false),
  ('contacted',   'تم التواصل',        2, false, false),
  ('quoted',      'عرض سعر مُرسل',     3, false, false),
  ('negotiation', 'تفاوض',            4, false, false),
  ('won',         'مكسوب',            5, true,  false),
  ('lost',        'مفقود',            6, false, true)
on conflict (code) do nothing;

-- ---------- 2) leads (the pipeline) --------------------------------------------
create table leads (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  phone        text,
  source_code  text references lead_sources(code),
  service_code text references services(code),
  stage_code   text not null references lead_stages(code) default 'new',
  assigned_to  uuid references auth.users(id) on delete set null,
  branch_id    uuid references branches(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null, -- set on conversion
  est_value    numeric(12,2) default 0,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_leads_assigned on leads(assigned_to);
create index idx_leads_branch on leads(branch_id);
create index idx_leads_stage on leads(stage_code);

-- ---------- 3) lead_activities (follow-up log + scheduled reminders) -----------
create table lead_activities (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  kind         text not null default 'note' check (kind in ('call','whatsapp','sms','visit','note')),
  note         text,
  follow_up_at timestamptz,                 -- متابعة مجدولة بتذكير
  done         boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index idx_lead_act_lead on lead_activities(lead_id);
create index idx_lead_act_followup on lead_activities(follow_up_at) where done = false;

-- ---------- 4) quotes (quick quote → contract) ---------------------------------
create table quotes (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references leads(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null,
  service_code text not null references services(code),
  base_amount  numeric(12,2) not null default 0,
  vat_amount   numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  status       text not null default 'draft' check (status in ('draft','sent','accepted','rejected','expired')),
  valid_until  date,
  notes        text,
  contract_id  uuid references contracts(id) on delete set null, -- set on conversion
  assigned_to  uuid references auth.users(id) on delete set null,
  branch_id    uuid references branches(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index idx_quotes_assigned on quotes(assigned_to);
create index idx_quotes_lead on quotes(lead_id);

-- ---------- 5) permissions: new 'leads' module ---------------------------------
insert into permissions (module, action, label)
select 'leads', a.code, a.name_ar || ' العملاء المحتملين'
from (values ('view','عرض'),('create','إنشاء'),('edit','تعديل'),('delete','حذف'),('export','تصدير')) as a(code, name_ar)
on conflict (module, action) do nothing;

insert into role_permissions (role_code, module, action)
select g.role_code, 'leads', act
from (values
  ('sales','full'), ('branch_manager','full'), ('operations_manager','full'),
  ('admin','full'), ('call_center','capture')
) as g(role_code, sym)
cross join lateral unnest(
  case g.sym
    when 'full'    then array['view','create','edit','delete','export']
    when 'capture' then array['view','create']
    else array[]::text[]
  end
) as act
on conflict do nothing;

-- ---------- 6) RLS: branch + assigned-to scope (read AND write) ----------------
-- sales → own assigned leads in his branch · branch_manager → whole branch ·
-- cross-branch roles → everything. The same predicate guards writes.
alter table leads            enable row level security;
alter table lead_activities  enable row level security;
alter table quotes           enable row level security;
alter table lead_sources     enable row level security;
alter table lead_stages      enable row level security;

-- config readable by anyone who can view leads; managed by admin only
create policy lsrc_read on lead_sources for select to authenticated using (has_perm('leads','view'));
create policy lsrc_admin on lead_sources for all to authenticated using (is_admin()) with check (is_admin());
create policy lstg_read on lead_stages for select to authenticated using (has_perm('leads','view'));
create policy lstg_admin on lead_stages for all to authenticated using (is_admin()) with check (is_admin());

create policy leads_read on leads for select to authenticated using (
  has_perm('leads','view') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
);
create policy leads_write on leads for all to authenticated using (
  has_perm('leads','edit') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
) with check (
  has_perm('leads','create') and (
    is_cross_branch() or branch_id = get_my_branch()
  )
);

-- activities follow the parent lead's visibility; writes stamped by the author
create policy lact_read on lead_activities for select to authenticated using (
  exists (select 1 from leads l where l.id = lead_activities.lead_id and (
    is_cross_branch()
    or (l.branch_id = get_my_branch() and (l.assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  ))
);
create policy lact_write on lead_activities for all to authenticated using (
  has_perm('leads','edit') and exists (select 1 from leads l where l.id = lead_activities.lead_id and (
    is_cross_branch() or (l.branch_id = get_my_branch() and (l.assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  ))
) with check (created_by = auth.uid());

create policy quotes_read on quotes for select to authenticated using (
  has_perm('leads','view') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
);
create policy quotes_write on quotes for all to authenticated using (
  has_perm('leads','edit') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
) with check (
  has_perm('leads','create') and (is_cross_branch() or branch_id = get_my_branch())
);

-- ---------- 7) convert_lead_to_customer() — reuse customers, no duplication -----
create or replace function convert_lead_to_customer(p_lead_id uuid)
returns customers language plpgsql security definer set search_path = public
as $$
declare v_lead leads; v_customer customers;
begin
  select * into v_lead from leads where id = p_lead_id;
  if not found then raise exception 'العميل المحتمل غير موجود'; end if;
  if not (is_cross_branch() or (v_lead.branch_id = get_my_branch()
      and (v_lead.assigned_to = auth.uid() or get_my_role() = 'branch_manager'))) then
    raise exception 'هذا العميل المحتمل خارج نطاقك';
  end if;
  if v_lead.customer_id is not null then
    select * into v_customer from customers where id = v_lead.customer_id;
    return v_customer;
  end if;
  insert into customers (full_name, phone, branch_id)
  values (v_lead.full_name, v_lead.phone, v_lead.branch_id)
  returning * into v_customer;
  update leads set customer_id = v_customer.id, updated_at = now() where id = p_lead_id;
  return v_customer;
end $$;

grant execute on function convert_lead_to_customer(uuid) to authenticated;

-- ---------- 8) seed: شرورة sales pipeline (guarded — no-op if no branch/user) ---
do $$
declare v_branch uuid; v_sales uuid; v_lead uuid;
begin
  select id into v_branch from branches where name = 'شرورة' limit 1;
  select id into v_sales from user_profiles where role = 'sales' and branch_id = v_branch limit 1;
  if v_branch is null or v_sales is null then return; end if;

  -- 7 Saudi-realistic leads across the pipeline
  insert into leads (full_name, phone, source_code, service_code, stage_code, assigned_to, branch_id, est_value, notes) values
    ('عبدالله آل مفرح',  '0555100201', 'website',     'recruitment',     'new',         v_sales, v_branch, 16000, 'مهتم باستقدام عاملة منزلية فلبينية'),
    ('منيرة اليامي',     '0555100202', 'call_center', 'monthly_rental',  'contacted',   v_sales, v_branch, 7500,  'طلبت تأجير شهري لسائق'),
    ('سعد الوادعي',      '0555100203', 'referral',    'recruitment',     'quoted',      v_sales, v_branch, 15500, 'أُرسل عرض سعر — بانتظار الرد'),
    ('حصة آل سالم',      '0555100204', 'walk_in',     'daily_rental',    'negotiation', v_sales, v_branch, 900,   'تفاوض على سعر التأجير اليومي'),
    ('فيصل القحطاني',    '0555100205', 'campaign',    'sponsorship_transfer','contacted', v_sales, v_branch, 5000, 'نقل كفالة سائق خاص'),
    ('نوف آل حمدان',     '0555100206', 'website',     'recruitment',     'won',         v_sales, v_branch, 17000, 'تم التعاقد ✓'),
    ('بدر الفيفي',       '0555100207', 'referral',    'monthly_rental',  'lost',        v_sales, v_branch, 6800,  'اختار مكتباً آخر');

  -- a scheduled follow-up (reminder) on the negotiation lead + a logged call
  select id into v_lead from leads where assigned_to = v_sales and stage_code = 'negotiation' limit 1;
  if v_lead is not null then
    insert into lead_activities (lead_id, kind, note, follow_up_at, created_by) values
      (v_lead, 'call', 'اتصلت وشرحت العرض', now() - interval '1 day', v_sales),
      (v_lead, 'whatsapp', 'متابعة عرض التأجير اليومي', now() + interval '1 day', v_sales);
  end if;

  -- a sent quote on the quoted lead
  select id into v_lead from leads where assigned_to = v_sales and stage_code = 'quoted' limit 1;
  if v_lead is not null then
    insert into quotes (lead_id, service_code, base_amount, vat_amount, total_amount, status, valid_until, assigned_to, branch_id, created_by)
    values (v_lead, 'recruitment', 15500, 2325, 17825, 'sent', current_date + 7, v_sales, v_branch, v_sales);
  end if;

  -- monthly target for the sales rep (reuse targets/target_progress)
  insert into targets (user_id, branch_id, month, year, contracts_target, renewal_target, collection_target)
  values (v_sales, v_branch, extract(month from current_date)::int, extract(year from current_date)::int, 12, 3, 90000)
  on conflict (user_id, month, year) do nothing;
end $$;
