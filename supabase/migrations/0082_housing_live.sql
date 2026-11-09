-- =============================================================
-- 0082 — ربط شاشات السكن بقاعدة البيانات (خطة العمليات والميدان، المرحلة 2)
--   • list_housing_residents(): العاملات المسكّنات ضمن نطاق المستخدم مع حالة اليوم —
--     worker_details خاص، فالقراءة عبر دالة بصلاحية housing.view ونطاق الفرع.
--   • سكن العاملة مصدره ملفها (worker_details.dorm_id، 0078) لا آخر سجل حضور.
--   • log_housing_scan: يقبل الباركود أو رقم الإقامة، والتسجيل يتطلب housing.edit
--     (كان يكفي العرض).
--   • سجل الحضور اليدوي يأخذ سكن العاملة تلقائيًا.
-- التراجع: supabase/rollback/0082_housing_live_down.sql
-- =============================================================

-- سكن العاملة التشغيلية (workers.id) من ملفها
create or replace function worker_dorm_of(p_worker uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select d.dorm_id from worker_details d where d.ops_worker_id = p_worker limit 1
$$;
revoke execute on function worker_dorm_of(uuid) from public, anon, authenticated;

-- ---------- 1) قائمة المقيمات --------------------------------------------------
create or replace function list_housing_residents()
returns table (id uuid, full_name text, nationality text, dorm_id uuid, dorm text, branch text,
               status housing_status, check_in date, barcode text, iqama_no text)
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Riyadh')::date as d)
  select w.id, p.full_name, p.nationality, h.id, h.name, b.city,
         coalesce(a.status,
                  case p.status::text when 'on_service' then 'on_service'::housing_status
                                      when 'medical' then 'medical'::housing_status
                                      else 'absent'::housing_status end),
         coalesce((select min(x.date) from housing_attendance x where x.worker_id = w.id), d.arrival_date),
         d.barcode, d.iqama_no
    from worker_details d
    join worker_profiles p on p.id = d.worker_id and p.is_active
    join workers w on w.id = d.ops_worker_id
    join housing_dorms h on h.id = d.dorm_id
    left join branches b on b.id = h.branch_id
    cross join today
    left join housing_attendance a on a.worker_id = w.id and a.date = today.d
   where has_perm('housing', 'view') and in_my_branch(h.branch_id)
   order by h.name, p.full_name
$$;
revoke execute on function list_housing_residents() from public, anon;
grant execute on function list_housing_residents() to authenticated;

-- ---------- 2) مسح السكن: باركود أو إقامة، والسكن من الملف ----------------------
create or replace function log_housing_scan(p_barcode text, p_direction text, p_note text default null)
returns workers language plpgsql security definer set search_path = public
as $$
declare v_worker workers; v_dorm uuid; v_code text := btrim(coalesce(p_barcode, ''));
        v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if not has_perm('housing', 'edit') then
    raise exception 'لا تملك صلاحية تسجيل مسح السكن' using errcode = '42501';
  end if;
  if p_direction not in ('in','out') then
    raise exception 'اتجاه غير صحيح';
  end if;
  select * into v_worker from workers where barcode = v_code;
  if not found and v_code <> '' then
    -- رقم الإقامة: العاملة في نطاق المستخدم أولًا
    select * into v_worker from workers
     where iqama_no = v_code
     order by (is_cross_branch() or branch_id = get_my_branch()) desc
     limit 1;
  end if;
  if not found then
    raise exception 'لا توجد عاملة بهذا الباركود';
  end if;
  if not (is_cross_branch() or v_worker.branch_id = get_my_branch()) then
    raise exception 'هذه العاملة خارج نطاق فرعك';
  end if;
  v_dorm := coalesce(worker_dorm_of(v_worker.id),
                     (select dorm_id from housing_attendance
                       where worker_id = v_worker.id order by date desc limit 1));

  insert into housing_scans (worker_id, dorm_id, direction, note, scanned_by)
  values (v_worker.id, v_dorm, p_direction, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());

  -- a dorm entry scan IS the worker's attendance for the day
  if p_direction = 'in' then
    insert into housing_attendance (worker_id, dorm_id, date, status)
    values (v_worker.id, v_dorm, v_today, 'present')
    on conflict (worker_id, date) do update set status = 'present', dorm_id = excluded.dorm_id;
  end if;
  return v_worker;
end $$;

-- رقم الإقامة فريد لكل شخص: يُفرض متى كانت البيانات نظيفة (وإلا تنبيه للتنظيف)
do $$
begin
  if exists (select iqama_no from worker_details where iqama_no is not null
              group by iqama_no having count(*) > 1) then
    raise notice 'أرقام إقامة مكررة في ملفات العاملات — نظّفها ثم أعد تطبيق الفهرس uq_worker_details_iqama';
  else
    create unique index if not exists uq_worker_details_iqama on worker_details (iqama_no)
      where iqama_no is not null;
  end if;
end $$;

-- ---------- 3) الحضور اليدوي يأخذ سكن العاملة ------------------------------------
create or replace function fill_attendance_dorm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dorm_id is null then new.dorm_id := worker_dorm_of(new.worker_id); end if;
  return new;
end $$;
drop trigger if exists trg_fill_attendance_dorm on housing_attendance;
create trigger trg_fill_attendance_dorm before insert on housing_attendance
  for each row execute function fill_attendance_dorm();

-- ---------- 4) البحث عن عاملة بالباركود أو الإقامة (محطة المسح، رحلات السائق) ----
-- يعيد العاملة إن كانت في نطاق المستخدم؛ لا صفوف = غير موجودة؛ خارج النطاق = خطأ واضح
create or replace function find_worker_by_code(p_code text)
returns table (id uuid, full_name text, nationality text, barcode text, iqama_no text,
               branch text, dorm text)
language plpgsql stable security definer set search_path = public as $$
declare v_code text := btrim(coalesce(p_code, '')); v_w workers%rowtype;
begin
  if not (has_perm('housing', 'view') or has_perm('gps', 'edit')) then
    raise exception 'لا تملك صلاحية مسح العاملات' using errcode = '42501';
  end if;
  if v_code = '' then return; end if;
  select * into v_w from workers w where w.barcode = v_code;
  if not found then
    select * into v_w from workers w where w.iqama_no = v_code
     order by (is_cross_branch() or w.branch_id = get_my_branch()) desc limit 1;
  end if;
  if not found then return; end if;
  if not (is_cross_branch() or v_w.branch_id = get_my_branch()) then
    raise exception 'هذه العاملة خارج نطاق فرعك';
  end if;
  return query
    select v_w.id, v_w.full_name, coalesce(p.nationality, v_w.nationality), v_w.barcode, v_w.iqama_no,
           b.city, h.name
      from (select 1) one
      left join worker_details d on d.ops_worker_id = v_w.id
      left join worker_profiles p on p.id = d.worker_id
      left join housing_dorms h on h.id = d.dorm_id
      left join branches b on b.id = v_w.branch_id;
end $$;
revoke execute on function find_worker_by_code(text) from public, anon;
grant execute on function find_worker_by_code(text) to authenticated;
