-- =============================================================
-- Masiat Alsharq ERP — 0008 Triggers (all 5 required groups)
-- =============================================================

-- ------------------------------------------------------------------
-- (1) scans_log INSERT -> auto-update workers.status
-- ------------------------------------------------------------------
create or replace function trg_scan_update_worker_status()
returns trigger language plpgsql as $$
begin
  if new.worker_id is null then
    return new;
  end if;
  update workers
     set status = case new.scan_type
       when 'warehouse_out'   then 'on_service'::worker_status
       when 'customer_arrived' then 'on_service'::worker_status
       when 'service_end'      then 'on_service'::worker_status
       when 'warehouse_in'     then 'available'::worker_status
       else status end
   where id = new.worker_id;
  return new;
end $$;

create trigger scans_update_worker_status
after insert on scans_log
for each row execute function trg_scan_update_worker_status();

-- ------------------------------------------------------------------
-- (2) contracts -> on completion compute late_return_days + penalty
-- ------------------------------------------------------------------
-- BEFORE: compute late days so the value is persisted on the row
create or replace function trg_contract_compute_late()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    if new.end_date is not null then
      new.late_return_days := greatest(0, current_date - new.end_date);
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger contracts_compute_late
before update on contracts
for each row execute function trg_contract_compute_late();

-- AFTER: insert a late_return penalty when applicable
create or replace function trg_contract_penalty()
returns trigger language plpgsql as $$
declare
  daily numeric(12,2);
begin
  if new.status = 'completed' and (old.status is distinct from 'completed')
     and coalesce(new.late_return_days,0) > 0 then
    select coalesce(w.daily_rate, 0) into daily from workers w where w.id = new.worker_id;
    insert into penalties (contract_id, type, amount, days, is_paid)
    values (new.id, 'late_return', coalesce(daily,0) * new.late_return_days, new.late_return_days, false);
  end if;
  return new;
end $$;

create trigger contracts_penalty
after update on contracts
for each row execute function trg_contract_penalty();

-- ------------------------------------------------------------------
-- (3) contracts INSERT -> bump target_progress for creating user
-- ------------------------------------------------------------------
create or replace function trg_contract_target_progress()
returns trigger language plpgsql as $$
declare
  tgt_id uuid;
begin
  if new.created_by is null then
    return new;
  end if;
  select t.id into tgt_id
    from targets t
   where t.user_id = new.created_by
     and t.month = extract(month from new.created_at)::int
     and t.year  = extract(year  from new.created_at)::int
   limit 1;

  if tgt_id is not null then
    insert into target_progress (target_id, contracts_achieved, updated_at)
    values (tgt_id, 1, now())
    on conflict (target_id)
    do update set contracts_achieved = target_progress.contracts_achieved + 1,
                  updated_at = now();
  end if;
  return new;
end $$;

create trigger contracts_target_progress
after insert on contracts
for each row execute function trg_contract_target_progress();

-- ------------------------------------------------------------------
-- (4) loyalty_transactions INSERT -> update customer points + wallet
-- ------------------------------------------------------------------
create or replace function trg_loyalty_apply()
returns trigger language plpgsql as $$
begin
  update customers c
     set loyalty_points = greatest(0, c.loyalty_points + case
            when new.type = 'earn'   then new.points
            when new.type = 'redeem' then -new.points
            else 0 end),
         wallet_balance = c.wallet_balance + case
            when new.type in ('cashback','referral') then new.amount
            else 0 end
   where c.id = new.customer_id;
  return new;
end $$;

create trigger loyalty_apply
after insert on loyalty_transactions
for each row execute function trg_loyalty_apply();

-- ------------------------------------------------------------------
-- (5) payroll INSERT/UPDATE -> validate/normalize GOSI by nationality
--     Saudi:    employee 9.75% , company 11.75% (incl. SANED)
--     Non-Saudi: employee 0%    , company 2% (occupational hazard)
-- ------------------------------------------------------------------
create or replace function trg_payroll_gosi()
returns trigger language plpgsql as $$
declare
  nat text;
  base_amt numeric(12,2);
begin
  select e.nationality, coalesce(new.basic, e.basic_salary, 0)
    into nat, base_amt
    from employees e where e.id = new.employee_id;

  if lower(coalesce(nat,'')) in ('saudi','سعودي','سعودية','sa') then
    new.gosi_employee := round(base_amt * 0.0975, 2);
    new.gosi_company  := round(base_amt * 0.1175, 2);
  else
    new.gosi_employee := 0;
    new.gosi_company  := round(base_amt * 0.02, 2);
  end if;

  -- recompute net defensively
  new.net := round(
    coalesce(new.basic,0) + coalesce(new.transport,0) + coalesce(new.overtime,0)
    - coalesce(new.deductions,0) - new.gosi_employee, 2);
  return new;
end $$;

create trigger payroll_gosi
before insert or update on payroll
for each row execute function trg_payroll_gosi();
