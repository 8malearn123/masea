-- =============================================================
-- 0099 — بيانات الحملات (المنصة، الفرع، الميزانية، المصروف، المسؤول، الحالة)
--        + تقارير مصادر العملاء والعقود والإيرادات
-- (docs/plans/marketing-attribution-plan.md — المرحلتان 2 و3)
--
-- كل الأرقام من قاعدة البيانات الفعلية — لا بيانات افتراضية:
--   * قيمة العقود  = إجمالي العقود غير الملغاة (شامل الضريبة) + صافيها قبل الضريبة
--   * الإيراد المحقق = صافي العقود الموقّعة قبل الضريبة (الإيراد المُرحَّل عند التوقيع 0089)
--                      ناقص الإشعارات الدائنة قبل الضريبة (0097)
--   * المحصّل       = الدفعات المستلمة فعلاً (0096) — لا المعلّقة ولا المرتجعة
--   * المصروف      = قيود campaign_spend للحملات على المنصة في الفترة
--   CPL = المصروف ÷ العملاء المحتملين · CAC = المصروف ÷ العملاء الجدد المتعاقدين
--   ROAS = الإيراد المحقق ÷ المصروف (يُرجَع null عند عدم وجود مصروف)
-- العقد يُنسب للمصدر حسب النموذج: «اكتساب» (مصدر العميل الأصلي — لقطة العقد)
-- أو «عقد» (مصدر العقد الحالي). العميل يُعدّ مرة واحدة (فريد).
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) campaigns ---------------------------------------------------------------
alter table campaigns add column if not exists platform_code text references lead_sources(code);
alter table campaigns add column if not exists branch_id uuid references branches(id) on delete set null;
alter table campaigns add column if not exists budget numeric(14,2) check (budget is null or budget >= 0);
alter table campaigns add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table campaigns add column if not exists extended_until timestamptz;

-- الحالة محسوبة من التفعيل والتواريخ (لا تبقى «نشطة» بعد انتهائها)
create or replace function campaign_status(p campaigns) returns text
language sql stable as $$
  select case
    when not p.is_active then 'paused'
    when p.start_at is not null and now() < p.start_at then 'scheduled'
    when coalesce(p.extended_until, p.end_at) is not null and now() > coalesce(p.extended_until, p.end_at) then 'ended'
    else 'active' end
$$;

