-- =============================================================
-- 0076 — المرحلة ط: الأداء
--   1) perf_criteria: معايير التقييم قابلة للإدارة (الاسم، الوزن، المصدر، الأدوار)؛
--      المصدر: يدوي · عدد العقود مقابل المستهدف · قيمة المبيعات مقابل المستهدف ·
--      الانضباط من الحضور.
--   2) perf_bands: شرائح التقدير (ممتاز/جيد جدًا/…) بحد أدنى قابل للتعديل.
--   3) targets (0006): يُستخدم كما هو مع عمود قيمة المبيعات المستهدفة + سياسات
--      RLS (كانت مفعّلة بلا سياسات ⇒ لا يقرؤها أحد).
--   4) الإنجاز الفعلي من sales (عقود معتمدة لكل موظف، تُنشأ آليًا من العقود) ومن
--      attendance — لا إدخال يدوي للأرقام.
--   5) save_performance_review: حساب موزون على الخادم + لقطة مجمّدة للمعايير؛
--      التعديل متاح (يُعاد الحساب) والأرشفة بدل الحذف، ولا يقيّم الموظف نفسه.
-- =============================================================

-- ---------- 1) criteria ----------------------------------------------------------
create table if not exists perf_criteria (
  code       text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name_ar    text not null check (length(btrim(name_ar)) between 1 and 60),
  source     text not null default 'manual'
             check (source in ('manual','sales_count','sales_amount','attendance')),
  weight     numeric(5,2) not null check (weight > 0 and weight <= 100),
  roles      text[] not null default '{}',          -- empty = every role
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
create unique index if not exists perf_criteria_name_uq on perf_criteria (btrim(name_ar));

insert into perf_criteria (code, name_ar, source, weight, roles, sort_order) values
  ('quality',      'جودة العمل وإتقانه',          'manual',       25, '{}', 1),
  ('discipline',   'الانضباط والالتزام بالدوام',  'attendance',   20, '{}', 2),
  ('teamwork',     'التعاون والعمل الجماعي',      'manual',       15, '{}', 3),
  ('customers',    'خدمة العملاء والتعامل',       'manual',       15, '{}', 4),
  ('contracts',    'تحقيق مستهدف عدد العقود',     'sales_count',  15, '{sales,call_center,branch_manager}', 5),
  ('sales_value',  'تحقيق مستهدف قيمة المبيعات',  'sales_amount', 10, '{sales,call_center,branch_manager}', 6)
on conflict do nothing;

-- ---------- 2) rating bands --------------------------------------------------------
create table if not exists perf_bands (
  code       text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name_ar    text not null check (length(btrim(name_ar)) between 1 and 40),
  min_score  numeric(5,2) not null check (min_score between 0 and 100),
  tone       text not null default 'navy' check (tone in ('success','gold','danger','navy')),
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into perf_bands (code, name_ar, min_score, tone) values
  ('excellent', 'ممتاز', 90, 'success'), ('very_good', 'جيد جدًا', 80, 'success'),
  ('good', 'جيد', 70, 'gold'), ('needs', 'يحتاج تحسين', 0, 'danger')
on conflict do nothing;

create or replace function perf_rating(p_score numeric) returns text
language sql stable security definer set search_path = public as $$
  select name_ar from perf_bands where is_active and min_score <= p_score
   order by min_score desc limit 1
$$;

-- late day = part of a present day (managed)
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('perf_late_day_weight', 'يوم التأخير يُحتسب في تقييم الانضباط كنسبة من يوم حضور', 'الموارد البشرية', 0.5, 'يوم', 41)
on conflict (key) do nothing;
alter table app_config drop constraint if exists app_config_perf_late_chk;
alter table app_config add constraint app_config_perf_late_chk
  check (key <> 'perf_late_day_weight' or value between 0 and 1);

-- ---------- 3) targets (existing table) --------------------------------------------
alter table targets
  add column if not exists sales_amount_target numeric(12,2) not null default 0,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();
alter table targets drop constraint if exists targets_values_chk;
alter table targets add constraint targets_values_chk check (
  coalesce(contracts_target, 0) >= 0 and coalesce(sales_amount_target, 0) >= 0
  and coalesce(collection_target, 0) >= 0 and coalesce(renewal_target, 0) >= 0);

