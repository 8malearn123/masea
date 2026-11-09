-- Rollback for 0085_sales_rules.sql.
-- Restores the 0044 for-all write policies on leads/quotes, the 0059 admin delete on
-- pricing_rules, the 0049 Musaned setter and the 0052 one-argument renew_contract; the
-- contract VAT columns become generated (15%) again — recomputed from base_amount.
drop policy if exists pricing_rules_delete on pricing_rules;
create policy pricing_rules_delete on pricing_rules for delete to authenticated using (is_admin());

drop trigger if exists trg_set_contract_vat on contracts;
drop function if exists set_contract_vat();
alter table contracts drop column if exists total_amount;
alter table contracts drop column if exists vat_amount;
alter table contracts add column vat_amount numeric(12,2) generated always as (round(base_amount * 0.15, 2)) stored;
alter table contracts add column total_amount numeric(12,2) generated always as (round(base_amount * 1.15, 2)) stored;

drop trigger if exists trg_guard_contract_from_quote on contracts;
drop function if exists guard_contract_from_quote();

drop policy if exists quotes_write on quotes;
create policy quotes_write on quotes for all to authenticated using (
  has_perm('leads','edit') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
) with check (
  has_perm('leads','create') and (is_cross_branch() or branch_id = get_my_branch())
);

drop policy if exists leads_ins on leads;
drop policy if exists leads_upd on leads;
drop policy if exists leads_write on leads;
create policy leads_write on leads for all to authenticated using (
  has_perm('leads','edit') and (
    is_cross_branch()
    or (branch_id = get_my_branch() and (assigned_to = auth.uid() or get_my_role() = 'branch_manager'))
  )
) with check (
  has_perm('leads','create') and (
    is_cross_branch() or branch_id = get_my_branch()
  )
);
alter table leads drop constraint if exists leads_est_value_chk;
alter table leads drop constraint if exists leads_phone_chk;
alter table leads drop constraint if exists leads_name_chk;
drop trigger if exists trg_guard_lead on leads;
drop function if exists guard_lead();

create or replace function set_musaned_contract_no(p_contract_id uuid, p_no text)
returns contracts
language plpgsql security definer set search_path = public
as $$
declare
  v_branch uuid;
  v_row    contracts;
begin
  select branch_id into v_branch from contracts where id = p_contract_id for update;
  if not found then
    raise exception 'العقد غير موجود';
  end if;
  if not has_perm('contracts', 'edit') then
    raise exception 'لا تملك صلاحية تعديل العقود';
  end if;
  if not (is_cross_branch() or v_branch = get_my_branch()) then
    raise exception 'هذا العقد خارج نطاق فرعك';
  end if;

  update contracts
    set musaned_contract_no = nullif(btrim(p_no), ''),
        updated_at = now()
  where id = p_contract_id
  returning * into v_row;

  return v_row;
end $$;

grant execute on function set_musaned_contract_no(uuid, text) to authenticated;

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
