-- =============================================================
-- Masiat Alsharq ERP — 0073 End of service (المرحلة ز)
-- يُبنى فوق terminate_employee (0069) وأرصدة الإجازات (0070) ودورة المسير ومبدأ الأربع
-- أعين (0071) و has_acc_perm (0057):
--   1) مكافأة نهاية الخدمة وفق نظام العمل: نصف شهر عن كل سنة من الخمس الأولى ثم شهر
--      (م84، وكسور السنة بنسبتها)؛ الاستقالة: أقل من سنتين لا شيء، 2–5 ثلث، 5–10 ثلثان،
--      10 فأكثر كاملة (م85)؛ استقالة بمكافأة كاملة (م87)؛ لا مكافأة لفصل م80.
--   2) بدل رصيد الإجازة السنوية غير المستخدم (م111)، وتعويض الإنهاء غير المشروع (م77):
--      أجر 15 يوماً عن كل سنة وبحد أدنى أجر شهرين.
--   3) أساس أجر المكافأة إعداد يُدار (كامل / أساسي + سكن / أساسي) — لا ثابت في الكود.
--   4) تسوية نهائية: تُعدّها الموارد البشرية ← يعتمدها شخص آخر ← ترحيل ← صرف. مجمّدة بعد الاعتماد.
--   5) مخصص شهري: قيد تسوية يجعل رصيد المخصص (2210) = الالتزام الفعلي للموظفين الحاليين.
-- =============================================================

-- ---------- 1) configuration + reasons --------------------------------------
alter table payroll_config
  add column if not exists eos_wage_basis text not null default 'full'
  check (eos_wage_basis in ('full','basic_housing','basic'));

alter table employees drop constraint if exists employees_termination_reason_chk;
alter table employees add constraint employees_termination_reason_chk check (
  termination_reason is null or termination_reason in
    ('resignation','resignation_art87','employer_termination','contract_end','article_80',
     'retirement','death','other'));

-- ---------- 2) accounts ------------------------------------------------------
insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance)
values ('2200', 'الخصوم غير المتداولة', 'liability', acc_id('2000'), 'credit')
on conflict (code) do nothing;
update chart_of_accounts set is_postable = false where code = '2200';
insert into chart_of_accounts (code, name_ar, type, parent_id, normal_balance) values
  ('2210', 'مخصص مكافأة نهاية الخدمة', 'liability', acc_id('2200'), 'credit'),
  ('5150', 'مصروف مكافأة نهاية الخدمة', 'expense',   acc_id('5000'), 'debit')
on conflict (code) do nothing;

-- ---------- 3) the law, as functions ----------------------------------------
-- service in years (days / 365) between hire and end (inclusive of neither bias)
create or replace function eos_service_years(p_hire date, p_end date)
returns numeric language sql immutable as $$
  select case when p_hire is null or p_end is null or p_end < p_hire then 0
              else round((p_end - p_hire)::numeric / 365, 4) end
$$;

-- م84 + م85 + م87 + م80
create or replace function eos_award(p_years numeric, p_wage numeric, p_reason text)
returns jsonb language plpgsql immutable as $$
declare v_full numeric; v_ratio numeric;
begin
  v_full := round((least(p_years, 5) * 0.5 + greatest(p_years - 5, 0)) * p_wage, 2);
  v_ratio := case
    when p_reason = 'article_80' then 0
    when p_reason = 'resignation' then
      case when p_years < 2 then 0 when p_years < 5 then 1.0 / 3 when p_years < 10 then 2.0 / 3 else 1 end
    else 1 end;
  return jsonb_build_object('full', v_full, 'ratio', round(v_ratio, 4), 'award', round(v_full * v_ratio, 2));
end $$;