create table if not exists campaign_spend (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete restrict,
  spend_date  date not null,
  amount      numeric(14,2) not null check (amount > 0),
  reference   text,
  note        text,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_campaign_spend on campaign_spend(campaign_id, spend_date);
alter table campaign_spend enable row level security;
drop policy if exists cs_read on campaign_spend;
create policy cs_read on campaign_spend for select to authenticated
  using (has_perm('loyalty', 'view') or has_perm('reports', 'view'));
drop policy if exists cs_write on campaign_spend;
create policy cs_write on campaign_spend for insert to authenticated
  with check (has_perm('loyalty', 'manage'));
-- قيد المصروف لا يُعدَّل ولا يُحذف — التصحيح بقيد سالب غير مسموح؛ يُسجَّل قيد جديد بالمبلغ الصحيح وتُلغى السابقة بقيد مرتبط
alter table campaign_spend add column if not exists reverses_id uuid references campaign_spend(id);
alter table campaign_spend drop constraint if exists campaign_spend_amount_check;
alter table campaign_spend add constraint campaign_spend_amount_check
  check ((reverses_id is null and amount > 0) or (reverses_id is not null and amount < 0));
create or replace function campaign_spend_guard() returns trigger language plpgsql as $$
begin raise exception 'قيد المصروف لا يُعدَّل ولا يُحذف — سجّل قيد عكس'; end $$;
drop trigger if exists trg_campaign_spend_guard on campaign_spend;
create trigger trg_campaign_spend_guard before update or delete on campaign_spend
  for each row execute function campaign_spend_guard();
drop trigger if exists trg_audit_row on campaign_spend;
create trigger trg_audit_row after insert on campaign_spend for each row execute function audit_row_change();

create or replace function add_campaign_spend(p_campaign uuid, p_date date, p_amount numeric,
                                              p_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية تسجيل مصروف الحملات'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_date is null or p_date > current_date then raise exception 'تاريخ المصروف لا يكون في المستقبل'; end if;
  if not exists (select 1 from campaigns where id = p_campaign) then raise exception 'الحملة غير موجودة'; end if;
  insert into campaign_spend (campaign_id, spend_date, amount, reference, note)
  values (p_campaign, p_date, round(p_amount, 2), nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function add_campaign_spend(uuid, date, numeric, text, text) to authenticated;

create or replace function reverse_campaign_spend(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s campaign_spend%rowtype; v_id uuid;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية تعديل مصروف الحملات'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'سبب العكس مطلوب'; end if;
  select * into s from campaign_spend where id = p_id;
  if not found or s.reverses_id is not null then raise exception 'القيد غير موجود أو قيد عكس'; end if;
  if exists (select 1 from campaign_spend where reverses_id = p_id) then raise exception 'القيد معكوس مسبقاً'; end if;
  insert into campaign_spend (campaign_id, spend_date, amount, reference, note, reverses_id)
  values (s.campaign_id, current_date, -s.amount, s.reference, 'عكس: ' || btrim(p_reason), p_id)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function reverse_campaign_spend(uuid, text) to authenticated;

-- ---------- 2) report helpers ----------------------------------------------------------------
create or replace function marketing_can_view() returns boolean language sql stable as $$
  select has_perm('reports', 'view') or has_perm('loyalty', 'view')
$$;

-- نطاق الفرع: غير المخوّل بكل الفروع يرى فرعه فقط
create or replace function marketing_branch_scope(p_branch uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when is_cross_branch() then p_branch else get_my_branch() end
$$;

create or replace function contract_credit_net(p_contract uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(subtotal), 0) from sales_credit_notes where contract_id = p_contract
$$;

-- ---------- 3) per source -----------------------------------------------------------------------
create or replace function marketing_source_report(
  p_from date, p_to date, p_branch uuid default null, p_service text default null,
  p_model text default 'acquisition')
returns table (
  source_code text, leads bigint, converted_leads bigint, customers bigint, new_customers bigint,
  contracts bigint, contract_value numeric, contract_net numeric, revenue numeric, collected numeric,
  spend numeric, conversion_rate numeric, cpl numeric, cac numeric, roas numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_branch uuid := marketing_branch_scope(p_branch);
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية تقارير التسويق'; end if;
  if p_model not in ('acquisition', 'contract') then raise exception 'نموذج النسبة غير صحيح'; end if;
  return query
  with k as (   -- عقود الفترة (غير الملغاة) منسوبة للمصدر حسب النموذج
    select c.id, c.customer_id, c.total_amount, c.base_amount, c.status::text as st,
           case when p_model = 'contract' then coalesce(c.source_code, c.acquisition_source_code)
                else c.acquisition_source_code end as src
      from contracts c
     where c.status::text <> 'cancelled'
       and c.created_at::date between p_from and p_to
       and (v_branch is null or c.branch_id = v_branch)
       and (p_service is null or c.service_code = p_service)
  ), kp as (
    select k.*, coalesce((select sum(p.amount) from payments p where p.contract_id = k.id and p.status = 'received'), 0) as paid,
           case when contract_is_sold(k.st) then k.base_amount - contract_credit_net(k.id) else 0 end as rev
      from k
  ), first_k as (  -- أول عقد للعميل على الإطلاق — «عميل جديد متعاقد» إن وقع في الفترة
    select distinct on (c.customer_id) c.customer_id, c.id
      from contracts c where c.status::text <> 'cancelled'
     order by c.customer_id, c.created_at
  ), l as (
    select l.source_code as src, l.customer_id
      from leads l
     where l.created_at::date between p_from and p_to
       and (v_branch is null or l.branch_id = v_branch)
       and (p_service is null or l.service_code = p_service)
  ), cu as (   -- العملاء الفريدون حسب مصدر الاكتساب (أول تواصل في الفترة)
    select c.acquisition_source_code as src, c.id
      from customers c
     where coalesce(c.first_contact_at, c.created_at::date) between p_from and p_to
       and (v_branch is null or c.branch_id = v_branch)
  ), sp as (
    select cp.platform_code as src, sum(s.amount) as amt
      from campaign_spend s join campaigns cp on cp.id = s.campaign_id
     where s.spend_date between p_from and p_to
       and (v_branch is null or cp.branch_id is null or cp.branch_id = v_branch)
       and (p_service is null or cp.service_codes is null or cardinality(cp.service_codes) = 0 or p_service = any(cp.service_codes))
     group by cp.platform_code
  ), srcs as (
    select src from kp union select src from l union select src from cu union select src from sp
  )
  select s.src,
         (select count(*) from l where l.src is not distinct from s.src),
         (select count(*) from l where l.src is not distinct from s.src and l.customer_id is not null
            and exists (select 1 from contracts c where c.customer_id = l.customer_id and c.status::text <> 'cancelled')),
         (select count(*) from cu where cu.src is not distinct from s.src),
         (select count(distinct kp.customer_id) from kp join first_k f on f.id = kp.id where kp.src is not distinct from s.src),
         (select count(*) from kp where kp.src is not distinct from s.src),
         coalesce((select sum(kp.total_amount) from kp where kp.src is not distinct from s.src), 0),
         coalesce((select sum(kp.base_amount) from kp where kp.src is not distinct from s.src), 0),
         coalesce((select sum(kp.rev) from kp where kp.src is not distinct from s.src), 0),
         coalesce((select sum(kp.paid) from kp where kp.src is not distinct from s.src), 0),
         coalesce((select sp.amt from sp where sp.src is not distinct from s.src), 0),
         null::numeric, null::numeric, null::numeric, null::numeric
    from srcs s;
end $$;
grant execute on function marketing_source_report(date, date, uuid, text, text) to authenticated;

-- المؤشرات المشتقة تُحسب في دالة مستقلة لتبقى القسمة على صفر = null صريحاً
create or replace function marketing_sources(
  p_from date, p_to date, p_branch uuid default null, p_service text default null,
  p_model text default 'acquisition')
returns table (
  source_code text, leads bigint, converted_leads bigint, customers bigint, new_customers bigint,
  contracts bigint, contract_value numeric, contract_net numeric, revenue numeric, collected numeric,
  spend numeric, conversion_rate numeric, cpl numeric, cac numeric, roas numeric)
language sql stable security definer set search_path = public as $$
  select r.source_code, r.leads, r.converted_leads, r.customers, r.new_customers, r.contracts,
         r.contract_value, r.contract_net, r.revenue, r.collected, r.spend,
         case when r.leads > 0 then round(r.converted_leads::numeric / r.leads, 4) end,
         case when r.spend > 0 and r.leads > 0 then round(r.spend / r.leads, 2) end,
         case when r.spend > 0 and r.new_customers > 0 then round(r.spend / r.new_customers, 2) end,
         case when r.spend > 0 then round(r.revenue / r.spend, 2) end
    from marketing_source_report(p_from, p_to, p_branch, p_service, p_model) r
   order by r.contract_value desc, r.leads desc
$$;
grant execute on function marketing_sources(date, date, uuid, text, text) to authenticated;

-- ---------- 4) per campaign ----------------------------------------------------------------------
create or replace function marketing_campaigns(p_from date, p_to date, p_branch uuid default null)
returns table (
  campaign_id uuid, name text, platform_code text, branch_id uuid, status text, start_at timestamptz,
  end_at timestamptz, budget numeric, owner_id uuid, spend numeric, leads bigint, contracts bigint,
  contract_value numeric, revenue numeric, collected numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_branch uuid := marketing_branch_scope(p_branch);
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية تقارير التسويق'; end if;
  return query
  select cp.id, cp.name, cp.platform_code, cp.branch_id, campaign_status(cp), cp.start_at,
         coalesce(cp.extended_until, cp.end_at), cp.budget, cp.owner_id,
         coalesce((select sum(s.amount) from campaign_spend s where s.campaign_id = cp.id
                    and s.spend_date between p_from and p_to), 0),
         (select count(*) from leads l where l.campaign_id = cp.id and l.created_at::date between p_from and p_to),
         (select count(*) from contracts c where c.campaign_id = cp.id and c.status::text <> 'cancelled'
            and c.created_at::date between p_from and p_to),
         coalesce((select sum(c.total_amount) from contracts c where c.campaign_id = cp.id
                    and c.status::text <> 'cancelled' and c.created_at::date between p_from and p_to), 0),
         coalesce((select sum(c.base_amount - contract_credit_net(c.id)) from contracts c where c.campaign_id = cp.id
                    and contract_is_sold(c.status::text) and c.created_at::date between p_from and p_to), 0),
         coalesce((select sum(p.amount) from payments p join contracts c on c.id = p.contract_id
                    where c.campaign_id = cp.id and p.status = 'received' and c.status::text <> 'cancelled'
                      and c.created_at::date between p_from and p_to), 0)
    from campaigns cp
   where v_branch is null or cp.branch_id is null or cp.branch_id = v_branch
   order by cp.start_at desc nulls last;
end $$;
grant execute on function marketing_campaigns(date, date, uuid) to authenticated;

-- ---------- 5) breakdown: by branch / employee / service ------------------------------------------
create or replace function marketing_breakdown(
  p_from date, p_to date, p_dim text, p_branch uuid default null, p_campaign uuid default null)
returns table (dim_key text, dim_label text, source_code text, contracts bigint,
               contract_value numeric, revenue numeric, collected numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_branch uuid := marketing_branch_scope(p_branch);
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية تقارير التسويق'; end if;
  if p_dim not in ('branch', 'employee', 'service') then raise exception 'البُعد غير صحيح'; end if;
  return query
  select case p_dim when 'branch' then c.branch_id::text when 'employee' then c.created_by::text else c.service_code end,
         case p_dim when 'branch' then max(b.city) when 'employee' then max(u.full_name) else max(sv.name_ar) end,
         coalesce(c.source_code, c.acquisition_source_code),
         count(*),
         sum(c.total_amount),
         sum(case when contract_is_sold(c.status::text) then c.base_amount - contract_credit_net(c.id) else 0 end),
         sum(coalesce((select sum(p.amount) from payments p where p.contract_id = c.id and p.status = 'received'), 0))
    from contracts c
    left join branches b on b.id = c.branch_id
    left join user_profiles u on u.id = c.created_by
    left join services sv on sv.code = c.service_code
   where c.status::text <> 'cancelled' and c.created_at::date between p_from and p_to
     and (v_branch is null or c.branch_id = v_branch)
     and (p_campaign is null or c.campaign_id = p_campaign)
   group by 1, 3;
end $$;
grant execute on function marketing_breakdown(date, date, text, uuid, uuid) to authenticated;
