-- =============================================================
-- Masiat Alsharq ERP — 0037 External recruitment office workflow (Module 01+)
-- An external office is a specialised partner that follows up recruitment
-- requests. The contract creator (admin/sales/call_center) ASSIGNS a recruitment
-- contract to an external-office account; the request then moves to that office,
-- which advances it through configurable recruitment stages and logs follow-ups.
--   • reuses contracts + RBAC (has_perm / get_my_role / is_cross_branch) + the
--     assign_driver pattern from 0018. No new "request" concept — the contract is it.
--   • stages live in a managed config table (no hardcoded enum).
--   • the external office sees ONLY contracts assigned to its own account (RLS).
-- =============================================================

-- ---------- 1) recruitment_stages (managed config — not a hardcoded enum) ------
create table recruitment_stages (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_ar     text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Saudi-realistic recruitment journey (admin can add/disable/reorder from the UI).
insert into recruitment_stages (code, name_ar, sort_order) values
  ('office_contract', 'التعاقد مع المكتب الخارجي', 1),
  ('worker_selection','ترشيح العاملة واختيارها',   2),
  ('visa_issuance',   'إصدار التأشيرة',             3),
  ('medical_exam',    'الفحص الطبي',                4),
  ('visa_stamping',   'تصديق الأوراق وتأشيرة الخروج',5),
  ('ticket_travel',   'حجز التذكرة والسفر',         6),
  ('arrival',         'الوصول إلى المملكة',         7),
  ('handover',        'الاستلام والتسليم للعميل',    8);

alter table recruitment_stages enable row level security;
create policy rs_read on recruitment_stages for select to authenticated
  using (has_perm('contracts','view'));
create policy rs_admin on recruitment_stages for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- 2) assignment + current stage on the existing contracts table ------
alter table contracts
  add column if not exists assigned_office_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at        timestamptz,
  add column if not exists recruitment_stage  text references recruitment_stages(code);
create index if not exists idx_contracts_office on contracts(assigned_office_id);

-- ---------- 3) recruitment_followups (the external office's update log) --------
create table recruitment_followups (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  stage_code  text references recruitment_stages(code),
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_rf_contract on recruitment_followups(contract_id);

alter table recruitment_followups enable row level security;

-- ---------- 4) functions (mirror assign_driver — security definer) -------------

-- Assign a recruitment contract to an external-office account.
create or replace function assign_office(p_contract_id uuid, p_office_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_branch uuid; v_service text; v_role app_role;
begin
  if not has_perm('contracts','edit') then
    raise exception 'لا تملك صلاحية إدارة العقود';
  end if;
  select branch_id, service_code into v_branch, v_service from contracts where id = p_contract_id;
  if v_branch is null and v_service is null then
    raise exception 'العقد غير موجود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch() or v_branch is null) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;
  if v_service is distinct from 'recruitment' then
    raise exception 'الإسناد للمكتب الخارجي متاح لعقود الاستقدام فقط';
  end if;
  select role into v_role from user_profiles where id = p_office_id;
  if v_role is distinct from 'external_office' then
    raise exception 'الحساب المختار ليس مكتباً خارجياً';
  end if;

  update contracts set
    assigned_office_id = p_office_id,
    assigned_at        = now(),
    recruitment_stage  = coalesce(recruitment_stage,
                          (select code from recruitment_stages where is_active order by sort_order limit 1)),
    updated_at         = now()
  where id = p_contract_id;

  insert into recruitment_followups (contract_id, stage_code, note, created_by)
  values (p_contract_id, null, 'تم إسناد العقد للمكتب الخارجي', auth.uid());
end $$;

-- Advance a recruitment contract to a stage + log a follow-up note.
-- Caller must be the assigned office (or admin/ops).
create or replace function advance_recruitment_stage(
  p_contract_id uuid, p_stage text, p_note text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_office uuid;
begin
  select assigned_office_id into v_office from contracts where id = p_contract_id;
  if not found then
    raise exception 'العقد غير موجود';
  end if;
  if not (is_admin() or v_office = auth.uid()) then
    raise exception 'هذا العقد غير مُسند لك';
  end if;
  if not exists (select 1 from recruitment_stages where code = p_stage and is_active) then
    raise exception 'مرحلة غير صحيحة';
  end if;

  update contracts set recruitment_stage = p_stage, updated_at = now()
  where id = p_contract_id;

  insert into recruitment_followups (contract_id, stage_code, note, created_by)
  values (p_contract_id, p_stage, nullif(btrim(coalesce(p_note,'')), ''), auth.uid());
end $$;

grant execute on function assign_office(uuid, uuid),
  advance_recruitment_stage(uuid, text, text) to authenticated;

-- ---------- 5) RLS — external office sees ONLY contracts assigned to it --------
-- Everyone else keeps the branch scope from 0016; external_office is narrowed.
drop policy if exists contracts_read on contracts;
create policy contracts_read on contracts for select to authenticated
  using (
    has_perm('contracts','view') and (
      is_cross_branch()
      or assigned_office_id = auth.uid()
      or (get_my_role() <> 'external_office'
          and (branch_id = get_my_branch() or branch_id is null))
    )
  );

-- follow-ups: readable by anyone who can see the parent contract; writes via RPC.
create policy rf_read on recruitment_followups for select to authenticated using (
  exists (
    select 1 from contracts c
    where c.id = recruitment_followups.contract_id and (
      is_cross_branch()
      or c.assigned_office_id = auth.uid()
      or (get_my_role() <> 'external_office'
          and (c.branch_id = get_my_branch() or c.branch_id is null))
    )
  )
);
create policy rf_insert on recruitment_followups for insert to authenticated
  with check (created_by = auth.uid());
