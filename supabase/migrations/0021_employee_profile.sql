-- =============================================================
-- Masiat Alsharq ERP — 0021 Employee profile (module 05)
-- Extends the EXISTING `employees` table (do NOT create a parallel one).
-- Adds 1:1 details + documents + emergency contacts + audit log.
-- Reuses branches, has_perm, current_branch_id, auth.users.
-- =============================================================

-- link an employee to a login (for self-service RLS)
alter table employees add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table employees add column if not exists employee_no text;
create index if not exists idx_employees_user on employees(user_id);

-- ---------- 1:1 extended details --------------------------------
create table employee_details (
  employee_id          uuid primary key references employees(id) on delete cascade,
  english_name         text,
  photo_url            text,
  dob                  date,
  gender               text check (gender in ('male','female')),
  marital_status       text,
  national_address     text,
  email                text,
  id_type              text not null default 'saudi' check (id_type in ('saudi','expat')),
  iqama_no             text,
  passport_no          text,
  border_no            text,
  department           text,
  contract_type        text default 'full_time' check (contract_type in ('full_time','part_time','temp')),
  manager_id           uuid references employees(id) on delete set null,
  employment_status    text not null default 'active' check (employment_status in ('active','suspended','terminated')),
  -- payroll / WPS (sensitive)
  iban                 text,
  bank_name            text,
  housing_allowance    numeric(12,2) not null default 0,
  other_allowance      numeric(12,2) not null default 0,
  -- GOSI: old system (registered before 2024-07-03) vs new
  gosi_system          text default 'new' check (gosi_system in ('old','new')),
  gosi_reg_date        date,
  gosi_subscription_no text,
  counts_in_saudization boolean not null default false, -- سعودي = true
  updated_at           timestamptz not null default now()
);

-- ---------- documents (metadata; files live in Storage) ---------
create table employee_documents (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  type        text not null,            -- iqama|passport|work_permit|visa|contract|cv|medical|driving_license|national_id|certificate|photo|other
  file_path   text,                     -- storage object path
  file_name   text,
  issue_date  date,
  expiry_date date,                     -- null = no expiry
  created_at  timestamptz not null default now()
);
create index idx_emp_docs_employee on employee_documents(employee_id);
create index idx_emp_docs_expiry on employee_documents(expiry_date) where expiry_date is not null;

-- ---------- emergency contacts (1:many) -------------------------
create table employee_emergency_contacts (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  name        text not null,
  relation    text,
  phone       text not null
);
create index idx_emp_emergency_employee on employee_emergency_contacts(employee_id);

-- ---------- audit log -------------------------------------------
create table employee_audit_log (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  actor       uuid references auth.users(id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}',
  changed_at  timestamptz not null default now()
);
create index idx_emp_audit_employee on employee_audit_log(employee_id);

-- ---------- expiry status helper --------------------------------
-- valid / expiring (<= threshold days) / expired — threshold default 30
create or replace function doc_expiry_status(p_expiry date, p_days integer default 30)
returns text language sql immutable as $$
  select case
    when p_expiry is null then 'valid'
    when p_expiry < current_date then 'expired'
    when p_expiry <= current_date + (p_days || ' days')::interval then 'expiring'
    else 'valid'
  end;
$$;

