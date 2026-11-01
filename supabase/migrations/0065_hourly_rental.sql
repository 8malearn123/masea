-- =============================================================
-- Masiat Alsharq ERP — 0065 Hourly rental (المرحلة 4)
-- خدمة مستقلة «تأجير بالساعة» لا تمس التأجير اليومي:
--   • services: hourly_rental (وحدة: ساعة) + قواعد سعر للساعة حسب المهمة.
--   • pricing_rules.branch_id: سعر خاص بفرع عند الحاجة (اختياري) — calc_price
--     يفضّل قاعدة الفرع ثم العامة. لا تغيير على أي سعر قائم.
--   • app_config: أدنى/أقصى عدد ساعات (4/12) وفاصل بين حجزين وحصة الدقائق.
--   • worker_bookings: حجز العاملة بالساعة (تاريخ + وصول + انصراف)، والتعارض
--     ممنوع في قاعدة البيانات بقيد استبعاد (exclusion) على فترة العاملة.
--     بداية الخدمة ونهايتها الفعليتان تُسجَّلان (check-in / check-out).
--   • book_hourly(): تسعير + فحص توفّر + حجز + طلب تشغيلي + مسودة عقد مرتبطة.
--   • عرض السعر للساعة (start_time/end_time) وتحويله لعقد ينشئ الحجز.
--   • submit_service_request / track_service_request: دالتا الموقع العام اللتان
--     كانت الواجهة تستدعيهما ولم تكونا موجودتين (الطلبات لم تصل القاعدة).
-- التراجع: supabase/rollback/0065_hourly_rental_down.sql
-- =============================================================

create extension if not exists btree_gist;

-- ---------- 1) the service + config ---------------------------------------------
insert into services (code, name_ar, tagline_ar, description_ar, icon, unit, sort_order, contract_origin) values
  ('hourly_rental', 'تأجير بالساعة', 'عاملة لساعات محددة',
   'احجز عاملة من 4 إلى 12 ساعة في يوم واحد: تنظيف، طبخ، أو رعاية — بوقت وصول وانصراف محددين.',
   'clock', 'hour', 5, 'internal')
on conflict (code) do nothing;

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('hourly_min_hours',        'التأجير بالساعة — الحد الأدنى',            'التأجير بالساعة', 4,  'ساعة', 1),
  ('hourly_max_hours',        'التأجير بالساعة — الحد الأقصى',            'التأجير بالساعة', 12, 'ساعة', 2),
  ('hourly_buffer_minutes',   'فاصل إلزامي بين حجزين لنفس العاملة',       'التأجير بالساعة', 30, 'دقيقة', 3),
  ('hourly_slot_minutes',     'وحدة احتساب الوقت (الحجز بمضاعفاتها)',     'التأجير بالساعة', 30, 'دقيقة', 4)
on conflict (key) do nothing;

-- own permission module (sidebar + RLS), granted like dispatch/booking duties
insert into permissions (module, action, label)
select 'hourly', a.code, a.name_ar || ' التأجير بالساعة'
from (values ('view','عرض'),('create','حجز'),('edit','تحديث'),('delete','حذف'),('approve','اعتماد'),('export','تصدير')) as a(code, name_ar)
where not exists (select 1 from permissions p where p.module = 'hourly' and p.action = a.code);
insert into role_permissions (role_code, module, action)
select g.role_code, 'hourly', act
from (values
  ('admin',              array['view','create','edit','delete','approve','export']),
  ('operations_manager', array['view','create','edit','delete','approve','export']),
  ('branch_manager',     array['view','create','edit','delete','approve','export']),
  ('sales',              array['view','create','edit']),
  ('call_center',        array['view','create'])
) as g(role_code, acts)
cross join lateral unnest(g.acts) as act
on conflict do nothing;

-- ---------- 2) branch-specific prices -----------------------------------------
alter table pricing_rules add column if not exists branch_id uuid references branches(id) on delete cascade;
create index if not exists idx_pricing_rules_branch on pricing_rules(branch_id) where branch_id is not null;

-- per-hour prices by task (editable from التسعير)
insert into pricing_rules (service_code, profession, base_price, min_price, duration_unit, is_active)
select 'hourly_rental', v.profession, v.price, v.floor, 'hour', true
from (values (null::text, 45::numeric, 40::numeric), ('تنظيف', 40, 36), ('طبخ', 50, 45), ('رعاية', 55, 50)) as v(profession, price, floor)
where not exists (select 1 from pricing_rules r where r.service_code = 'hourly_rental'
                  and r.profession is not distinct from v.profession and r.branch_id is null);