-- the wage the award is computed on (config) + the actual full wage (leave / م77)
create or replace function eos_wages(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e employees%rowtype; v_h numeric; v_o numeric; v_basis text; v_full numeric;
begin
  select * into e from employees where id = p_employee_id;
  select housing_allowance, other_allowance into v_h, v_o from employee_details where employee_id = p_employee_id;
  v_h := coalesce(v_h, 0); v_o := coalesce(v_o, 0);
  select eos_wage_basis into v_basis from payroll_config where id = 1;
  v_full := coalesce(e.basic_salary, 0) + v_h + coalesce(e.transport_allowance, 0) + v_o;
  return jsonb_build_object(
    'full', v_full,
    'eos', case coalesce(v_basis, 'full') when 'basic' then coalesce(e.basic_salary, 0)
                                          when 'basic_housing' then coalesce(e.basic_salary, 0) + v_h
                                          else v_full end,
    'basis', coalesce(v_basis, 'full'));
end $$;

create or replace function eos_calculate(
  p_employee_id uuid, p_end date, p_reason text, p_art77 boolean default false
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e employees%rowtype; w jsonb; v_years numeric; a jsonb; v_leave numeric; v_leave_amt numeric;
        v_art77 numeric := 0; v_full numeric;
begin
  if not hr_can_see(p_employee_id) then
    raise exception 'غير مصرّح بحساب مستحقات هذا الموظف' using errcode = '42501';
  end if;
  select * into e from employees where id = p_employee_id;
  if not found then raise exception 'الموظف غير موجود'; end if;
  w := eos_wages(p_employee_id);
  v_full := (w->>'full')::numeric;
  v_years := eos_service_years(e.hire_date, p_end);
  a := eos_award(v_years, (w->>'eos')::numeric, p_reason);
  v_leave := greatest(round(leave_annual_accrued(e.hire_date, p_end) - leave_annual_used(p_employee_id, 'approved'), 2), 0);
  v_leave_amt := round(v_full / 30 * v_leave, 2);
  if p_art77 then
    v_art77 := greatest(round(v_full / 30 * 15 * v_years, 2), round(v_full * 2, 2));
  end if;
  return jsonb_build_object(
    'service_years', v_years, 'wage', (w->>'eos')::numeric, 'full_wage', v_full, 'wage_basis', w->>'basis',
    'award_full', (a->>'full')::numeric, 'award_ratio', (a->>'ratio')::numeric, 'award', (a->>'award')::numeric,
    'leave_days', v_leave, 'leave_amount', v_leave_amt, 'art77_amount', v_art77,
    'total', round((a->>'award')::numeric + v_leave_amt + v_art77, 2));
end $$;

-- ---------- 4) final settlements --------------------------------------------
create table if not exists eos_settlements (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id) on delete restrict,
  end_date         date not null,
  reason           text not null,
  art77            boolean not null default false,
  service_years    numeric(8,4) not null default 0,
  wage             numeric(12,2) not null default 0,
  wage_basis       text not null default 'full',
  award_full       numeric(12,2) not null default 0,
  award_ratio      numeric(6,4)  not null default 1,
  award            numeric(12,2) not null default 0,
  leave_days       numeric(8,2)  not null default 0,
  leave_amount     numeric(12,2) not null default 0,
  art77_amount     numeric(12,2) not null default 0,
  other_additions  numeric(12,2) not null default 0 check (other_additions >= 0),
  other_deductions numeric(12,2) not null default 0 check (other_deductions >= 0),
  note             text,
  net              numeric(12,2) not null default 0,
  status           text not null default 'draft' check (status in ('draft','approved','paid','cancelled')),
  prepared_by      uuid references auth.users(id) on delete set null,
  prepared_at      timestamptz not null default now(),
  approved_by      uuid references auth.users(id) on delete set null,
  approved_at      timestamptz,
  posted_entry_id  uuid,
  posted_at        timestamptz,
  paid_entry_id    uuid,
  paid_at          date
);
create unique index if not exists ux_eos_live on eos_settlements(employee_id) where status <> 'cancelled';
alter table eos_settlements enable row level security;
drop policy if exists eos_read on eos_settlements;
create policy eos_read on eos_settlements for select to authenticated
  using (hr_can_see(employee_id) or has_perm('accounting','view'));
-- writes only through the functions below