-- the generic branch policies (targets_b_*) let ANY branch user write targets
-- (a seller could set her own) — replaced by the rules below
drop policy if exists targets_b_read on targets;
drop policy if exists targets_b_write on targets;
drop policy if exists targets_read on targets;
drop policy if exists targets_insert on targets;
drop policy if exists targets_update on targets;
create policy targets_read on targets for select to authenticated using (
  user_id = auth.uid()
  or (has_perm('hr','view') and in_my_branch(branch_id))
  or has_perm('targets','view') and in_my_branch(branch_id));
create policy targets_insert on targets for insert to authenticated
  with check (has_perm('hr','manage'));
create policy targets_update on targets for update to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

-- ---------- 4) reviews: period, snapshot, notes ---------------------------------------
alter table performance_reviews
  add column if not exists period_from date,
  add column if not exists period_to   date,
  add column if not exists criteria    jsonb not null default '[]',
  add column if not exists notes       text,
  add column if not exists reviewer_id uuid references auth.users(id) on delete set null,
  add column if not exists updated_at  timestamptz not null default now();
alter table performance_reviews drop constraint if exists perf_period_chk;
alter table performance_reviews add constraint perf_period_chk
  check (period_from is null or period_to is null or period_from <= period_to);

-- achievement from real data (sales from contracts, attendance)
create or replace function perf_auto_scores(p_employee uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid; v_cnt numeric; v_amt numeric; v_tc numeric; v_ta numeric;
  v_present numeric; v_late numeric; v_absent numeric; v_w numeric; v_days numeric;
  pct numeric;
begin
  if not hr_can_see(p_employee) then
    raise exception 'غير مصرّح بأداء هذا الموظف' using errcode = '42501';
  end if;
  select user_id into v_user from employees where id = p_employee;
  select count(*), coalesce(sum(net_amount), 0) into v_cnt, v_amt from sales
   where v_user is not null and sold_by = v_user and status <> 'cancelled'
     and sold_at::date between p_from and p_to;
  select coalesce(sum(contracts_target), 0), coalesce(sum(sales_amount_target), 0) into v_tc, v_ta
    from targets
   where v_user is not null and user_id = v_user
     and make_date(year, month, 1) between date_trunc('month', p_from)::date and p_to;
  select count(*) filter (where status = 'present'), count(*) filter (where status = 'late'),
         count(*) filter (where status = 'absent')
    into v_present, v_late, v_absent
    from attendance where employee_id = p_employee and date between p_from and p_to;
  v_w := coalesce((select value from app_config where key = 'perf_late_day_weight'), 0.5);
  v_days := v_present + v_late + v_absent;
  return jsonb_build_object(
    'sales_count', jsonb_build_object('achieved', v_cnt, 'target', v_tc,
       'score', case when v_tc > 0 then least(100, round(v_cnt / v_tc * 100, 2)) end),
    'sales_amount', jsonb_build_object('achieved', v_amt, 'target', v_ta,
       'score', case when v_ta > 0 then least(100, round(v_amt / v_ta * 100, 2)) end),
    'attendance', jsonb_build_object('present', v_present, 'late', v_late, 'absent', v_absent,
       'score', case when v_days > 0 then round((v_present + v_late * v_w) / v_days * 100, 2) end));
end $$;

-- the only way to write scores: weighted on the server, snapshot frozen in the row
create or replace function save_performance_review(
  p_id uuid, p_employee uuid, p_period text, p_from date, p_to date,
  p_manual jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e employees%rowtype; r performance_reviews%rowtype; v_auto jsonb; v_crit jsonb := '[]';
  c record; v_score numeric; v_sum numeric := 0; v_w numeric := 0; v_total numeric; v_id uuid;
  v_defs jsonb;
begin
  if p_id is not null then
    select * into r from performance_reviews where id = p_id for update;
    if not found then raise exception 'التقييم غير موجود'; end if;
    if not r.is_active then raise exception 'التقييم مؤرشف — استرجعه أولاً'; end if;
    p_employee := r.employee_id;
  end if;
  select * into e from employees where id = p_employee;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if not (has_perm('hr','edit') and hr_in_scope(p_employee)) then
    raise exception 'تقييم الأداء من صلاحية الموارد البشرية أو مدير الفرع' using errcode = '42501';
  end if;
  if e.user_id is not null and e.user_id = auth.uid() then
    raise exception 'لا يقيّم الموظف نفسه' using errcode = '42501';
  end if;
  if coalesce(btrim(p_period), '') = '' then raise exception 'حدّد فترة التقييم'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'فترة التقييم غير صحيحة'; end if;

  v_auto := perf_auto_scores(p_employee, p_from, p_to);
  -- an edit keeps the criteria (and weights) the review was made with
  if p_id is not null and jsonb_array_length(r.criteria) > 0 then
    v_defs := r.criteria;
  else
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name_ar, 'source', source,
             'weight', weight) order by sort_order), '[]') into v_defs
      from perf_criteria
     where is_active and (cardinality(roles) = 0 or e.role = any(roles));
  end if;
  if jsonb_array_length(v_defs) = 0 then raise exception 'لا توجد معايير تقييم مفعّلة لهذا الدور'; end if;

  for c in select x->>'code' as code, x->>'name' as name, x->>'source' as source,
                  (x->>'weight')::numeric as weight from jsonb_array_elements(v_defs) x loop
    if c.source = 'manual' then
      if p_manual is null or not (p_manual ? c.code) or jsonb_typeof(p_manual->c.code) <> 'number' then
        raise exception 'أدخل درجة «%»', c.name;
      end if;
      v_score := (p_manual->>c.code)::numeric;
      if v_score < 0 or v_score > 100 then raise exception 'درجة «%» بين 0 و100', c.name; end if;
    else
      v_score := (v_auto->c.source->>'score')::numeric;   -- null = no target / no attendance
    end if;
    v_crit := v_crit || jsonb_build_object('code', c.code, 'name', c.name, 'source', c.source,
      'weight', c.weight, 'score', v_score,
      'detail', case when c.source <> 'manual' then v_auto->c.source end);
    if v_score is not null then
      v_sum := v_sum + c.weight * v_score;
      v_w := v_w + c.weight;
    end if;
  end loop;
  if v_w = 0 then raise exception 'لا توجد درجات كافية لحساب التقييم'; end if;
  v_total := round(v_sum / v_w, 2);

  perform set_config('masea.perf_save', 'on', true);
  if p_id is null then
    insert into performance_reviews (employee_id, period, period_from, period_to, score, criteria,
      notes, reviewer_id, reviewer_name, review_date)
    values (p_employee, btrim(p_period), p_from, p_to, v_total, v_crit, nullif(btrim(p_notes), ''),
      auth.uid(), (select full_name from user_profiles where id = auth.uid()), current_date)
    returning id into v_id;
  else
    update performance_reviews set period = btrim(p_period), period_from = p_from, period_to = p_to,
      score = v_total, criteria = v_crit, notes = nullif(btrim(p_notes), ''),
      reviewer_id = auth.uid(), reviewer_name = (select full_name from user_profiles where id = auth.uid()),
      updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  perform set_config('masea.perf_save', 'off', true);
  return v_id;
