-- =============================================================
-- Masiat Alsharq ERP — 0040 Recruitment: stage documents + visa/travel data
-- Extends the external-office workflow (0037): the assigned office can now do
-- the two actions it was missing — attach the documents of each stage (visa,
-- medical result, passport, ticket…) and record the visa/travel data.
--   • reuses contracts + recruitment_stages + the assigned-office scoping and the
--     security-definer RPC pattern from 0037. No new "request/office" concept.
--   • doc_type is free text (admin-extensible) — no hardcoded enum.
-- =============================================================

-- ---------- 1) visa / travel data on the existing contracts table --------------
alter table contracts
  add column if not exists visa_number          text,
  add column if not exists expected_arrival_date date,
  add column if not exists flight_no            text;

-- ---------- 2) recruitment_documents (per-stage attachments) -------------------
create table recruitment_documents (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references contracts(id) on delete cascade,
  stage_code   text references recruitment_stages(code),
  doc_type     text not null,            -- visa | medical | passport | ticket | other (extensible)
  file_name    text not null,
  storage_path text,                     -- Supabase Storage object path (null in demo)
  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index idx_rdoc_contract on recruitment_documents(contract_id);

alter table recruitment_documents enable row level security;

-- readable by anyone who can see the parent contract (same scope as follow-ups)
create policy rdoc_read on recruitment_documents for select to authenticated using (
  exists (
    select 1 from contracts c
    where c.id = recruitment_documents.contract_id and (
      is_cross_branch()
      or c.assigned_office_id = auth.uid()
      or (get_my_role() <> 'external_office'
          and (c.branch_id = get_my_branch() or c.branch_id is null))
    )
  )
);
create policy rdoc_insert on recruitment_documents for insert to authenticated
  with check (uploaded_by = auth.uid());

-- ---------- 3) set_recruitment_travel() — assigned office / ops only -----------
create or replace function set_recruitment_travel(
  p_contract_id uuid,
  p_visa_number text default null,
  p_expected_arrival_date date default null,
  p_flight_no text default null)
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

  update contracts set
    visa_number           = nullif(btrim(coalesce(p_visa_number,'')), ''),
    expected_arrival_date = p_expected_arrival_date,
    flight_no             = nullif(btrim(coalesce(p_flight_no,'')), ''),
    updated_at            = now()
  where id = p_contract_id;
end $$;

-- ---------- 4) add_recruitment_document() — assigned office / ops only ----------
create or replace function add_recruitment_document(
  p_contract_id uuid,
  p_doc_type text,
  p_file_name text,
  p_storage_path text default null,
  p_stage text default null)
returns recruitment_documents language plpgsql security definer set search_path = public
as $$
declare v_office uuid; v_row recruitment_documents;
begin
  select assigned_office_id into v_office from contracts where id = p_contract_id;
  if not found then
    raise exception 'العقد غير موجود';
  end if;
  if not (is_admin() or v_office = auth.uid()) then
    raise exception 'هذا العقد غير مُسند لك';
  end if;
  if coalesce(btrim(p_doc_type),'') = '' or coalesce(btrim(p_file_name),'') = '' then
    raise exception 'نوع المستند واسم الملف مطلوبان';
  end if;

  insert into recruitment_documents (contract_id, stage_code, doc_type, file_name, storage_path, uploaded_by)
  values (p_contract_id, p_stage, btrim(p_doc_type), btrim(p_file_name), p_storage_path, auth.uid())
  returning * into v_row;
  return v_row;
end $$;

grant execute on function set_recruitment_travel(uuid, text, date, text),
  add_recruitment_document(uuid, text, text, text, text) to authenticated;
