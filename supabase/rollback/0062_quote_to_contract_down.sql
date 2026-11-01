-- Rollback for 0062_quote_to_contract.sql.
-- Contracts and orders already created from quotes are kept (real records);
-- only the new functions, columns and the approval state go. Quotes waiting
-- for approval fall back to draft.

drop function if exists convert_quote_to_contract(uuid, text);
drop function if exists create_quote_from_price(text, jsonb, text, text, date, text, uuid, jsonb, jsonb);

-- 0058 forms
create or replace function create_quote_from_price(
  p_service_code text, p_params jsonb, p_customer_name text, p_customer_phone text,
  p_valid_until date, p_notes text default null, p_parent_id uuid default null, p_snapshot jsonb default null
) returns quotes language plpgsql security definer set search_path = public as $$
declare v_price jsonb; v_row quotes;
begin
  if not (has_perm('pricing','create') or has_perm('leads','create')) then
    raise exception 'لا تملك صلاحية إنشاء عروض الأسعار';
  end if;
  if length(btrim(coalesce(p_customer_name, ''))) < 3 then raise exception 'اسم العميل مطلوب'; end if;
  if p_valid_until is null or p_valid_until <= current_date then raise exception 'تاريخ صلاحية العرض يجب أن يكون لاحقًا لليوم'; end if;
  v_price := calc_price(p_service_code, p_params);
  if (v_price->>'base')::numeric <= 0 then raise exception 'لا توجد قاعدة سعر نشطة لهذه الخدمة'; end if;
  if not coalesce((v_price->>'promotion_ok')::boolean, true) then
    raise exception 'الخصم غير قابل للتطبيق: %', coalesce(v_price->>'promotion_reason', '');
  end if;
  if (v_price->>'total')::numeric <= 0 then raise exception 'الإجمالي غير صالح'; end if;
  insert into quotes (service_code, customer_name, customer_phone, nationality, profession, quantity,
                      base_amount, vat_amount, total_amount, status, valid_until, notes,
                      assigned_to, branch_id, created_by, parent_id, price_snapshot)
  values (p_service_code, btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone,'')), ''),
          nullif(p_params->>'nationality',''), nullif(p_params->>'profession',''),
          greatest(coalesce((p_params->>'quantity')::integer, 1), 1),
          (v_price->>'net')::numeric, (v_price->>'vat')::numeric, (v_price->>'total')::numeric,
          'draft', p_valid_until, p_notes, auth.uid(), get_my_branch(), auth.uid(), p_parent_id,
          coalesce(p_snapshot, '{}'::jsonb)
            || jsonb_build_object('server', v_price, 'params', p_params, 'computed_at', now()))
  returning * into v_row;
  insert into quote_events (quote_id, type, actor, note)
  values (v_row.id, case when p_parent_id is null then 'created' else 'version_created' end, auth.uid(), null);
  return v_row;
end;
$$;

create or replace function set_quote_status(p_quote_id uuid, p_status text, p_note text default null)
returns quotes language plpgsql security definer set search_path = public as $$
declare v_row quotes; v_from text;
begin
  if not (has_perm('pricing','edit') or has_perm('leads','edit')) then
    raise exception 'لا تملك صلاحية تحديث العروض';
  end if;
  select * into v_row from quotes where id = p_quote_id for update;
  if v_row.id is null then raise exception 'العرض غير موجود'; end if;
  v_from := case when v_row.status in ('draft','sent') and v_row.valid_until < current_date
                 then 'expired' else v_row.status end;
  if not ((v_from = 'draft' and p_status in ('sent','accepted','rejected'))
       or (v_from = 'sent'  and p_status in ('accepted','rejected'))) then
    raise exception 'لا يمكن نقل العرض من «%» إلى «%»', v_from, p_status;
  end if;
  update quotes set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         decided_at = case when p_status in ('accepted','rejected') then now() else decided_at end
  where id = p_quote_id returning * into v_row;
  insert into quote_events (quote_id, type, actor, note)
  values (p_quote_id, case p_status when 'sent' then 'marked_sent' else p_status end, auth.uid(), p_note);
  return v_row;
end;
$$;

grant execute on function create_quote_from_price(text, jsonb, text, text, date, text, uuid, jsonb),
  set_quote_status(uuid, text, text) to authenticated;

drop function if exists quote_needs_approval(numeric, numeric);
drop function if exists can_act_on_sales_row(uuid, uuid);

update quotes set status = 'draft' where status = 'pending_approval';
alter table quotes drop constraint if exists quotes_status_check;
alter table quotes add constraint quotes_status_check
  check (status in ('draft','sent','accepted','rejected','expired'));
-- quote_events is append-only: approval events stay; the old check is added NOT VALID
alter table quote_events drop constraint if exists quote_events_type_check;
alter table quote_events add constraint quote_events_type_check
  check (type in ('created','whatsapp_opened','marked_sent','pdf_generated','accepted','rejected',
                  'expired','version_created','converted')) not valid;

delete from app_config where key = 'quote_approval_discount_pct';
insert into role_permissions (role_code, module, action) values ('sales','leads','approve') on conflict do nothing;

drop index if exists ux_quotes_contract;
drop index if exists ux_contracts_quote;
alter table quotes
  drop column if exists worker_profile_id, drop column if exists worker_name,
  drop column if exists start_date, drop column if exists duration_unit,
  drop column if exists duration_count, drop column if exists end_date,
  drop column if exists gross_amount, drop column if exists discount_amount,
  drop column if exists promotion_id, drop column if exists coupon_code,
  drop column if exists terms, drop column if exists request_id,
  drop column if exists approved_by, drop column if exists approved_at;
alter table contracts
  drop column if exists quote_id, drop column if exists issue_date,
  drop column if exists notes, drop column if exists alert_days_before;
alter table customers drop constraint if exists customers_vat_number_chk;
alter table customers drop column if exists vat_number;
alter table worker_profiles drop column if exists office_name, drop column if exists office_phone;
alter table leads drop column if exists city, drop column if exists email;
