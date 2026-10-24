-- =============================================================
-- Masiat Alsharq ERP — 0052 Contract lifecycle hardening (Module 01)
-- Fixes found in the contracts review:
--   1. إنشاء العقد لم يكن ذرّياً: السعر والرقم والبنود تُحفظ بطلبات منفصلة من
--      الواجهة، والفرع يُرسل اسماً لا UUID فيفشل الإدراج بصمت.
--      → create_contract_draft(): يسعّر عبر calc_price (مع الخصم المعرّف مسبقاً)
--        ويولّد الرقم ويجمّد البنود ويسجّل الحالة الأولى في معاملة واحدة.
--   2. لا يوجد مسار لتعديل المسودة أو تجديد العقد (نسخة جديدة).
--      → update_contract_draft() + renew_contract() (versioning عبر parent_contract_id).
--   3. يمكن نقل العقد إلى «موقّع» دون توقيعات، وإلى «أُنشئ على مساند» دون رقم مساند.
--      → transition_contract() يتحقّق من ذلك ويكتب في audit_log.
-- يُبنى فوق: contracts, contract_clauses, contract_status_history, branches,
-- promotions/evaluate_promotion (0051), calc_price, has_perm, get_my_branch.
-- =============================================================

-- ---------- 1) discount trail on the contract ----------------
-- base_amount stays the NET taxable amount (vat/total are generated from it).
alter table contracts
  add column if not exists gross_amount    numeric(12,2),
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists promotion_id    uuid references promotions(id) on delete set null,
  add column if not exists pricing_params  jsonb;

-- ---------- 2) helper: branch by uuid OR name/city -----------
create or replace function resolve_branch_id(p_branch text)
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_branch is null or btrim(p_branch) = '' then return null; end if;
  begin
    v_id := p_branch::uuid;
    return v_id;
  exception when invalid_text_representation then
    null;
  end;
  select id into v_id from branches
  where is_active and (city = btrim(p_branch) or name = btrim(p_branch)
                       or name = 'فرع ' || btrim(p_branch))
  limit 1;
  return v_id;
end $$;

-- ---------- 3) atomic draft creation -------------------------
create or replace function create_contract_draft(p_input jsonb, p_clauses jsonb default '[]'::jsonb)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_service text := p_input->>'service_code';
  v_branch  uuid := resolve_branch_id(p_input->>'branch');
  v_params  jsonb;
  v_price   jsonb;
  v_promo   uuid := nullif(p_input->>'promotion_id', '')::uuid;
  v_row     contracts;
  v_clause  text;
  v_i       integer := 0;
begin
  if not has_perm('contracts', 'create') then
    raise exception 'لا تملك صلاحية إنشاء العقود';
  end if;
  if v_service is null or not exists (select 1 from services where code = v_service) then
    raise exception 'نوع الخدمة غير صحيح';
  end if;
  if nullif(p_input->>'customer_id', '') is null then
    raise exception 'اختر العميل';
  end if;
  if v_branch is null then
    raise exception 'الفرع غير معروف';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'لا يمكنك إنشاء عقد خارج نطاق فرعك';
  end if;
  if nullif(p_input->>'start_date', '') is null then
    raise exception 'حدّد تاريخ البداية';
  end if;
  if nullif(p_input->>'end_date', '') is not null
     and (p_input->>'end_date')::date < (p_input->>'start_date')::date then
    raise exception 'تاريخ النهاية قبل تاريخ البداية';
  end if;

  v_params := jsonb_strip_nulls(jsonb_build_object(
    'nationality',  p_input->>'nationality',
    'profession',   p_input->>'profession',
    'quantity',     coalesce((p_input->>'quantity')::numeric, 1),
    'promotion_id', v_promo
  ));
  v_price := calc_price(v_service, v_params);
  if v_promo is not null and not coalesce((v_price->>'promotion_ok')::boolean, false) then
    raise exception 'لا يمكن تطبيق الخصم: %', coalesce(v_price->>'promotion_reason', 'غير مؤهل');
  end if;
  if coalesce((v_price->>'base')::numeric, 0) <= 0 then
    raise exception 'لا توجد قاعدة تسعير فعّالة لهذه الخدمة';
  end if;

  insert into contracts (
    contract_no, service_code, template_id, customer_id, worker_id, branch_id,
    start_date, end_date, gross_amount, discount_amount, promotion_id, base_amount,
    musaned_contract_no, pricing_params, status, created_by
  ) values (
    generate_contract_no(), v_service, nullif(p_input->>'template_id', '')::uuid,
    (p_input->>'customer_id')::uuid, nullif(p_input->>'worker_id', '')::uuid, v_branch,
    (p_input->>'start_date')::date, nullif(p_input->>'end_date', '')::date,
    (v_price->>'base')::numeric, (v_price->>'discounts')::numeric, v_promo,
    (v_price->>'net')::numeric,
    nullif(btrim(coalesce(p_input->>'musaned_contract_no', '')), ''), v_params, 'draft', auth.uid()
  ) returning * into v_row;

  -- frozen clause snapshot (internal contracts only send clauses)
  for v_clause in select jsonb_array_elements_text(coalesce(p_clauses, '[]'::jsonb)) loop
    insert into contract_clauses (contract_id, sort_order, body) values (v_row.id, v_i, v_clause);
    v_i := v_i + 1;
  end loop;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());

  if v_promo is not null then
    update promotions set usage_count = usage_count + 1, updated_at = now() where id = v_promo;
  end if;

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.create', 'contracts', v_row.id, to_jsonb(v_row));

  return v_row;
