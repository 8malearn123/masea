-- =============================================================
-- Masiat Alsharq ERP — 0004 HR
-- =============================================================

create table employees (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  role                text,
  branch_id           uuid references branches(id) on delete set null,
  basic_salary        numeric(12,2) default 0,
  transport_allowance numeric(12,2) default 0,
  phone               text,
  national_id         text,
  nationality         text,
  hire_date           date,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
create index idx_employees_branch on employees(branch_id);

create table attendance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  date        date not null default current_date,
  check_in    timestamptz,
  check_out   timestamptz,
  status      attendance_status not null default 'present',
  unique (employee_id, date)
);
create index idx_attendance_employee on attendance(employee_id);

create table payroll (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id) on delete cascade,
  month          integer not null check (month between 1 and 12),
  year           integer not null,
  basic          numeric(12,2) default 0,
  transport      numeric(12,2) default 0,
  overtime       numeric(12,2) default 0,
  deductions     numeric(12,2) default 0,
  gosi_employee  numeric(12,2) default 0,
  gosi_company   numeric(12,2) default 0,
  net            numeric(12,2) default 0,
  status         payroll_status not null default 'draft',
  created_at     timestamptz not null default now(),
  unique (employee_id, month, year)
);

create table leave_requests (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  type        text,
  start_date  date,
  end_date    date,
  status      leave_status not null default 'pending',
  notes       text,
  created_at  timestamptz not null default now()
);

create table shifts (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  date        date not null,
  shift_start time,
  shift_end   time,
  branch_id   uuid references branches(id) on delete set null
);