-- calc_price (0056) + branch preference; everything else unchanged
create or replace function calc_price(p_service_code text, p_params jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cfg        pricing_config%rowtype;
  v_qty        numeric := greatest(coalesce((p_params->>'quantity')::numeric, 1), 1);
  v_nat        text    := nullif(p_params->>'nationality', '');
  v_prof       text    := nullif(p_params->>'profession', '');
  v_branch     uuid    := coalesce(nullif(p_params->>'branch_id', '')::uuid,
                                   resolve_branch_id(nullif(p_params->>'branch', '')));
  v_promo_id   uuid    := nullif(p_params->>'promotion_id', '')::uuid;
  v_code       text    := nullif(btrim(coalesce(p_params->>'promotion_code', '')), '');
  v_rule       numeric(12,2);
  v_rule_min   numeric(12,2);
  v_base       numeric(12,2);
  v_floor      numeric(12,2);
  v_discounts  numeric(12,2) := 0;
  v_promo      jsonb;
  v_promo_amt  numeric(12,2) := 0;
  v_penalties  numeric(12,2) := 0;
  v_net        numeric(12,2);
  v_vat        numeric(12,2);
  v_total      numeric(12,2);
  v_late_days  integer := coalesce((p_params->>'late_days')::integer, 0);
  v_absence    integer := coalesce((p_params->>'absence_days')::integer, 0);
  v_late_pct   numeric(5,2);
  v_abs_perday numeric(12,2);
  v_abs_max    integer;
  v_result     jsonb;
begin
  select * into v_cfg from pricing_config where id = 1;

  select base_price, min_price into v_rule, v_rule_min
  from pricing_rules
  where service_code = p_service_code and is_active
    and (nationality is null or nationality = v_nat)
    and (profession  is null or profession  = v_prof)
    and (branch_id   is null or branch_id   = v_branch)
  order by (case when branch_id   is not null then 4 else 0 end)
         + (case when nationality is not null then 1 else 0 end)
         + (case when profession  is not null then 1 else 0 end) desc
  limit 1;
  v_base  := round(coalesce(v_rule, 0) * v_qty, 2);
  v_floor := round(coalesce(v_rule_min, 0) * v_qty, 2);

  if v_promo_id is null and v_code is not null then
    select id into v_promo_id from promotions where upper(code) = upper(v_code);
    if v_promo_id is null then
      v_promo := jsonb_build_object('ok', false, 'amount', 0, 'reason', 'رمز الكوبون غير صحيح');
    end if;
  end if;
  if v_promo_id is not null then
    v_promo := evaluate_promotion(v_promo_id, p_service_code, v_base, v_code);
  end if;
  if coalesce((v_promo->>'ok')::boolean, false) then
    v_promo_amt := (v_promo->>'amount')::numeric;
  end if;

  v_discounts := v_promo_amt + coalesce((p_params->>'wallet_redeem')::numeric, 0);
  if v_absence > 0 then
    v_abs_perday := coalesce((v_cfg.absence_compensation_rule->>'per_day')::numeric, 0);
    v_abs_max    := coalesce((v_cfg.absence_compensation_rule->>'max_days')::integer, 0);
    v_discounts  := v_discounts + round(v_abs_perday * least(v_absence, v_abs_max), 2);
  end if;
  v_discounts := least(round(v_discounts, 2), greatest(v_base - v_floor, 0));

  if v_late_days > v_cfg.late_grace_days then
    v_late_pct  := least(v_late_days * v_cfg.late_daily_pct, v_cfg.late_max_pct);
    v_penalties := v_penalties + round(v_base * v_late_pct / 100.0, 2);
  end if;
  if coalesce((p_params->>'cancelled')::boolean, false) then
    v_penalties := v_penalties + round(v_base * v_cfg.cancellation_pct / 100.0, 2);
  end if;

  v_net   := greatest(v_base - v_discounts + v_penalties, 0);
  v_vat   := round(v_net * v_cfg.vat_rate, 2);
  v_total := v_net + v_vat;

  v_result := jsonb_build_object(
    'base', v_base, 'discounts', v_discounts, 'penalties', v_penalties,
    'net', v_net, 'vat', v_vat, 'total', v_total,
    'promotion_id', v_promo_id,
    'promotion_ok', coalesce((v_promo->>'ok')::boolean, v_promo is null),
    'promotion_reason', v_promo->>'reason',
    'unit_price', coalesce(v_rule, 0)
  );

  insert into pricing_log (service_code, params, result, created_by)
  values (p_service_code, p_params, v_result, auth.uid());

  return v_result;
end;
$$;
grant execute on function calc_price(text, jsonb) to anon, authenticated;

-- ---------- 3) bookings ----------------------------------------------------------
create table if not exists worker_bookings (
  id                uuid primary key default gen_random_uuid(),
  booking_no        bigint generated by default as identity unique,
  worker_profile_id uuid not null references worker_profiles(id) on delete restrict,
  worker_name       text,
  branch_id         uuid references branches(id) on delete set null,
  service_code      text not null default 'hourly_rental' references services(code),
  profession        text,
  booking_date      date not null,
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  hours             numeric(5,2) not null check (hours > 0),
  buffer_minutes    integer not null default 0 check (buffer_minutes >= 0),
  period            tstzrange not null,          -- [start, end + buffer) — set by trigger
  status            text not null default 'booked'
                    check (status in ('booked','in_progress','completed','cancelled','no_show')),
  actual_start_at   timestamptz,
  actual_end_at     timestamptz,
  customer_id       uuid references customers(id) on delete set null,
  customer_name     text,
  customer_phone    text,
  address           text,
  hourly_rate       numeric(12,2) not null default 0,
  base_amount       numeric(12,2) not null default 0,
  discount_amount   numeric(12,2) not null default 0,
  vat_amount        numeric(12,2) not null default 0,
  total_amount      numeric(12,2) not null default 0,
  quote_id          uuid references quotes(id) on delete set null,
  contract_id       uuid references contracts(id) on delete set null,
  request_id        uuid references service_requests(id) on delete set null,
  notes             text,
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (end_at > start_at),
  -- a worker can never hold two live bookings that overlap (incl. the buffer)
  exclude using gist (worker_profile_id with =, period with &&)
    where (status in ('booked','in_progress'))
);
create index if not exists idx_bookings_date on worker_bookings(booking_date, branch_id);
create index if not exists idx_bookings_worker on worker_bookings(worker_profile_id, start_at);