-- ---------- seed (realistic Saudis + expats) --------------------
do $$
declare v_emp uuid; v_mgr uuid;
begin
  -- manager (Saudi)
  insert into employees (full_name, role, nationality, national_id, phone, hire_date, basic_salary, transport_allowance, is_active, employee_no)
  values ('سلطان المالكي', 'admin', 'السعودية', '1012345678', '0551000010', '2021-02-01', 25000, 1500, true, 'EMP-1001')
  returning id into v_mgr;
  insert into employee_details (employee_id, english_name, gender, id_type, department, contract_type, employment_status, iban, bank_name, gosi_system, gosi_reg_date, gosi_subscription_no, counts_in_saudization, email)
  values (v_mgr, 'Sultan Almalki', 'male', 'saudi', 'الإدارة', 'full_time', 'active', 'SA0380000000608010167519', 'الراجحي', 'old', '2021-02-01', 'G-558210', true, 'sultan@masiat.sa');

  -- expat driver
  insert into employees (full_name, role, nationality, national_id, phone, hire_date, basic_salary, transport_allowance, is_active, employee_no, branch_id)
  values ('راجيش كومار', 'driver', 'الهند', '2455667788', '0551000020', '2023-06-15', 4500, 600, true, 'EMP-1002', (select id from branches limit 1))
  returning id into v_emp;
  insert into employee_details (employee_id, english_name, gender, id_type, iqama_no, passport_no, border_no, department, manager_id, gosi_system, counts_in_saudization, email)
  values (v_emp, 'Rajesh Kumar', 'male', 'expat', '2455667788', 'N4567890', '3450012345', 'العمليات', v_mgr, 'new', false, 'rajesh@masiat.sa');
  insert into employee_documents (employee_id, type, file_name, issue_date, expiry_date) values
    (v_emp, 'iqama', 'iqama_rajesh.pdf', '2024-01-10', current_date + 20),       -- expiring
    (v_emp, 'passport', 'passport_rajesh.pdf', '2020-05-01', current_date + 400),
    (v_emp, 'driving_license', 'license_rajesh.pdf', '2023-07-01', current_date - 5), -- expired
    (v_emp, 'work_permit', 'permit_rajesh.pdf', '2024-01-10', current_date + 200);
  insert into employee_emergency_contacts (employee_id, name, relation, phone)
  values (v_emp, 'سونيل كومار', 'أخ', '0539999001');

  -- Saudi female housing supervisor
  insert into employees (full_name, role, nationality, national_id, phone, hire_date, basic_salary, transport_allowance, is_active, employee_no, branch_id)
  values ('منى الغامدي', 'housing_supervisor', 'السعودية', '1099887766', '0551000030', '2024-03-18', 7000, 800, true, 'EMP-1003', (select id from branches limit 1))
  returning id into v_emp;
  insert into employee_details (employee_id, english_name, gender, id_type, department, manager_id, gosi_system, gosi_reg_date, counts_in_saudization, iban, bank_name, email)
  values (v_emp, 'Mona Alghamdi', 'female', 'saudi', 'السكن', v_mgr, 'new', '2024-03-18', true, 'SA4420000001234567891234', 'الأهلي', 'mona@masiat.sa');
  insert into employee_documents (employee_id, type, file_name, issue_date, expiry_date) values
    (v_emp, 'national_id', 'id_mona.pdf', '2022-01-01', current_date + 800),
    (v_emp, 'contract', 'contract_mona.pdf', '2024-03-18', null);
end $$;

-- =============================================================
-- RLS
-- =============================================================
alter table employee_details            enable row level security;
alter table employee_documents          enable row level security;
alter table employee_emergency_contacts enable row level security;
alter table employee_audit_log           enable row level security;

create or replace function owns_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where id = p_employee_id and user_id = auth.uid());
$$;

create or replace function emp_in_my_branch(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id and e.branch_id = current_branch_id()
  );
$$;

-- details: HR full; branch manager reads own branch; employee reads own.
-- (financial columns live here → branch managers get read via branch but
--  management/writes require hr.manage.)
create policy emp_details_read on employee_details for select
  using (has_perm('hr','view') or emp_in_my_branch(employee_id) or owns_employee(employee_id));
create policy emp_details_write on employee_details for all
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

create policy emp_docs_read on employee_documents for select
  using (has_perm('hr','view') or owns_employee(employee_id));
create policy emp_docs_write on employee_documents for all
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

create policy emp_emergency_read on employee_emergency_contacts for select
  using (has_perm('hr','view') or owns_employee(employee_id));
create policy emp_emergency_write on employee_emergency_contacts for all
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));

create policy emp_audit_read on employee_audit_log for select using (has_perm('hr','view'));