end $$;

grant execute on function create_contract_draft(jsonb, jsonb) to authenticated;

-- ---------- 4) edit a draft ----------------------------------
create or replace function update_contract_draft(p_contract_id uuid, p_patch jsonb)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_old    contracts;
  v_row    contracts;
  v_branch uuid;
begin
  select * into v_old from contracts where id = p_contract_id for update;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'لا يُعدَّل إلا العقد في حالة المسودة';
  end if;
  if not (is_cross_branch() or v_old.branch_id = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  v_branch := coalesce(resolve_branch_id(p_patch->>'branch'), v_old.branch_id);
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'لا يمكنك نقل العقد خارج نطاق فرعك';
  end if;

  update contracts set
    start_date = coalesce(nullif(p_patch->>'start_date', '')::date, start_date),
    end_date   = case when p_patch ? 'end_date'
                      then nullif(p_patch->>'end_date', '')::date else end_date end,
    branch_id  = v_branch,
    updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  if v_row.end_date is not null and v_row.start_date is not null
     and v_row.end_date < v_row.start_date then
    raise exception 'تاريخ النهاية قبل تاريخ البداية';
  end if;

  insert into audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'contract.update_draft', 'contracts', p_contract_id,
          to_jsonb(v_old), to_jsonb(v_row));
  return v_row;
end $$;

grant execute on function update_contract_draft(uuid, jsonb) to authenticated;

-- ---------- 5) renewal = a NEW version (signed contracts are immutable) ----
create or replace function renew_contract(p_contract_id uuid)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_old   contracts;
  v_row   contracts;
  v_start date;
  v_end   date;