create or replace function worker_bookings_period() returns trigger
language plpgsql as $$
begin
  new.period := tstzrange(new.start_at, new.end_at + make_interval(mins => new.buffer_minutes), '[)');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_bookings_period on worker_bookings;
create trigger trg_bookings_period before insert or update of start_at, end_at, buffer_minutes on worker_bookings
  for each row execute function worker_bookings_period();

alter table worker_bookings enable row level security;
drop policy if exists bookings_read on worker_bookings;
create policy bookings_read on worker_bookings for select to authenticated using (
  in_my_branch(branch_id) and (has_perm('hourly','view') or has_perm('orders','view'))
);
-- writes go through book_hourly / set_booking_status only

drop trigger if exists trg_audit_row on worker_bookings;
create trigger trg_audit_row after insert or update or delete on worker_bookings
  for each row execute function audit_row_change();

-- hourly quotes carry the arrival / leave time
alter table quotes add column if not exists start_time time, add column if not exists end_time time;

-- ---------- 4) price, availability, booking ------------------------------------
-- hours between two clock times, validated against the managed rules
create or replace function hourly_hours(p_start time, p_end time)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_hours numeric;
  v_min   numeric := coalesce((select value from app_config where key = 'hourly_min_hours'), 4);
  v_max   numeric := coalesce((select value from app_config where key = 'hourly_max_hours'), 12);
  v_slot  numeric := coalesce((select value from app_config where key = 'hourly_slot_minutes'), 30);
begin
  if p_start is null or p_end is null then raise exception 'حدّد ساعة الوصول وساعة الانصراف'; end if;
  if p_end <= p_start then raise exception 'ساعة الانصراف يجب أن تكون بعد ساعة الوصول (في نفس اليوم)'; end if;
  v_hours := extract(epoch from (p_end - p_start)) / 3600.0;
  if (extract(epoch from (p_end - p_start)) / 60.0)::numeric % v_slot <> 0 then
    raise exception 'المدة تُحتسب بمضاعفات % دقيقة', v_slot;
  end if;
  if v_hours < v_min then raise exception 'الحد الأدنى للتأجير بالساعة % ساعات', v_min; end if;
  if v_hours > v_max then raise exception 'الحد الأقصى للتأجير بالساعة % ساعة', v_max; end if;
  return round(v_hours, 2);
end $$;

-- free = no live booking of the worker overlapping [start, end + buffer)
create or replace function worker_is_free(p_worker uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from worker_bookings b
     where b.worker_profile_id = p_worker and b.status in ('booked','in_progress')
       and (p_exclude is null or b.id <> p_exclude)
       and b.period && tstzrange(p_start,
             p_end + make_interval(mins => coalesce((select value from app_config where key = 'hourly_buffer_minutes'), 0)::int), '[)')
  )
$$;

-- busy windows of every worker on a day, across branches — times only, no customer
-- data — so the booking form can show who is free even for another branch's booking
create or replace function worker_busy_slots(p_date date)
returns table(worker_profile_id uuid, start_time text, end_time text, status text)
language sql stable security definer set search_path = public as $$
  select b.worker_profile_id,
         to_char(b.start_at at time zone 'Asia/Riyadh', 'HH24:MI'),
         to_char(b.end_at at time zone 'Asia/Riyadh', 'HH24:MI'),
         b.status
    from worker_bookings b
   where b.booking_date = p_date and b.status in ('booked','in_progress')
     and (has_perm('hourly','view') or has_perm('orders','view'))
$$;

grant execute on function hourly_hours(time, time), worker_is_free(uuid, timestamptz, timestamptz, uuid), worker_busy_slots(date) to authenticated;

-- internal: insert one booking row (used by book_hourly and the quote conversion)
create or replace function _insert_hourly_booking(
  p_worker uuid, p_branch uuid, p_profession text, p_date date, p_start time, p_end time,
  p_customer uuid, p_customer_name text, p_customer_phone text, p_address text,
  p_price jsonb, p_hours numeric, p_quote uuid, p_contract uuid, p_request uuid, p_notes text
) returns worker_bookings language plpgsql security definer set search_path = public as $$
declare
  v_row    worker_bookings;
  v_tz     text := 'Asia/Riyadh';
  v_start  timestamptz := (p_date + p_start) at time zone v_tz;
  v_end    timestamptz := (p_date + p_end) at time zone v_tz;
  v_wp     worker_profiles;