end $$;

-- direct writes may only archive/restore; scores come from save_performance_review
create or replace function guard_performance_review() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('masea.perf_save', true), 'off') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'التقييم يُحفظ عبر نموذج التقييم (حساب موزون)' using errcode = '42501';
  end if;
  if new.score is distinct from old.score or new.criteria is distinct from old.criteria
     or new.employee_id is distinct from old.employee_id or new.period is distinct from old.period
     or new.period_from is distinct from old.period_from or new.period_to is distinct from old.period_to then
    raise exception 'تعديل الدرجات عبر نموذج التقييم فقط' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_guard_performance_review on performance_reviews;
create trigger trg_guard_performance_review before insert or update on performance_reviews
  for each row execute function guard_performance_review();

grant execute on function perf_rating(numeric), perf_auto_scores(uuid, date, date),
  save_performance_review(uuid, uuid, text, date, date, jsonb, text) to authenticated;

-- ---------- RLS + audit ---------------------------------------------------------------
alter table perf_criteria enable row level security;
alter table perf_bands enable row level security;
drop policy if exists perf_criteria_read on perf_criteria;
drop policy if exists perf_criteria_write on perf_criteria;
drop policy if exists perf_criteria_update on perf_criteria;
create policy perf_criteria_read on perf_criteria for select to authenticated using (true);
create policy perf_criteria_write on perf_criteria for insert to authenticated with check (has_perm('hr','manage'));
create policy perf_criteria_update on perf_criteria for update to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
drop policy if exists perf_bands_read on perf_bands;
drop policy if exists perf_bands_write on perf_bands;
drop policy if exists perf_bands_update on perf_bands;
create policy perf_bands_read on perf_bands for select to authenticated using (true);
create policy perf_bands_write on perf_bands for insert to authenticated with check (has_perm('hr','manage'));
create policy perf_bands_update on perf_bands for update to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

do $$
declare t text;
begin
  foreach t in array array['perf_criteria','perf_bands','targets'] loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I
                    for each row execute function audit_row_change()', t);
  end loop;
end $$;
