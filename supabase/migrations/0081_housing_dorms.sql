-- =============================================================
-- 0081 — إدارة المساكن (خطة العمليات والميدان، المرحلة 1)
--   housing_dorms (0006) كان اسمًا وفرعًا ومشرفة فقط، وسياسة الكتابة (0061) تسمح
--   لأي مستخدم في الفرع بالكتابة. هنا:
--   • السعة، التفعيل (الحذف = تعطيل)، الملاحظات.
--   • الإدارة بصلاحية housing.manage ضمن نطاق الفرع (الإدارة، مدير العمليات،
--     مدير الفرع)؛ المشرفة عرض فقط.
--   • المشرفة = مستخدم بدور «مشرفة السكن» نشط ومن فرع السكن.
--   • الإشغال محسوب دائمًا من العاملات المسكّنات (worker_details.dorm_id).
--   • لا تسكين في سكن معطّل أو ممتلئ أو من فرع آخر؛ لا تعطيل لسكن فيه عاملات.
--   • تدقيق على كل تعديل.
-- التراجع: supabase/rollback/0081_housing_dorms_down.sql
-- =============================================================

alter table housing_dorms add column if not exists capacity   integer;
alter table housing_dorms add column if not exists is_active  boolean not null default true;
alter table housing_dorms add column if not exists notes      text;
alter table housing_dorms add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'housing_dorms_capacity_chk') then
    alter table housing_dorms add constraint housing_dorms_capacity_chk
      check (capacity is null or capacity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'housing_dorms_name_chk') then
    alter table housing_dorms add constraint housing_dorms_name_chk check (length(btrim(name)) > 0);
  end if;
end $$;
-- ملف العاملة يربط السكن بالاسم: الاسم فريد
create unique index if not exists uq_housing_dorms_name on housing_dorms (lower(btrim(name)));

-- ---------- 1) الصلاحية: housing.manage ----------------------------------------
insert into role_permissions (role_code, module, action) values
  ('admin', 'housing', 'manage'),
  ('operations_manager', 'housing', 'manage'),
  ('branch_manager', 'housing', 'manage')
on conflict do nothing;

drop policy if exists housing_dorms_b_write on housing_dorms;
drop policy if exists housing_dorms_ins on housing_dorms;
drop policy if exists housing_dorms_upd on housing_dorms;
create policy housing_dorms_ins on housing_dorms for insert to authenticated
  with check (has_perm('housing', 'manage') and in_my_branch(branch_id));
create policy housing_dorms_upd on housing_dorms for update to authenticated
  using (has_perm('housing', 'manage') and in_my_branch(branch_id))
  with check (has_perm('housing', 'manage') and in_my_branch(branch_id));
-- لا سياسة حذف: السكن يُعطَّل ولا يُحذف

-- ---------- 2) الإشغال المحسوب --------------------------------------------------
create or replace function dorm_occupied(p_dorm uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from worker_details d join worker_profiles p on p.id = d.worker_id
   where d.dorm_id = p_dorm and p.is_active
$$;
revoke execute on function dorm_occupied(uuid) from public, anon;
grant execute on function dorm_occupied(uuid) to authenticated;

-- ---------- 3) حارس السكن -------------------------------------------------------
create or replace function guard_housing_dorm() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_occ integer;
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  if new.supervisor_id is not null and (tg_op = 'INSERT'
       or new.supervisor_id is distinct from old.supervisor_id
       or new.branch_id is distinct from old.branch_id) then
    if not exists (select 1 from user_profiles u
                    where u.id = new.supervisor_id and u.role = 'housing_supervisor' and u.is_active
                      and (new.branch_id is null or u.branch_id is null or u.branch_id = new.branch_id)) then
      raise exception 'المشرفة يجب أن تكون مستخدمة نشطة بدور «مشرفة السكن» من فرع السكن';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    v_occ := dorm_occupied(new.id);
    if old.is_active and not new.is_active and v_occ > 0 then
      raise exception 'لا يمكن تعطيل السكن وفيه % عاملة: انقل العاملات أولًا', v_occ;
    end if;
    if new.capacity is not null and new.capacity < v_occ then
      raise exception 'السعة (%) أقل من عدد المقيمات الحالي (%)', new.capacity, v_occ;
    end if;
    if new.branch_id is distinct from old.branch_id and v_occ > 0 then
      raise exception 'لا يمكن نقل السكن لفرع آخر وفيه عاملات';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_housing_dorm on housing_dorms;
create trigger trg_guard_housing_dorm before insert or update on housing_dorms
  for each row execute function guard_housing_dorm();

drop trigger if exists trg_audit_row on housing_dorms;
create trigger trg_audit_row after insert or update or delete on housing_dorms
  for each row execute function audit_row_change();

-- ---------- 4) حارس التسكين (ملف العاملة) ---------------------------------------
create or replace function guard_worker_dorm() returns trigger
language plpgsql security definer set search_path = public as $$
declare h housing_dorms%rowtype; v_branch uuid; v_occ integer;
begin
  if new.dorm_id is null or (tg_op = 'UPDATE' and new.dorm_id is not distinct from old.dorm_id) then
    return new;
  end if;
  select * into h from housing_dorms where id = new.dorm_id;
  if not found then raise exception 'السكن غير موجود'; end if;
  if not h.is_active then raise exception 'السكن «%» معطّل: اختر سكنًا آخر', h.name; end if;
  select branch_id into v_branch from worker_profiles where id = new.worker_id;
  if h.branch_id is not null and v_branch is not null and h.branch_id <> v_branch then
    raise exception 'السكن «%» من فرع آخر: اختر سكنًا من فرع العاملة', h.name;
  end if;
  v_occ := dorm_occupied(h.id);
  if h.capacity is not null and v_occ >= h.capacity then
    raise exception 'السكن «%» ممتلئ (% من %)', h.name, v_occ, h.capacity;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_worker_dorm on worker_details;
create trigger trg_guard_worker_dorm before insert or update of dorm_id on worker_details
  for each row execute function guard_worker_dorm();

-- ---------- 5) القراءة للواجهة --------------------------------------------------
-- المساكن ضمن نطاق المستخدم مع الإشغال واسم المشرفة والفرع (worker_details خاص،
-- فالإشغال يُحسب هنا لا في الواجهة)
create or replace function list_housing_dorms()
returns table (id uuid, name text, branch_id uuid, branch text, capacity integer, occupied integer,
               supervisor_id uuid, supervisor text, is_active boolean, notes text)
language sql stable security definer set search_path = public as $$
  select h.id, h.name, h.branch_id, b.city, h.capacity, dorm_occupied(h.id),
         h.supervisor_id, u.full_name, h.is_active, h.notes
    from housing_dorms h
    left join branches b on b.id = h.branch_id
    left join user_profiles u on u.id = h.supervisor_id
   where has_perm('housing', 'view') and in_my_branch(h.branch_id)
   order by h.is_active desc, b.city nulls last, h.name
$$;
revoke execute on function list_housing_dorms() from public, anon;
grant execute on function list_housing_dorms() to authenticated;

-- المشرفات المتاحات للإسناد (ضمن نطاق مدير السكن)
create or replace function list_housing_supervisors()
returns table (id uuid, full_name text, branch_id uuid, branch text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.branch_id, b.city
    from user_profiles u left join branches b on b.id = u.branch_id
   where u.role = 'housing_supervisor' and u.is_active
     and has_perm('housing', 'manage') and in_my_branch(u.branch_id)
   order by u.full_name
$$;
revoke execute on function list_housing_supervisors() from public, anon;
grant execute on function list_housing_supervisors() to authenticated;