begin
  select * into v_wp from worker_profiles where id = p_worker;
  if v_wp.id is null then raise exception 'العاملة غير موجودة'; end if;
  if v_wp.status <> 'available' then raise exception 'العاملة غير متاحة للحجز'; end if;
  if not worker_is_free(p_worker, v_start, v_end) then
    raise exception 'العاملة محجوزة في هذه الفترة — اختر وقتًا أو عاملة أخرى';
  end if;
  begin
    insert into worker_bookings (worker_profile_id, worker_name, branch_id, profession, booking_date,
                                 start_at, end_at, hours, buffer_minutes, customer_id, customer_name,
                                 customer_phone, address, hourly_rate, base_amount, discount_amount,
                                 vat_amount, total_amount, quote_id, contract_id, request_id, notes)
    values (p_worker, v_wp.full_name, p_branch, p_profession, p_date, v_start, v_end, p_hours,
            coalesce((select value from app_config where key = 'hourly_buffer_minutes'), 0)::int,
            p_customer, p_customer_name, p_customer_phone, p_address,
            coalesce((p_price->>'unit_price')::numeric, 0), (p_price->>'net')::numeric,
            coalesce((p_price->>'discounts')::numeric, 0), (p_price->>'vat')::numeric,
            (p_price->>'total')::numeric, p_quote, p_contract, p_request, p_notes)
    returning * into v_row;
  exception when exclusion_violation then
    -- a concurrent booking won the slot
    raise exception 'العاملة محجوزة في هذه الفترة — اختر وقتًا أو عاملة أخرى';
  end;
  return v_row;
end $$;

-- book directly (call center / branch): price + availability + order + draft contract
create or replace function book_hourly(p_input jsonb)
returns worker_bookings language plpgsql security definer set search_path = public as $$
declare
  v_branch   uuid := coalesce(resolve_branch_id(p_input->>'branch'), get_my_branch());
  v_date     date := (p_input->>'booking_date')::date;
  v_start    time := (p_input->>'start_time')::time;
  v_end      time := (p_input->>'end_time')::time;
  v_prof     text := nullif(p_input->>'profession', '');
  v_customer uuid := nullif(p_input->>'customer_id', '')::uuid;
  v_hours    numeric;
  v_price    jsonb;
  v_req      uuid;
  v_contract contracts;
  v_row      worker_bookings;
  v_clause   text;
  v_i        integer := 0;
begin
  if not has_perm('hourly','create') then
    raise exception 'لا تملك صلاحية حجز التأجير بالساعة';
  end if;
  if v_branch is null then raise exception 'حدّد الفرع'; end if;
  if not in_my_branch(v_branch) then raise exception 'لا يمكنك الحجز خارج نطاق فرعك'; end if;
  if v_date is null or v_date < (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'تاريخ الحجز لا يسبق اليوم';
  end if;
  v_hours := hourly_hours(v_start, v_end);
  if ((v_date + v_start) at time zone 'Asia/Riyadh') <= now() then
    raise exception 'وقت الوصول مضى — اختر وقتًا لاحقًا';
  end if;
  if v_customer is not null and not exists (select 1 from customers where id = v_customer and in_my_branch(branch_id)) then
    raise exception 'العميل خارج نطاق فرعك';
  end if;
  if length(btrim(coalesce(p_input->>'customer_name', ''))) < 3 and v_customer is null then
    raise exception 'اسم العميل مطلوب';
  end if;

  v_price := calc_price('hourly_rental', jsonb_strip_nulls(jsonb_build_object(
    'profession', v_prof, 'quantity', v_hours, 'branch_id', v_branch,
    'promotion_code', nullif(p_input->>'promotion_code', ''))));
  if (v_price->>'base')::numeric <= 0 then raise exception 'لا توجد قاعدة سعر نشطة للتأجير بالساعة'; end if;
  if not coalesce((v_price->>'promotion_ok')::boolean, true) then
    raise exception 'الخصم غير قابل للتطبيق: %', coalesce(v_price->>'promotion_reason', '');
  end if;

  if v_customer is null then
    insert into customers (full_name, phone, branch_id, address)
    values (btrim(p_input->>'customer_name'), nullif(p_input->>'customer_phone', ''), v_branch,
            nullif(p_input->>'address', ''))
    returning id into v_customer;
  end if;

  insert into contracts (contract_no, service_code, customer_id, branch_id, start_date, end_date,
                         gross_amount, discount_amount, promotion_id, base_amount, pricing_params,
                         status, created_by, issue_date, notes)
  values (generate_contract_no(), 'hourly_rental', v_customer, v_branch, v_date, v_date,
          (v_price->>'base')::numeric, (v_price->>'discounts')::numeric,
          case when (v_price->>'discounts')::numeric > 0 then nullif(v_price->>'promotion_id','')::uuid end,
          (v_price->>'net')::numeric,
          jsonb_build_object('profession', v_prof, 'quantity', v_hours, 'start_time', v_start, 'end_time', v_end),
          'draft', auth.uid(), current_date, nullif(p_input->>'notes', ''))
  returning * into v_contract;
  for v_clause in
    select jsonb_array_elements_text(coalesce(
      (select clauses from contract_templates where service_code = 'hourly_rental' and is_active limit 1), '[]'::jsonb))
  loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_contract.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;
  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_contract.id, null, 'draft', auth.uid());
  if v_contract.promotion_id is not null then   -- the coupon is consumed (same as contracts)
    update promotions set usage_count = usage_count + 1, updated_at = now() where id = v_contract.promotion_id;
  end if;

  insert into service_requests (service_code, branch_id, customer_id, worker_profile_id, customer_name,
                                customer_phone, base_amount, vat_amount, total_amount, status, contract_id, details)
  values ('hourly_rental', v_branch, v_customer, (p_input->>'worker_profile_id')::uuid,
          coalesce(nullif(btrim(p_input->>'customer_name'), ''), (select full_name from customers where id = v_customer)),
          nullif(p_input->>'customer_phone', ''),
          (v_price->>'net')::numeric, (v_price->>'vat')::numeric, (v_price->>'total')::numeric,
          'new', v_contract.id,
          jsonb_build_object('source', 'hourly_booking', 'booking_date', v_date,
                             'start_time', v_start, 'end_time', v_end, 'hours', v_hours, 'profession', v_prof))
  returning id into v_req;

  v_row := _insert_hourly_booking((p_input->>'worker_profile_id')::uuid, v_branch, v_prof, v_date, v_start, v_end,
                                  v_customer, coalesce(nullif(btrim(p_input->>'customer_name'), ''),
                                                       (select full_name from customers where id = v_customer)),
                                  nullif(p_input->>'customer_phone', ''), nullif(p_input->>'address', ''),
                                  v_price, v_hours, null, v_contract.id, v_req, nullif(p_input->>'notes', ''));
  return v_row;
