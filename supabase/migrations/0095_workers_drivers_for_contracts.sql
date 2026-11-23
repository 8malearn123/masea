-- =============================================================
-- 0095 — بيانات العاملة داخل العقد + مهام التوصيل والاستلام للسائقين
-- (docs/plans/contracts-operations-finance-plan.md — المرحلة 2)
--
--   1) contract_worker_candidates(): العاملات المؤهلات للخدمة مع التوفر الفعلي
--      للفترة (المتاحة وغير المتاحة وسببها وتاريخ توفرها) والرقم الداخلي (الباركود)
--      والإقامة/الجواز — للقراءة بصلاحية contracts.view فقط.
--   2) worker_contract_history(): سجل العاملة — عقودها السابقة والحالية
--      واستبدالاتها وإرجاعاتها — من الجداول القائمة دون نسخ.
--   3) driver_tasks: مهام توصيل/استلام العاملة مربوطة بالعقد والعميل والعاملة
--      والسائق بنافذة زمنية، مع قيد استبعاد يمنع مهمتين متداخلتين للسائق نفسه.
--      تُنشأ من العقد أو من الإرجاع والاستبدال (0090/0091)، والسائق يحدّث حالتها.
--   4) driver_availability(): السائقون وحالتهم وانشغالهم في نافذة محددة.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) worker candidates for a contract ---------------------------------
create or replace function worker_next_free_date(p_worker uuid) returns date
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from contracts c where c.worker_profile_id = p_worker
                       and contract_status_is_live(c.status) and coalesce(c.end_date, 'infinity'::date) >= current_date)
      then current_date
    else (select max(coalesce(c.end_date, 'infinity'::date)) + 1 from contracts c
           where c.worker_profile_id = p_worker and contract_status_is_live(c.status))
  end
$$;

create or replace function contract_worker_candidates(
  p_service text, p_start date, p_end date, p_exclude_contract uuid default null)
