-- =============================================================
-- Masiat Alsharq ERP — 0016 Smart Contracts (Module 01)
-- Built on top of the existing `contracts` table + RBAC (module 11).
-- =============================================================

-- ---------- contract_templates (clause templates per service) ----------
create table contract_templates (
  id           uuid primary key default gen_random_uuid(),
  service_code text not null references services(code) on delete cascade,
  name         text not null,
  clauses      jsonb not null default '[]'::jsonb,  -- array of clause strings with {{vars}}
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index idx_contract_templates_service on contract_templates(service_code);

-- ---------- extend the existing contracts table ----------
alter table contracts
  add column if not exists contract_no         text unique,
  add column if not exists service_code        text references services(code),
  add column if not exists template_id         uuid references contract_templates(id) on delete set null,
  add column if not exists version             integer not null default 1,
  add column if not exists parent_contract_id  uuid references contracts(id) on delete set null,
  add column if not exists signed_at           timestamptz;
-- the legacy enum service_type becomes optional (service_code is the source going forward)
alter table contracts alter column service_type drop not null;

-- ---------- frozen clause snapshot (immutable per contract) ----------
create table contract_clauses (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  sort_order  integer not null default 0,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index idx_contract_clauses_contract on contract_clauses(contract_id);

-- ---------- signatures ----------
create table contract_signatures (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references contracts(id) on delete cascade,
  signer_type     text not null check (signer_type in ('customer', 'company')),
  signer_name     text,
  signature_image text,           -- Supabase Storage path
  ip_address      text,
  signed_at       timestamptz not null default now()
);
create index idx_contract_signatures_contract on contract_signatures(contract_id);

-- ---------- status history (every transition) ----------
create table contract_status_history (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_csh_contract on contract_status_history(contract_id);

-- link a funnel request to the contract it became
alter table service_requests add column if not exists contract_id uuid references contracts(id) on delete set null;

-- =============================================================
-- DB functions
-- =============================================================

-- Auto contract number: MAS-{year}-{00001}
create sequence if not exists contract_no_seq;
create or replace function generate_contract_no(p_year integer default extract(year from now())::int)
returns text language sql volatile
as $$ select 'MAS-' || p_year::text || '-' || lpad(nextval('contract_no_seq')::text, 5, '0') $$;

-- Pricing is always computed in the backend (reuses the funnel engine, VAT 15%).
create or replace function calc_contract_price(p_service_code text, p_params jsonb)
returns jsonb language sql stable security definer set search_path = public
as $$ select calc_price(p_service_code, p_params) $$;

grant execute on function generate_contract_no(integer), calc_contract_price(text, jsonb) to authenticated;

-- State machine — the ONLY legal way to change a contract's status.
create or replace function transition_contract(p_contract_id uuid, p_to_status text)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_from    contract_status;
  v_branch  uuid;
  v_allowed text[];
  v_row     contracts;
begin
  select status, branch_id into v_from, v_branch
  from contracts where id = p_contract_id for update;

  if v_from is null then
    raise exception 'العقد غير موجود';
  end if;

  -- permission + branch scope
  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if p_to_status = 'approved' and not has_perm('contracts', 'approve') then
    raise exception 'لا تملك صلاحية اعتماد العقود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  v_allowed := case v_from::text
    when 'draft'              then array['pending_approval', 'cancelled']
    when 'pending_approval'   then array['approved', 'draft', 'cancelled']
    when 'approved'           then array['awaiting_signature', 'cancelled']
    when 'awaiting_signature' then array['signed', 'cancelled']
    when 'signed'             then array['active']
    when 'active'             then array['completed', 'cancelled']
    else array[]::text[]
  end;

  if not (p_to_status = any(v_allowed)) then
    raise exception 'انتقال غير مشروع من % إلى %', v_from, p_to_status;
  end if;

  update contracts set
    status     = p_to_status::contract_status,
    signed_at  = case when p_to_status = 'signed' then now() else signed_at end,
    updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (p_contract_id, v_from::text, p_to_status, auth.uid());

  return v_row;
end $$;

grant execute on function transition_contract(uuid, text) to authenticated;

-- =============================================================
-- RLS (built on module 11 — has_perm + branch scope)
-- =============================================================
alter table contract_templates      enable row level security;
alter table contract_clauses        enable row level security;
alter table contract_signatures     enable row level security;
alter table contract_status_history enable row level security;

-- replace the generic branch policies from 0009 with permission-aware ones
drop policy if exists contracts_branch_read on contracts;
drop policy if exists contracts_branch_write on contracts;

create policy contracts_read on contracts for select to authenticated
  using (has_perm('contracts', 'view')
         and (is_cross_branch() or branch_id = get_my_branch() or branch_id is null));

create policy contracts_insert on contracts for insert to authenticated
  with check (has_perm('contracts', 'create')
              and (is_cross_branch() or branch_id = get_my_branch()));

-- only DRAFTs are editable, and only within scope → signed contracts are immutable
create policy contracts_update_draft on contracts for update to authenticated
  using (has_perm('contracts', 'edit') and status = 'draft'
         and (is_cross_branch() or branch_id = get_my_branch()))
  with check (status = 'draft');

create policy contracts_delete_draft on contracts for delete to authenticated
  using (has_perm('contracts', 'delete') and status = 'draft'
         and (is_cross_branch() or branch_id = get_my_branch()));

-- templates: read with contracts.view; manage by admin
create policy ct_read on contract_templates for select to authenticated
  using (has_perm('contracts', 'view'));
create policy ct_admin on contract_templates for all to authenticated
  using (is_admin()) with check (is_admin());

-- clauses / signatures / history: read with view; writes guarded by edit/create
create policy cc_read on contract_clauses for select to authenticated
  using (has_perm('contracts', 'view'));
create policy cc_write on contract_clauses for all to authenticated
  using (has_perm('contracts', 'create') or has_perm('contracts', 'edit'))
  with check (has_perm('contracts', 'create') or has_perm('contracts', 'edit'));

create policy cs_read on contract_signatures for select to authenticated
  using (has_perm('contracts', 'view'));
create policy cs_insert on contract_signatures for insert to authenticated
  with check (has_perm('contracts', 'edit'));

create policy csh_read on contract_status_history for select to authenticated
  using (has_perm('contracts', 'view'));
create policy csh_insert on contract_status_history for insert to authenticated
  with check (true);