end $$;

-- check-in / check-out / cancel / no-show
create or replace function set_booking_status(p_id uuid, p_status text, p_note text default null)
returns worker_bookings language plpgsql security definer set search_path = public as $$
declare v_row worker_bookings;
begin
  if not (has_perm('hourly','edit') or has_perm('orders','edit')) then
    raise exception 'لا تملك صلاحية تحديث الحجز';
  end if;
  select * into v_row from worker_bookings where id = p_id for update;
  if v_row.id is null then raise exception 'الحجز غير موجود'; end if;
  if not in_my_branch(v_row.branch_id) then raise exception 'هذا الحجز خارج نطاق فرعك'; end if;
  if not ((v_row.status = 'booked' and p_status in ('in_progress','cancelled','no_show'))
       or (v_row.status = 'in_progress' and p_status = 'completed')) then
    raise exception 'لا يمكن نقل الحجز من «%» إلى «%»', v_row.status, p_status;
  end if;
  update worker_bookings set status = p_status,
         actual_start_at = case when p_status = 'in_progress' then now() else actual_start_at end,
         actual_end_at   = case when p_status = 'completed' then now() else actual_end_at end,
         notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes)
   where id = p_id returning * into v_row;
  -- the service request follows the booking
  update service_requests set status = case p_status when 'in_progress' then 'processing'
                                                     when 'completed' then 'completed'
                                                     else 'cancelled' end
   where id = v_row.request_id;
  return v_row;
end $$;

grant execute on function book_hourly(jsonb), set_booking_status(uuid, text, text) to authenticated;

-- ---------- 5) hourly quotes → contract creates the booking ----------------------
create or replace function convert_quote_to_contract(p_quote_id uuid, p_branch text default null)
returns contracts language plpgsql security definer set search_path = public as $$
declare
  q          quotes;
  v_customer uuid;
  v_branch   uuid;
  v_row      contracts;
  v_req      uuid;
  v_clause   text;
  v_i        integer := 0;
  v_hours    numeric;