returns table (
  id uuid, full_name text, nationality text, profession text, branch_id uuid, branch_name text,
  status text, internal_no text, id_no text, available boolean, reason text,
  next_free_date date, conflict_contract_no text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('contracts', 'view') then raise exception 'لا تملك صلاحية عرض العاملات للعقود'; end if;
  return query
  select w.id, w.full_name, w.nationality, w.profession, w.branch_id, b.name,
         w.status, d.barcode, coalesce(d.iqama_no, d.passport_no),
         (x.id is null and (w.status in ('available','reserved')
            or (w.status = 'on_service' and worker_next_free_date(w.id) <= p_start))),
         case
           when x.id is not null then 'محجوزة على العقد ' || coalesce(x.contract_no, '') || ' في الفترة نفسها'
           when w.status = 'on_service' and worker_next_free_date(w.id) > p_start then 'لدى عميل حتى ' || (worker_next_free_date(w.id) - 1)
           when w.status = 'returning' then 'بانتظار الاستلام والجاهزية'
           when w.status = 'medical' then 'متابعة طبية'
           else null end,
         worker_next_free_date(w.id), x.contract_no
    from worker_profiles w
    left join worker_details d on d.worker_id = w.id
    left join branches b on b.id = w.branch_id
    left join lateral (select * from worker_contract_conflict(w.id, p_start, p_end, p_exclude_contract)) x on true
   where w.is_active
     and (is_cross_branch() or w.branch_id is null or in_my_branch(w.branch_id))
   order by 10 desc, w.full_name;
end $$;
grant execute on function contract_worker_candidates(text, date, date, uuid) to authenticated;

-- ---------- 2) worker history -----------------------------------------------------
create or replace function worker_contract_history(p_worker uuid)
returns table (kind text, ref_id uuid, contract_id uuid, contract_no text, service_code text,
               status text, start_date date, end_date date, customer_name text, note text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'contract', c.id, c.id, c.contract_no, c.service_code, c.status::text, c.start_date, c.end_date,
         cu.full_name, null::text, c.created_at
    from contracts c left join customers cu on cu.id = c.customer_id
   where c.worker_profile_id = p_worker and has_perm('contracts', 'view') and contract_in_my_scope(c.id)
  union all
  select 'replacement', r.id, r.contract_id, c.contract_no, c.service_code, r.status, r.requested_at, r.new_delivered_at,
         cu.full_name,
         case when r.old_worker_profile_id = p_worker then 'استُبدلت من العقد' else 'دخلت العقد بديلةً' end,
         r.created_at
    from contract_replacements r join contracts c on c.id = r.contract_id
    left join customers cu on cu.id = c.customer_id
   where (r.old_worker_profile_id = p_worker or r.new_worker_profile_id = p_worker)
     and has_perm('contracts', 'view') and contract_in_my_scope(c.id)
  union all
  select 'return', w.id, w.contract_id, c.contract_no, c.service_code, w.status, w.requested_date, w.actual_date,
         cu.full_name, w.condition_code, w.created_at
    from worker_returns w join contracts c on c.id = w.contract_id
    left join customers cu on cu.id = c.customer_id
   where w.worker_profile_id = p_worker and has_perm('contracts', 'view') and contract_in_my_scope(c.id)
  order by 11 desc
$$;
grant execute on function worker_contract_history(uuid) to authenticated;

-- ---------- 3) driver tasks ------------------------------------------------------
create table if not exists driver_tasks (
  id                uuid primary key default gen_random_uuid(),
  task_no           text unique,
  contract_id       uuid not null references contracts(id) on delete restrict,
  worker_profile_id uuid references worker_profiles(id) on delete restrict,
  kind              text not null check (kind in ('delivery','pickup')),
  driver_id         uuid references drivers(id) on delete restrict,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  address           text,
  notes             text,
  status            text not null default 'pending' check (status in
                      ('pending','assigned','on_the_way','done','cancelled')),
  done_at           timestamptz,
  return_id         uuid references worker_returns(id) on delete restrict,
  replacement_id    uuid references contract_replacements(id) on delete restrict,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists idx_driver_tasks_contract on driver_tasks(contract_id);
create index if not exists idx_driver_tasks_driver on driver_tasks(driver_id, starts_at);
alter table driver_tasks drop constraint if exists driver_tasks_no_overlap;
alter table driver_tasks add constraint driver_tasks_no_overlap
  exclude using gist (driver_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (driver_id is not null and status in ('assigned','on_the_way'));
alter table driver_tasks enable row level security;
drop policy if exists dt_read on driver_tasks;
create policy dt_read on driver_tasks for select to authenticated using (
  (has_perm('contracts', 'view') and contract_in_my_scope(contract_id))
  or exists (select 1 from drivers d where d.id = driver_id and d.user_id = auth.uid()));
drop trigger if exists trg_audit_row on driver_tasks;
create trigger trg_audit_row after insert or update or delete on driver_tasks
  for each row execute function audit_row_change();

create or replace function driver_task_conflict(p_driver uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns text language sql stable security definer set search_path = public as $$
  select task_no from driver_tasks
   where driver_id = p_driver and id is distinct from p_exclude and status in ('assigned','on_the_way')
     and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_start, p_end, '[)')
   limit 1
$$;

create or replace function create_driver_task(
  p_contract uuid, p_kind text, p_start timestamptz, p_end timestamptz, p_driver uuid default null,
  p_address text default null, p_notes text default null, p_worker uuid default null,
  p_return uuid default null, p_replacement uuid default null)
returns driver_tasks language plpgsql security definer set search_path = public as $$
declare c contracts; v_row driver_tasks; v_hit text; v_active boolean;
begin
  if not (has_perm('contracts', 'edit') or has_perm('orders', 'edit')) then
    raise exception 'لا تملك صلاحية إسناد مهام التوصيل';
  end if;
  select * into c from contracts where id = p_contract;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not contract_in_my_scope(p_contract) then raise exception 'هذا العقد خارج نطاق فرعك'; end if;
  if p_kind not in ('delivery','pickup') then raise exception 'نوع المهمة غير صحيح'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'حدّد وقت بداية ونهاية صحيحين للمهمة'; end if;
  if p_driver is not null then
    select is_active into v_active from drivers where id = p_driver;
    if not coalesce(v_active, false) then raise exception 'السائق غير موجود أو معطّل'; end if;
    v_hit := driver_task_conflict(p_driver, p_start, p_end);
    if v_hit is not null then raise exception 'السائق مشغول بالمهمة % في الوقت نفسه', v_hit; end if;
  end if;
  insert into driver_tasks (task_no, contract_id, worker_profile_id, kind, driver_id, starts_at, ends_at,
                            address, notes, status, return_id, replacement_id, created_by)
  values (next_ops_no('DT'), p_contract, coalesce(p_worker, c.worker_profile_id), p_kind, p_driver, p_start, p_end,
          nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
          case when p_driver is null then 'pending' else 'assigned' end, p_return, p_replacement, auth.uid())
  returning * into v_row;
  perform log_contract_op(p_contract, 'driver_task', v_row.id, 'driver_create', null, v_row.status,
                          case p_kind when 'delivery' then 'توصيل' else 'استلام' end);
  return v_row;
end $$;
grant execute on function create_driver_task(uuid, text, timestamptz, timestamptz, uuid, text, text, uuid, uuid, uuid)
  to authenticated;

create or replace function driver_task_step(p_id uuid, p_action text, p_driver uuid default null, p_note text default null)
returns driver_tasks language plpgsql security definer set search_path = public as $$
declare t driver_tasks; v_mine boolean; v_staff boolean; v_hit text; v_active boolean;
begin
  select * into t from driver_tasks where id = p_id for update;
  if not found then raise exception 'المهمة غير موجودة'; end if;
  v_mine := exists (select 1 from drivers d where d.id = t.driver_id and d.user_id = auth.uid());
  v_staff := (has_perm('contracts', 'edit') or has_perm('orders', 'edit')) and contract_in_my_scope(t.contract_id);
  if not (v_mine or v_staff) then raise exception 'لا تملك صلاحية على هذه المهمة'; end if;

  if p_action = 'assign' then
    if not v_staff then raise exception 'الإسناد للموظف المسؤول'; end if;
    if t.status not in ('pending','assigned') then raise exception 'لا يُعاد إسناد مهمة بدأت أو انتهت'; end if;
    select is_active into v_active from drivers where id = p_driver;
    if not coalesce(v_active, false) then raise exception 'السائق غير موجود أو معطّل'; end if;
    v_hit := driver_task_conflict(p_driver, t.starts_at, t.ends_at, t.id);
    if v_hit is not null then raise exception 'السائق مشغول بالمهمة % في الوقت نفسه', v_hit; end if;
    update driver_tasks set driver_id = p_driver, status = 'assigned', updated_at = now() where id = p_id returning * into t;
  elsif p_action = 'start' then
    if t.status <> 'assigned' then raise exception 'تبدأ المهمة بعد إسنادها'; end if;
    update driver_tasks set status = 'on_the_way', updated_at = now() where id = p_id returning * into t;
  elsif p_action = 'done' then
    if t.status not in ('assigned','on_the_way') then raise exception 'المهمة ليست قيد التنفيذ'; end if;
    update driver_tasks set status = 'done', done_at = now(),
      notes = coalesce(nullif(btrim(coalesce(p_note, '')), ''), notes), updated_at = now()
     where id = p_id returning * into t;
  elsif p_action = 'cancel' then
    if not v_staff then raise exception 'الإلغاء للموظف المسؤول'; end if;
    if t.status in ('done','cancelled') then raise exception 'المهمة منتهية'; end if;
    update driver_tasks set status = 'cancelled', updated_at = now() where id = p_id returning * into t;
  else
    raise exception 'إجراء غير معروف';
  end if;
  perform log_contract_op(t.contract_id, 'driver_task', t.id, 'driver_' || p_action, null, t.status, p_note);
  return t;
end $$;
grant execute on function driver_task_step(uuid, text, uuid, text) to authenticated;

-- the operations log accepts driver tasks too
alter table contract_ops_events drop constraint if exists contract_ops_events_entity_check;
alter table contract_ops_events add constraint contract_ops_events_entity_check
  check (entity in ('settlement','return','refund','replacement','trial','driver_task'));

-- ---------- 4) driver availability in a window ----------------------------------
create or replace function driver_availability(p_start timestamptz, p_end timestamptz)
returns table (id uuid, full_name text, phone text, branch_name text, status text, is_active boolean,
               busy boolean, busy_task_no text, tasks_today integer)
language sql stable security definer set search_path = public as $$
  select d.id, d.full_name, d.phone, b.name, d.status::text, d.is_active,
         driver_task_conflict(d.id, p_start, p_end) is not null, driver_task_conflict(d.id, p_start, p_end),
         (select count(*)::int from driver_tasks t where t.driver_id = d.id and t.status in ('assigned','on_the_way')
            and t.starts_at::date = p_start::date)
    from drivers d left join branches b on b.id = d.branch_id
   where d.is_active and (has_perm('contracts', 'view') or has_perm('orders', 'view'))
     and (is_cross_branch() or d.branch_id is null or in_my_branch(d.branch_id))
   order by 7, d.full_name
$$;
grant execute on function driver_availability(timestamptz, timestamptz) to authenticated;

-- ---------- 5) settings ----------------------------------------------------------
insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('driver_task_default_minutes', 'المدة الافتراضية لمهمة توصيل/استلام العاملة', 'التوصيل والاستلام', 60, 'دقيقة', 80)
on conflict (key) do nothing;
