-- =============================================================
-- Masiat Alsharq ERP — 0039 Housing supervisor: barcode entry/exit + targets
-- The housing supervisor takes daily attendance for the workers in her dorms
-- (reuses housing_attendance from 0006), scans a worker's barcode to log her
-- return to / exit from the dorm, and views the housing targets assigned to her.
--   • reuses workers.barcode + housing_dorms + RBAC (has_perm/get_my_branch/
--     is_cross_branch/is_admin). No duplicate "worker" or "attendance" concept.
--   • housing scans are dorm entry/exit (in/out) — distinct from the GPS
--     scans_log (warehouse/customer), so they get their own table.
-- =============================================================

-- ---------- 1) housing_scans (barcode dorm entry/exit log) ---------------------
create table housing_scans (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references workers(id) on delete cascade,
  dorm_id     uuid references housing_dorms(id) on delete set null,
  direction   text not null check (direction in ('in','out')),  -- دخول / خروج
  note        text,
  scanned_by  uuid references auth.users(id) on delete set null,
  scanned_at  timestamptz not null default now()
);
create index idx_housing_scans_worker on housing_scans(worker_id);
create index idx_housing_scans_at on housing_scans(scanned_at desc);

alter table housing_scans enable row level security;
-- read/write within the worker's (or chosen dorm's) branch; cross-branch roles see all
create policy hscan_read on housing_scans for select to authenticated using (
  is_cross_branch()
  or exists (select 1 from workers w where w.id = housing_scans.worker_id and w.branch_id = get_my_branch())
  or exists (select 1 from housing_dorms d where d.id = housing_scans.dorm_id and d.branch_id = get_my_branch())
);
create policy hscan_insert on housing_scans for insert to authenticated with check (
  scanned_by = auth.uid() and (
    is_cross_branch()
    or exists (select 1 from workers w where w.id = housing_scans.worker_id and w.branch_id = get_my_branch())
  )
);

-- ---------- 2) housing_targets (assigned to a supervisor, admin-managed) -------
create table housing_targets (
  id                    uuid primary key default gen_random_uuid(),
  supervisor_id         uuid not null references auth.users(id) on delete cascade,
  branch_id             uuid references branches(id) on delete set null,
  month                 integer not null check (month between 1 and 12),
  year                  integer not null,
  occupancy_target_pct  integer not null default 0 check (occupancy_target_pct between 0 and 100),
  attendance_target_pct integer not null default 0 check (attendance_target_pct between 0 and 100),
  notes                 text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (supervisor_id, month, year)
);
create index idx_housing_targets_sup on housing_targets(supervisor_id);

alter table housing_targets enable row level security;
-- the supervisor sees her own assigned targets; cross-branch/housing-view roles see within scope
create policy htarget_read on housing_targets for select to authenticated using (
  supervisor_id = auth.uid()
  or (has_perm('housing','view') and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null))
);
-- only admin/ops manage targets (assign them)
create policy htarget_admin on housing_targets for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- 3) log_housing_scan() — resolve a worker by barcode + log ----------
-- Returns the worker row so the UI can show her profile right after the scan.
create or replace function log_housing_scan(p_barcode text, p_direction text, p_note text default null)
returns workers language plpgsql security definer set search_path = public
as $$
declare v_worker workers; v_dorm uuid;
begin
  if not has_perm('housing','view') then
    raise exception 'لا تملك صلاحية السكن';
  end if;
  if p_direction not in ('in','out') then
    raise exception 'اتجاه غير صحيح';
  end if;
  select * into v_worker from workers where barcode = p_barcode;
  if not found then
    raise exception 'لا توجد عاملة بهذا الباركود';
  end if;
  if not (is_cross_branch() or v_worker.branch_id = get_my_branch()) then
    raise exception 'هذه العاملة خارج نطاق فرعك';
  end if;
  -- attach the most recent dorm the worker was recorded in (if any)
  select dorm_id into v_dorm from housing_attendance
    where worker_id = v_worker.id order by date desc limit 1;

  insert into housing_scans (worker_id, dorm_id, direction, note, scanned_by)
  values (v_worker.id, v_dorm, p_direction, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());

  return v_worker;
end $$;

grant execute on function log_housing_scan(text, text, text) to authenticated;