begin
  if not has_perm('contracts','create') then raise exception 'لا تملك صلاحية إنشاء العقود'; end if;
  select * into q from quotes where id = p_quote_id for update;
  if q.id is null then raise exception 'العرض غير موجود'; end if;
  if not can_act_on_sales_row(q.branch_id, q.assigned_to) then raise exception 'هذا العرض خارج نطاقك'; end if;
  if q.contract_id is not null then raise exception 'هذا العرض مرتبط بعقد مسبقًا'; end if;
  if q.status <> 'accepted' then raise exception 'لا يُحوَّل إلى عقد إلا العرض المقبول من العميل'; end if;
  if q.service_code = 'hourly_rental' then
    if q.worker_profile_id is null or q.start_date is null then
      raise exception 'عرض التأجير بالساعة يحتاج العاملة وتاريخ الحجز قبل تحويله لعقد';
    end if;
    v_hours := hourly_hours(q.start_time, q.end_time);
  end if;

  v_branch := coalesce(q.branch_id, resolve_branch_id(p_branch));
  if v_branch is null then raise exception 'حدّد فرع العقد'; end if;
  if not in_my_branch(v_branch) then raise exception 'لا يمكنك إنشاء عقد خارج نطاق فرعك'; end if;

  v_customer := q.customer_id;
  if v_customer is null and q.lead_id is not null then
    v_customer := (convert_lead_to_customer(q.lead_id)).id;
  end if;
  if v_customer is null and nullif(btrim(coalesce(q.customer_phone,'')), '') is not null then
    select id into v_customer from customers
     where branch_id = v_branch
       and right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = right(regexp_replace(q.customer_phone, '\D', '', 'g'), 9)
     order by created_at limit 1;
  end if;
  if v_customer is null then
    insert into customers (full_name, phone, branch_id)
    values (q.customer_name, q.customer_phone, v_branch) returning id into v_customer;
  end if;

  insert into contracts (
    contract_no, service_code, customer_id, branch_id, start_date, end_date,
    gross_amount, discount_amount, promotion_id, base_amount, pricing_params,
    status, created_by, quote_id, issue_date, notes
  ) values (
    generate_contract_no(), q.service_code, v_customer, v_branch,
    coalesce(q.start_date, current_date), coalesce(q.end_date, case when q.service_code = 'hourly_rental' then q.start_date end),
    coalesce(q.gross_amount, q.base_amount), q.discount_amount, q.promotion_id, q.base_amount,
    q.price_snapshot->'params', 'draft', auth.uid(), q.id, current_date, q.notes
  ) returning * into v_row;

  for v_clause in select jsonb_array_elements_text(coalesce(q.terms, '[]'::jsonb)) loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_row.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;
  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());
  if q.promotion_id is not null then
    update promotions set usage_count = usage_count + 1, updated_at = now() where id = q.promotion_id;
  end if;

  insert into service_requests (service_code, branch_id, customer_id, worker_profile_id,
                                customer_name, customer_phone, base_amount, vat_amount, total_amount,
                                status, contract_id, details)
  values (q.service_code, v_branch, v_customer, q.worker_profile_id,
          q.customer_name, q.customer_phone, q.base_amount, q.vat_amount, q.total_amount,
          'new', v_row.id,
          jsonb_build_object('source', 'quote', 'quote_no', q.quote_no,
                             'start_date', q.start_date, 'end_date', q.end_date,
                             'start_time', q.start_time, 'end_time', q.end_time,
                             'nationality', q.nationality, 'profession', q.profession))
  returning id into v_req;

  -- hourly: the booking is made now (fails the whole conversion on a conflict)
  if q.service_code = 'hourly_rental' then
    perform _insert_hourly_booking(q.worker_profile_id, v_branch, q.profession, q.start_date,
                                   q.start_time, q.end_time, v_customer, q.customer_name, q.customer_phone,
                                   null,
                                   jsonb_build_object('unit_price', round(coalesce(q.gross_amount, q.base_amount) / v_hours, 2),
                                                      'net', q.base_amount, 'discounts', q.discount_amount,
                                                      'vat', q.vat_amount, 'total', q.total_amount),
                                   v_hours, q.id, v_row.id, v_req, q.notes);
  end if;

  update quotes set contract_id = v_row.id, request_id = v_req, customer_id = v_customer where id = q.id;
  insert into quote_events (quote_id, type, actor, note)
  values (q.id, 'converted', auth.uid(), v_row.contract_no);
  if q.lead_id is not null then
    update leads set stage_code = 'won', customer_id = v_customer, updated_at = now() where id = q.lead_id;
  end if;

  insert into audit_log (action, table_name, entity, record_id, new_data, branch_id)
  values ('quote.convert', 'contracts', 'contracts', v_row.id,
          jsonb_build_object('quote_no', q.quote_no, 'contract_no', v_row.contract_no), v_branch);
  return v_row;
end;
$$;

-- hourly contract template (editable from العقود)
insert into contract_templates (service_code, name, clauses)
select 'hourly_rental', 'عقد تأجير بالساعة', jsonb_build_array(
  'أُبرم هذا العقد بين شركة ماسية الشرق للاستقدام (الطرف الأول) والعميل {{customer_name}} (الطرف الثاني).',
  'يلتزم الطرف الأول بتوفير عاملة لمهمة {{task}} لمدة {{duration}} ساعات في التاريخ ووقت الوصول المحددين في العقد.',
  'تُحتسب الأجرة بعدد الساعات المتفق عليها، وأي تمديد في نفس اليوم يحتاج موافقة الطرف الأول وتوفّر العاملة.',
  'يلتزم الطرف الثاني بتوفير بيئة عمل آمنة وعدم تكليف العاملة بمهام خارج نطاق العقد.',
  'إلغاء الحجز قبل موعده بأقل من 24 ساعة يخضع لرسوم الإلغاء المعتمدة.')
