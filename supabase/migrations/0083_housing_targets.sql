-- =============================================================
-- 0083 — مستهدفات السكن (خطة العمليات والميدان، المرحلة 3)
--   • الإسناد بصلاحية housing.manage ضمن نطاق الفرع. كانت سياسة htarget_admin (0039)
--     تعتمد is_admin() فيكتب المحاسب والموارد البشرية مستهدفات السكن، ومدير الفرع لا يكتب.
--   • المستهدف لمشرفة نشطة بدور «مشرفة السكن»، وفرعه = فرعها (يُملأ تلقائيًا).
--   • الحذف = تعطيل (is_active)، وكل تعديل في سجل التدقيق.
--   • list_housing_targets(): المحقَّق محسوب في الخادم:
--       الإشغال = المقيمات / السعة في مساكن المشرفة (أو مساكن الفرع إن لم تُسند لها مساكن)
--       الحضور  = (حاضرة + في خدمة) / سجلات الحضور لعاملات تلك المساكن خلال الشهر
-- التراجع: supabase/rollback/0083_housing_targets_down.sql
-- =============================================================

drop policy if exists htarget_admin on housing_targets;
drop policy if exists htarget_ins on housing_targets;
drop policy if exists htarget_upd on housing_targets;
create policy htarget_ins on housing_targets for insert to authenticated
  with check (has_perm('housing', 'manage') and in_my_branch(branch_id));
create policy htarget_upd on housing_targets for update to authenticated
  using (has_perm('housing', 'manage') and in_my_branch(branch_id))
  with check (has_perm('housing', 'manage') and in_my_branch(branch_id));
-- لا سياسة حذف: المستهدف يُعطَّل

alter table housing_targets add column if not exists updated_at timestamptz not null default now();

create or replace function guard_housing_target() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  new.updated_at := now();
  select u.branch_id into v_branch from user_profiles u
   where u.id = new.supervisor_id and u.role = 'housing_supervisor' and u.is_active;
  if not found then
    raise exception 'المستهدف يُسند لمستخدمة نشطة بدور «مشرفة السكن»';
  end if;
  new.branch_id := coalesce(v_branch, new.branch_id);
  if tg_op = 'UPDATE' and (new.supervisor_id <> old.supervisor_id
                           or new.month <> old.month or new.year <> old.year) then
    raise exception 'لا يُغيَّر صاحب المستهدف أو شهره: عطّله وأنشئ مستهدفًا جديدًا';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_housing_target on housing_targets;
create trigger trg_guard_housing_target before insert or update on housing_targets
  for each row execute function guard_housing_target();

drop trigger if exists trg_audit_row on housing_targets;
create trigger trg_audit_row after insert or update or delete on housing_targets
  for each row execute function audit_row_change();

-- مساكن المشرفة (أو مساكن فرعها النشطة إن لم تُسند لها مساكن)
create or replace function supervisor_dorms(p_supervisor uuid, p_branch uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select h.id from housing_dorms h where h.is_active and h.supervisor_id = p_supervisor
  union all
  select h.id from housing_dorms h
   where h.is_active and h.branch_id is not distinct from p_branch
     and not exists (select 1 from housing_dorms x where x.is_active and x.supervisor_id = p_supervisor)
$$;
revoke execute on function supervisor_dorms(uuid, uuid) from public, anon, authenticated;

create or replace function list_housing_targets(p_year integer default null, p_month integer default null)
returns table (id uuid, supervisor_id uuid, supervisor text, branch_id uuid, branch text,
               month integer, year integer, occupancy_target_pct integer, attendance_target_pct integer,
               occupancy_actual_pct integer, attendance_actual_pct integer, notes text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.supervisor_id, u.full_name, t.branch_id, b.city, t.month, t.year,
         t.occupancy_target_pct, t.attendance_target_pct,
         coalesce((select round(100.0 * sum(dorm_occupied(d)) / nullif(sum(h.capacity), 0))::int
                     from supervisor_dorms(t.supervisor_id, t.branch_id) d
                     join housing_dorms h on h.id = d), 0),
         coalesce((select round(100.0 * count(*) filter (where a.status in ('present','on_service'))
                                 / nullif(count(*), 0))::int
                     from housing_attendance a
                    where a.dorm_id in (select supervisor_dorms(t.supervisor_id, t.branch_id))
                      and extract(year from a.date) = t.year and extract(month from a.date) = t.month), 0),
         t.notes, t.is_active
    from housing_targets t
    left join user_profiles u on u.id = t.supervisor_id
    left join branches b on b.id = t.branch_id
   where (p_year is null or t.year = p_year) and (p_month is null or t.month = p_month)
     and (t.supervisor_id = auth.uid()
          or (has_perm('housing', 'view') and in_my_branch(t.branch_id)))
   order by t.year desc, t.month desc, u.full_name
$$;
revoke execute on function list_housing_targets(integer, integer) from public, anon;
grant execute on function list_housing_targets(integer, integer) to authenticated;
