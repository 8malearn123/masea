-- =============================================================
-- Masiat Alsharq ERP — 0001 Extensions & Enums
-- Vendor: Qimmah Code | Contract: QUO-000105
-- =============================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "uuid-ossp";

-- ---------- Enums ----------
create type worker_status      as enum ('available','on_service','absent','medical','terminated');
create type customer_segment   as enum ('bronze','silver','gold');
create type driver_status      as enum ('available','on_route','off_duty');

create type service_type       as enum ('monthly','daily','hourly_8','hourly_5','direct','cleaning','kafala');
create type contract_status    as enum ('draft','active','completed','cancelled');
create type payment_method     as enum ('cash','mada','apple_pay','tamara','transfer');

create type scan_type          as enum ('warehouse_out','customer_arrived','service_end','warehouse_in');
create type penalty_type       as enum ('late_return','false_report','other');

create type attendance_status  as enum ('present','absent','late','leave');
create type payroll_status     as enum ('draft','approved','transferred');
create type leave_status       as enum ('pending','approved','rejected');

create type loyalty_txn_type   as enum ('earn','redeem','cashback','referral');
create type campaign_type      as enum ('hourly_offer','first_order','lucky_wheel','referral','general');

create type housing_status     as enum ('present','absent','on_service','medical');

create type app_role           as enum (
  'admin','operations_manager','branch_manager','sales','call_center',
  'driver','housing_supervisor','hr','accountant','external_office'
);