where not exists (select 1 from contract_templates where service_code = 'hourly_rental');

-- ---------- 6) the public website order (was called by the UI but missing) -------
create table if not exists request_submissions (
  client_token text primary key,
  request_id   uuid not null references service_requests(id) on delete cascade,
  created_at   timestamptz not null default now()
);
alter table request_submissions enable row level security;   -- no policies: definer functions only

create or replace function submit_service_request(p_client_token text, p_payload jsonb)
returns table(request_no text, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_service text := p_payload->>'service_code';
  v_prev    uuid;
  v_price   jsonb;
  v_qty     numeric;
  v_row     service_requests;
begin
  if length(coalesce(p_client_token, '')) < 8 then raise exception 'معرّف الإرسال مفقود'; end if;
  select s.request_id into v_prev from request_submissions s where s.client_token = p_client_token;
  if v_prev is not null then   -- idempotent: the same submission returns the same order
    return query select r.request_no, false from service_requests r where r.id = v_prev;
    return;
  end if;
  if not exists (select 1 from services where code = v_service and is_active) then
    raise exception 'نوع الخدمة غير صحيح';
  end if;
  if length(btrim(coalesce(p_payload->>'customer_name', ''))) < 3 then raise exception 'اسم العميل مطلوب'; end if;
  if coalesce(p_payload->>'customer_phone', '') !~ '^(05\d{8}|9665\d{8}|\+9665\d{8})$' then
    raise exception 'رقم الجوال غير صحيح';
  end if;

  -- the server prices the order (never the browser)
  v_qty := case when v_service = 'hourly_rental'
                then hourly_hours((p_payload->'details'->>'start_time')::time, (p_payload->'details'->>'end_time')::time)
                else greatest(coalesce((p_payload->>'duration_count')::numeric, 1), 1) end;
  v_price := calc_price(v_service, jsonb_strip_nulls(jsonb_build_object(
    'nationality', p_payload->>'nationality', 'profession', p_payload->>'profession',
    'quantity', v_qty, 'branch', coalesce(p_payload->>'branch', p_payload->>'customer_city'))));

  insert into service_requests (service_code, details, customer_name, customer_phone, customer_national_id,
                                customer_city, worker_profile_id, base_amount, vat_amount, total_amount)
  values (v_service,
          coalesce(p_payload->'details', '{}'::jsonb)
            || jsonb_strip_nulls(jsonb_build_object('branch', p_payload->>'branch',
                                                    'address', p_payload->>'customer_address',
                                                    'payment_method', p_payload->>'payment_method')),
          btrim(p_payload->>'customer_name'), p_payload->>'customer_phone',
          nullif(p_payload->>'customer_national_id', ''), nullif(p_payload->>'customer_city', ''),
          nullif(p_payload->>'worker_profile_id', '')::uuid,
          (v_price->>'net')::numeric, (v_price->>'vat')::numeric, (v_price->>'total')::numeric)
  returning * into v_row;
  insert into request_submissions (client_token, request_id) values (p_client_token, v_row.id);
  return query select v_row.request_no, true;
end $$;

create or replace function track_service_request(p_request_no text)
returns table(request_no text, service_code text, status text, payment_status text,
              created_at timestamptz, period jsonb)
language sql stable security definer set search_path = public as $$
  -- no personal data: status and the service period only
  select r.request_no, r.service_code, r.status, r.payment_status, r.created_at,
         case when r.details ? 'start_date' and r.details->>'start_date' is not null then
           jsonb_build_object('startDate', r.details->>'start_date', 'endDate', r.details->>'end_date',
                              'unit', coalesce(r.details->>'duration_unit', 'day'),
                              'count', coalesce((r.details->>'duration_count')::int, 1)) end
    from service_requests r
   where r.request_no = upper(btrim(p_request_no))
$$;

grant execute on function submit_service_request(text, jsonb), track_service_request(text) to anon, authenticated;

-- ---------- 7) quotes: arrival/leave time for hourly + branch price ------------
create or replace function create_quote_from_price(
  p_service_code   text,
  p_params         jsonb,
  p_customer_name  text,
  p_customer_phone text,
  p_valid_until    date,
  p_notes          text default null,
  p_parent_id      uuid default null,
  p_snapshot       jsonb default null,
  p_extra          jsonb default '{}'::jsonb
) returns quotes
language plpgsql security definer set search_path = public as $$
declare
  v_price   jsonb;
  v_row     quotes;
  v_lead    leads;
  v_branch  uuid := get_my_branch();
  v_cust    uuid := nullif(p_extra->>'customer_id', '')::uuid;
  v_start   date := nullif(p_extra->>'start_date', '')::date;
  v_unit    text := nullif(p_extra->>'duration_unit', '');
  v_count   integer := nullif(p_extra->>'duration_count', '')::integer;
  v_end     date;