create or replace function prepare_eos_settlement(
  p_employee_id uuid, p_art77 boolean default false,
  p_additions numeric default 0, p_deductions numeric default 0, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare e employees%rowtype; c jsonb; v_id uuid;
begin
  if not (has_perm('hr','manage') and hr_in_scope(p_employee_id)) then
    raise exception 'إعداد التسوية من صلاحية الموارد البشرية' using errcode = '42501';
  end if;
  select * into e from employees where id = p_employee_id;
  if e.is_active or e.termination_date is null then
    raise exception 'سجّل إنهاء خدمة الموظف أولاً';
  end if;
  if p_art77 and e.termination_reason <> 'employer_termination' then
    raise exception 'تعويض المادة 77 للإنهاء من صاحب العمل فقط';
  end if;
  if coalesce(p_additions,0) < 0 or coalesce(p_deductions,0) < 0 then raise exception 'المبالغ لا تكون سالبة'; end if;
  if (coalesce(p_additions,0) > 0 or coalesce(p_deductions,0) > 0) and coalesce(btrim(p_note),'') = '' then
    raise exception 'اذكر سبب الإضافات أو الخصومات';
  end if;
  if exists (select 1 from eos_settlements where employee_id = p_employee_id and status in ('approved','paid')) then
    raise exception 'تسوية هذا الموظف معتمدة — لا تُعاد';
  end if;
  c := eos_calculate(p_employee_id, e.termination_date, e.termination_reason, p_art77);
  delete from eos_settlements where employee_id = p_employee_id and status = 'draft';
  insert into eos_settlements (employee_id, end_date, reason, art77, service_years, wage, wage_basis, award_full,
    award_ratio, award, leave_days, leave_amount, art77_amount, other_additions, other_deductions, note, net, prepared_by)
  values (p_employee_id, e.termination_date, e.termination_reason, p_art77, (c->>'service_years')::numeric,
    (c->>'wage')::numeric, c->>'wage_basis', (c->>'award_full')::numeric, (c->>'award_ratio')::numeric,
    (c->>'award')::numeric, (c->>'leave_days')::numeric, (c->>'leave_amount')::numeric, (c->>'art77_amount')::numeric,
    coalesce(p_additions,0), coalesce(p_deductions,0), nullif(btrim(p_note),''),
    round((c->>'total')::numeric + coalesce(p_additions,0) - coalesce(p_deductions,0), 2), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function approve_eos_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s eos_settlements%rowtype;
begin
  if not has_perm('hr','manage') then raise exception 'اعتماد التسوية من صلاحية الإدارة' using errcode = '42501'; end if;
  select * into s from eos_settlements where id = p_id for update;
  if not found then raise exception 'التسوية غير موجودة'; end if;
  if s.status <> 'draft' then raise exception 'التسوية ليست بانتظار الاعتماد'; end if;
  if s.prepared_by = auth.uid() then
    raise exception 'لا يعتمد التسويةَ من أعدّها — يعتمدها شخص آخر (مبدأ الأربع أعين)' using errcode = '42501';
  end if;
  if s.net < 0 then raise exception 'صافي التسوية سالب — راجع الخصومات'; end if;
  update eos_settlements set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
end $$;

create or replace function cancel_eos_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('hr','manage') then raise exception 'غير مصرّح' using errcode = '42501'; end if;
  update eos_settlements set status = 'cancelled' where id = p_id and status = 'draft';
  if not found then raise exception 'لا تُلغى إلا التسوية غير المعتمدة'; end if;
end $$;

-- accrual of the settlement: the award is drawn from the provision (2210)
create or replace function post_eos_settlement(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s eos_settlements%rowtype; v_entry uuid; v_branch uuid;
begin
  if not has_acc_perm('gl','post') then raise exception 'ترحيل التسوية من صلاحية المحاسبة' using errcode = '42501'; end if;
  select * into s from eos_settlements where id = p_id for update;
  if not found then raise exception 'التسوية غير موجودة'; end if;
  if s.status not in ('approved','paid') then raise exception 'لا تُرحَّل إلا تسوية معتمدة'; end if;
  if s.posted_entry_id is not null then return s.posted_entry_id; end if;
  select branch_id into v_branch from employees where id = s.employee_id;
  insert into journal_entries (entry_date, period_id, branch_id, description, reference, source_type, source_id)
  values (s.end_date, ensure_period(s.end_date), v_branch,
          'تسوية نهاية خدمة', 'EOS-' || left(s.id::text, 8), 'payroll', s.id)
  returning id into v_entry;
  if s.award > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('2210'), s.award, 0, v_branch, 'مكافأة نهاية الخدمة (من المخصص)');
  end if;
  if s.leave_amount > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('5100'), s.leave_amount, 0, v_branch, 'بدل رصيد الإجازات');
  end if;
  if s.art77_amount + s.other_additions > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('5150'), s.art77_amount + s.other_additions, 0, v_branch, 'تعويضات ومستحقات أخرى');
  end if;
  if s.other_deductions > 0 then
    insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
    values (v_entry, acc_id('1160'), 0, s.other_deductions, v_branch, 'مبالغ مستحقة على الموظف');
  end if;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, branch_id, description)
  values (v_entry, acc_id('2130'), 0, s.net, v_branch, 'مستحقات نهاية الخدمة');
  update eos_settlements set posted_entry_id = v_entry, posted_at = now() where id = p_id;
  return v_entry;
end $$;

