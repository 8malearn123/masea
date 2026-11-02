-- Rollback for 0066_marketing_coupons.sql.
-- Coupons (promotions rows) and referrals already recorded stay — they are
-- real discounts/referrals; only the campaign link, redemption log and the
-- coupon issuing function go. Enum values added to campaign_type cannot be
-- dropped in PostgreSQL and are left in place (harmless).
drop view if exists coupon_stats;
drop function if exists create_campaign_coupons(uuid, integer, numeric, integer, uuid, text);
drop trigger if exists trg_contract_coupon on contracts;
drop function if exists sync_coupon_redemption();
drop table if exists coupon_redemptions;
delete from app_config where key in ('coupon_preset_pct_1','coupon_preset_pct_2');

-- 0056 evaluate_promotion (no campaign window)
create or replace function evaluate_promotion(
  p_promotion_id uuid, p_service_code text, p_base numeric, p_code text default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p promotions%rowtype; v_amount numeric(12,2);
begin
  select * into p from promotions where id = p_promotion_id;
  if not found then return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم غير موجود'); end if;
  if p.requires_code and upper(btrim(coalesce(p_code, ''))) <> upper(coalesce(p.code, '')) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم يتطلب رمز كوبون صحيح');
  end if;
  if not p.is_active then return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم معطّل'); end if;
  if p.starts_at is not null and now() < p.starts_at then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم لم يبدأ بعد');
  end if;
  if p.ends_at is not null and now() > p.ends_at then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'انتهت صلاحية الخصم');
  end if;
  if coalesce(array_length(p.service_codes, 1), 0) > 0 and not (p_service_code = any(p.service_codes)) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم لا يشمل هذه الخدمة');
  end if;
  if p.min_base_amount is not null and p_base < p.min_base_amount then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'المبلغ أقل من الحد الأدنى لتطبيق الخصم');
  end if;
  if p.usage_limit is not null and p.usage_count >= p.usage_limit then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'استُنفد عدد مرات استخدام الخصم');
  end if;
  v_amount := case when p.discount_pct is not null then round(p_base * p.discount_pct / 100.0, 2)
                   else coalesce(p.discount_amount, 0) end;
  if p.max_discount_amount is not null then v_amount := least(v_amount, p.max_discount_amount); end if;
  v_amount := least(v_amount, p_base);
  return jsonb_build_object('ok', true, 'amount', v_amount, 'reason', null);
end $$;
grant execute on function evaluate_promotion(uuid, text, numeric, text) to anon, authenticated;

drop index if exists idx_promotions_campaign;
alter table promotions drop column if exists campaign_id, drop column if exists referrer_customer_id,
  drop column if exists referrer_name;
alter table campaigns drop column if exists description, drop column if exists service_codes,
  drop column if exists coupon_code, drop column if exists created_by, drop column if exists updated_at;