begin
  if not (has_perm('pricing','create') or has_perm('leads','create')) then
    raise exception 'لا تملك صلاحية إنشاء عروض الأسعار';
  end if;
  if length(btrim(coalesce(p_customer_name, ''))) < 3 then raise exception 'اسم العميل مطلوب'; end if;
  if p_valid_until is null or p_valid_until <= current_date then raise exception 'تاريخ صلاحية العرض يجب أن يكون لاحقًا لليوم'; end if;

  if nullif(p_extra->>'lead_id', '') is not null then
    select * into v_lead from leads where id = (p_extra->>'lead_id')::uuid;
    if v_lead.id is null then raise exception 'العميل المحتمل غير موجود'; end if;
    if not can_act_on_sales_row(v_lead.branch_id, v_lead.assigned_to) then
      raise exception 'هذا العميل المحتمل خارج نطاقك';
    end if;
    v_branch := coalesce(v_lead.branch_id, v_branch);
    v_cust := coalesce(v_cust, v_lead.customer_id);
  end if;
  if v_cust is not null and not exists (select 1 from customers where id = v_cust and in_my_branch(branch_id)) then
    raise exception 'العميل خارج نطاق فرعك';
  end if;

  if v_start is not null and v_unit is not null and v_count is not null then
    v_end := case v_unit
      when 'day'   then v_start + (v_count - 1)
      when 'week'  then v_start + (v_count * 7 - 1)
      when 'month' then (v_start + make_interval(months => v_count))::date - 1
      when 'year'  then (v_start + make_interval(years => v_count))::date - 1
      else v_start end;   -- hour: same day
  end if;

  -- hourly: the hours come from the arrival/leave time and the managed min/max
  if p_service_code = 'hourly_rental' and nullif(p_extra->>'start_time', '') is not null then
    p_params := p_params || jsonb_build_object('quantity',
      hourly_hours((p_extra->>'start_time')::time, (p_extra->>'end_time')::time));
    v_unit := 'hour';
    v_count := ceil((p_params->>'quantity')::numeric);
    v_end := v_start;   -- same day
  end if;
  p_params := p_params || jsonb_strip_nulls(jsonb_build_object('branch_id', v_branch));

  -- the backend price is authoritative (same engine as contracts)
  v_price := calc_price(p_service_code, p_params);
  if (v_price->>'base')::numeric <= 0 then raise exception 'لا توجد قاعدة سعر نشطة لهذه الخدمة'; end if;
  if not coalesce((v_price->>'promotion_ok')::boolean, true) then
    raise exception 'الخصم غير قابل للتطبيق: %', coalesce(v_price->>'promotion_reason', '');
  end if;
  if (v_price->>'total')::numeric <= 0 then raise exception 'الإجمالي غير صالح'; end if;

  insert into quotes (service_code, customer_name, customer_phone, nationality, profession, quantity,
                      base_amount, vat_amount, total_amount, gross_amount, discount_amount,
                      promotion_id, coupon_code, status, valid_until, notes,
                      assigned_to, branch_id, created_by, parent_id, price_snapshot,
                      lead_id, customer_id, worker_profile_id, worker_name,
                      start_date, duration_unit, duration_count, end_date, terms, start_time, end_time)
  values (p_service_code, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone,'')), ''),
          nullif(p_params->>'nationality',''), nullif(p_params->>'profession',''),
          case when p_service_code = 'hourly_rental' then 1   -- the hours live in duration_count
               else greatest(coalesce((p_params->>'quantity')::numeric, 1), 1)::integer end,
          (v_price->>'net')::numeric, (v_price->>'vat')::numeric, (v_price->>'total')::numeric,
          (v_price->>'base')::numeric, (v_price->>'discounts')::numeric,
          case when (v_price->>'discounts')::numeric > 0 then nullif(v_price->>'promotion_id','')::uuid end,
          nullif(upper(btrim(coalesce(p_params->>'promotion_code',''))), ''),
          'draft', p_valid_until, p_notes, auth.uid(), v_branch, auth.uid(), p_parent_id,
          coalesce(p_snapshot, '{}'::jsonb)
            || jsonb_build_object('server', v_price, 'params', p_params, 'computed_at', now()),
          v_lead.id, v_cust, nullif(p_extra->>'worker_profile_id','')::uuid,
          nullif(btrim(coalesce(p_extra->>'worker_name','')), ''),
          v_start, v_unit, v_count, v_end,
          coalesce(p_extra->'terms', '[]'::jsonb),
          nullif(p_extra->>'start_time', '')::time, nullif(p_extra->>'end_time', '')::time)
  returning * into v_row;

  insert into quote_events (quote_id, type, actor, note)
  values (v_row.id, case when p_parent_id is null then 'created' else 'version_created' end, auth.uid(), null);

  -- a quote on the lead moves it to the "quoted" stage
  if v_lead.id is not null and v_lead.stage_code in ('new','contacted') then
    update leads set stage_code = 'quoted', updated_at = now() where id = v_lead.id;
  end if;

  update pricing_log set op_type = 'quote', reference = 'QT-' || v_row.quote_no
  where id = (select id from pricing_log
              where created_at = now() and created_by is not distinct from auth.uid()
              order by created_at desc limit 1);
  return v_row;
end;
$$;