create or replace function pay_eos_settlement(p_id uuid, p_paid_on date, p_bank_code text default '1112')
returns uuid language plpgsql security definer set search_path = public as $$
declare s eos_settlements%rowtype; v_entry uuid;
begin
  if not has_acc_perm('bank','post') then raise exception 'صرف التسوية من صلاحية المحاسبة' using errcode = '42501'; end if;
  select * into s from eos_settlements where id = p_id for update;
  if not found then raise exception 'التسوية غير موجودة'; end if;
  if s.posted_entry_id is null then raise exception 'رحّل قيد التسوية أولاً'; end if;
  if s.status = 'paid' then return s.paid_entry_id; end if;
  if p_bank_code not like '111%' then raise exception 'اختر حساب بنك أو صندوق'; end if;
  insert into journal_entries (entry_date, period_id, description, reference, source_type, source_id)
  values (p_paid_on, ensure_period(p_paid_on), 'صرف تسوية نهاية خدمة', 'EOS-PAY-' || left(s.id::text, 8), 'payroll', s.id)
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, description) values
    (v_entry, acc_id('2130'), s.net, 0, 'إطفاء مستحقات نهاية الخدمة'),
    (v_entry, acc_id(p_bank_code), 0, s.net, 'صرف تسوية نهاية الخدمة');
  update eos_settlements set status = 'paid', paid_at = p_paid_on, paid_entry_id = v_entry where id = p_id;
  return v_entry;
end $$;

-- frozen after approval (the functions above only touch posting / payment fields)
create or replace function guard_eos_frozen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved','paid') then raise exception 'تسوية معتمدة لا تُحذف' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status in ('approved','paid') and (new.net is distinct from old.net or new.award is distinct from old.award
     or new.employee_id is distinct from old.employee_id or new.status not in ('approved','paid')) then
    raise exception 'التسوية المعتمدة مجمّدة' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_eos on eos_settlements;
create trigger trg_guard_eos before update or delete on eos_settlements
  for each row execute function guard_eos_frozen();

-- ---------- 5) monthly provision (true-up) ----------------------------------
-- liability if every current employee left at p_as_of by employer termination (م84, full)
create or replace function eos_provision_target(p_as_of date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum((eos_award(eos_service_years(e.hire_date, p_as_of),
                                 (eos_wages(e.id)->>'eos')::numeric, 'employer_termination')->>'award')::numeric), 0)
    from employees e
   where e.is_active and e.hire_date is not null and e.hire_date <= p_as_of
$$;

create or replace function post_eos_provision(p_period text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_end date; v_target numeric; v_bal numeric; v_delta numeric; v_entry uuid;
begin
  if not has_acc_perm('gl','post') then raise exception 'ترحيل المخصص من صلاحية المحاسبة' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صحيح'; end if;
  select id into v_entry from journal_entries where reference = 'EOS-PROV-' || p_period;
  if v_entry is not null then raise exception 'مخصص % مُرحَّل بالفعل', p_period; end if;
  v_end := (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  v_target := round(eos_provision_target(v_end), 2);
  select coalesce(sum(l.credit - l.debit), 0) into v_bal
    from journal_entry_lines l join journal_entries j on j.id = l.entry_id
   where l.account_id = acc_id('2210') and j.status = 'posted' and j.entry_date <= v_end;
  v_delta := round(v_target - v_bal, 2);
  if v_delta = 0 then
    return jsonb_build_object('target', v_target, 'balance', v_bal, 'delta', 0, 'entry', null);
  end if;
  insert into journal_entries (entry_date, period_id, description, reference, source_type)
  values (v_end, ensure_period(v_end), 'مخصص مكافأة نهاية الخدمة ' || p_period, 'EOS-PROV-' || p_period, 'payroll')
  returning id into v_entry;
  insert into journal_entry_lines (entry_id, account_id, debit, credit, description) values
    (v_entry, acc_id('5150'), greatest(v_delta, 0), greatest(-v_delta, 0), 'مصروف مكافأة نهاية الخدمة'),
    (v_entry, acc_id('2210'), greatest(-v_delta, 0), greatest(v_delta, 0), 'مخصص مكافأة نهاية الخدمة');
  return jsonb_build_object('target', v_target, 'balance', v_bal, 'delta', v_delta, 'entry', v_entry);
end $$;

grant execute on function eos_service_years(date, date), eos_award(numeric, numeric, text),
  eos_calculate(uuid, date, text, boolean), prepare_eos_settlement(uuid, boolean, numeric, numeric, text),
  approve_eos_settlement(uuid), cancel_eos_settlement(uuid), post_eos_settlement(uuid),
  pay_eos_settlement(uuid, date, text), eos_provision_target(date), post_eos_provision(text)
  to authenticated;
revoke execute on function eos_wages(uuid) from public, anon, authenticated;

drop trigger if exists trg_audit_row on eos_settlements;
create trigger trg_audit_row after insert or update or delete on eos_settlements
  for each row execute function audit_row_change();