begin
  select * into v_old from contracts where id = p_contract_id;
  if not found then raise exception 'العقد غير موجود'; end if;
  if not has_perm('contracts', 'create') then
    raise exception 'لا تملك صلاحية إنشاء العقود';
  end if;
  if v_old.status not in ('active', 'completed') then
    raise exception 'يُجدَّد العقد النشط أو المنتهي فقط';
  end if;
  if not (is_cross_branch() or v_old.branch_id = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;
  if exists (select 1 from contracts where parent_contract_id = v_old.id and status <> 'cancelled') then
    raise exception 'يوجد تجديد قائم لهذا العقد';
  end if;

  v_start := greatest(coalesce(v_old.end_date + 1, current_date), current_date);
  v_end   := case when v_old.end_date is not null and v_old.start_date is not null
                  then v_start + (v_old.end_date - v_old.start_date) else null end;

  insert into contracts (
    contract_no, service_code, template_id, customer_id, worker_id, branch_id,
    start_date, end_date, gross_amount, discount_amount, promotion_id, base_amount,
    pricing_params, status, version, parent_contract_id, created_by
  ) values (
    generate_contract_no(), v_old.service_code, v_old.template_id, v_old.customer_id,
    v_old.worker_id, v_old.branch_id, v_start, v_end,
    coalesce(v_old.gross_amount, v_old.base_amount), 0, null,
    coalesce(v_old.gross_amount, v_old.base_amount),
    v_old.pricing_params, 'draft', v_old.version + 1, v_old.id, auth.uid()
  ) returning * into v_row;

  insert into contract_clauses (contract_id, sort_order, body)
  select v_row.id, sort_order, body from contract_clauses where contract_id = v_old.id;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (v_row.id, null, 'draft', auth.uid());

  insert into audit_log (user_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'contract.renew', 'contracts', v_row.id,
          jsonb_build_object('parent', v_old.id, 'version', v_row.version));
  return v_row;
end $$;

grant execute on function renew_contract(uuid) to authenticated;

-- ---------- 6) state machine with business guards ----------
create or replace function transition_contract(p_contract_id uuid, p_to_status text)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_from    contract_status;
  v_branch  uuid;
  v_service text;
  v_musaned text;
  v_origin  text;
  v_allowed text[];
  v_row     contracts;
begin
  select status, branch_id, service_code, musaned_contract_no
    into v_from, v_branch, v_service, v_musaned
  from contracts where id = p_contract_id for update;

  if v_from is null then
    raise exception 'العقد غير موجود';
  end if;

  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if p_to_status = 'approved' and not has_perm('contracts', 'approve') then
    raise exception 'لا تملك صلاحية اعتماد العقود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  select coalesce(contract_origin, 'internal') into v_origin
  from services where code = v_service;
  v_origin := coalesce(v_origin, 'internal');

  if v_origin = 'musaned' then
    v_allowed := case v_from::text
      when 'draft'           then array['musaned_created', 'cancelled']
      when 'musaned_created' then array['musaned_signed', 'cancelled']
      when 'musaned_signed'  then array['active', 'cancelled']
      when 'active'          then array['completed', 'cancelled']
      else array[]::text[]
    end;
  else
    v_allowed := case v_from::text
      when 'draft'              then array['pending_approval', 'cancelled']
      when 'pending_approval'   then array['approved', 'draft', 'cancelled']
      when 'approved'           then array['awaiting_signature', 'cancelled']
      when 'awaiting_signature' then array['signed', 'cancelled']
      when 'signed'             then array['active']
      when 'active'             then array['completed', 'cancelled']
      else array[]::text[]
    end;
  end if;

  if not (p_to_status = any(v_allowed)) then
    raise exception 'انتقال غير مشروع من % إلى %', v_from, p_to_status;
  end if;

  -- business guards
  if p_to_status = 'musaned_created' and nullif(btrim(coalesce(v_musaned, '')), '') is null then
    raise exception 'أدخل رقم عقد مساند قبل تسجيل الإنشاء على المنصة';
  end if;
  if p_to_status = 'signed' and (
       not exists (select 1 from contract_signatures
                   where contract_id = p_contract_id and signer_type = 'customer')
    or not exists (select 1 from contract_signatures
                   where contract_id = p_contract_id and signer_type = 'company')) then
    raise exception 'لا يمكن تأكيد التوقيع قبل توقيع الطرفين';
  end if;

  update contracts set
    status     = p_to_status::contract_status,
    signed_at  = case when p_to_status in ('signed', 'musaned_signed') then now() else signed_at end,
    updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  insert into contract_status_history (contract_id, from_status, to_status, changed_by)
  values (p_contract_id, v_from::text, p_to_status, auth.uid());

  insert into audit_log (user_id, action, table_name, record_id, details)
  values (auth.uid(), 'contract.transition', 'contracts', p_contract_id,
          jsonb_build_object('from', v_from::text, 'to', p_to_status));

  return v_row;
end $$;

grant execute on function transition_contract(uuid, text) to authenticated;

-- history rows are written only by the security-definer functions above
drop policy if exists csh_insert on contract_status_history;
create policy csh_insert on contract_status_history for insert to authenticated
  with check (has_perm('contracts', 'create') or has_perm('contracts', 'edit'));
