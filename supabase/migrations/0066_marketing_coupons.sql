-- =============================================================
-- Masiat Alsharq ERP — 0066 Marketing campaigns + referral coupons (المرحلة 5)
-- يُبنى فوق campaigns (0005) و promotions/evaluate_promotion/calc_price (0051,
-- 0056) و referrals (0020) — الكوبون = خصم في promotions، لا جدول خصومات جديد:
--   • campaigns: وصف وخدمات مشمولة وكوبون رئيسي — تُدار من قسم الولاء والتسويق.
--   • promotions.campaign_id: كوبونات الإحالة لكل حملة، وكل كوبون قد يُنسب
--     لعميل مُحيل (referrer). صلاحية الكوبون = صلاحية حملته وتواريخه وعدد مرات
--     استخدامه والخدمات المشمولة — يُرفض المنتهي/المعطّل/غير المرتبط بالخدمة.
--   • النسب الافتراضية 5٪ و10٪ من app_config؛ نسبة أخرى لمن يملك الإدارة.
--   • coupon_redemptions: كل عقد استُخدم فيه كوبون = استخدام واحد بقيمة خصمه؛
--     إلغاء العقد يلغي الاستخدام. منه عدد الاستخدامات وإجمالي الخصم لكل كوبون/حملة.
--   • استخدام كوبون إحالة من عميل جديد يُسجّل الإحالة في referrals فتعمل عمولة
--     المُحيل القائمة (award_points) تلقائيًا.
-- التراجع: supabase/rollback/0066_marketing_coupons_down.sql
-- =============================================================

-- the UI campaign kinds (0005 had hourly_offer/first_order/lucky_wheel/referral/general)
alter type campaign_type add value if not exists 'discount';
alter type campaign_type add value if not exists 'cashback';
alter type campaign_type add value if not exists 'seasonal';

alter table campaigns
  add column if not exists description   text,
  add column if not exists service_codes text[],          -- null/empty = كل الخدمات
  add column if not exists coupon_code   text,            -- الكوبون الرئيسي للحملة
  add column if not exists created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists updated_at    timestamptz not null default now();

alter table promotions
  add column if not exists campaign_id          uuid references campaigns(id) on delete set null,
  add column if not exists referrer_customer_id uuid references customers(id) on delete set null,
  add column if not exists referrer_name        text;
create index if not exists idx_promotions_campaign on promotions(campaign_id);

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('coupon_preset_pct_1', 'نسبة كوبون الإحالة المقترحة الأولى',  'التسويق', 5,  '٪', 1),
  ('coupon_preset_pct_2', 'نسبة كوبون الإحالة المقترحة الثانية', 'التسويق', 10, '٪', 2)
on conflict (key) do nothing;

-- ---------- 1) eligibility: + the campaign window ---------------------------
create or replace function evaluate_promotion(
  p_promotion_id uuid,
  p_service_code text,
  p_base         numeric,
  p_code         text default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  p        promotions%rowtype;
  c        campaigns%rowtype;
  v_amount numeric(12,2);
begin
  select * into p from promotions where id = p_promotion_id;
  if not found then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم غير موجود');
  end if;
  if p.requires_code and upper(btrim(coalesce(p_code, ''))) <> upper(coalesce(p.code, '')) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم يتطلب رمز كوبون صحيح');
  end if;
  if not p.is_active then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم معطّل');
  end if;
  if p.starts_at is not null and now() < p.starts_at then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم لم يبدأ بعد');
  end if;
  if p.ends_at is not null and now() > p.ends_at then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'انتهت صلاحية الخصم');
  end if;
  -- a campaign coupon lives and dies with its campaign
  if p.campaign_id is not null then
    select * into c from campaigns where id = p.campaign_id;
    if not found or not c.is_active then
      return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الحملة التسويقية للكوبون غير مفعّلة');
    end if;
    if (c.start_at is not null and now() < c.start_at) or (c.end_at is not null and now() > c.end_at) then
      return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الحملة التسويقية للكوبون خارج فترتها');
    end if;
    if coalesce(array_length(c.service_codes, 1), 0) > 0 and not (p_service_code = any(c.service_codes)) then
      return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الكوبون لا يشمل هذه الخدمة');
    end if;
  end if;
  if coalesce(array_length(p.service_codes, 1), 0) > 0
     and not (p_service_code = any(p.service_codes)) then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'الخصم لا يشمل هذه الخدمة');
  end if;
  if p.min_base_amount is not null and p_base < p.min_base_amount then
    return jsonb_build_object('ok', false, 'amount', 0,
      'reason', 'المبلغ أقل من الحد الأدنى لتطبيق الخصم');
  end if;
  if p.usage_limit is not null and p.usage_count >= p.usage_limit then
    return jsonb_build_object('ok', false, 'amount', 0, 'reason', 'استُنفد عدد مرات استخدام الخصم');
  end if;

  v_amount := case
    when p.discount_pct is not null then round(p_base * p.discount_pct / 100.0, 2)
    else coalesce(p.discount_amount, 0)
  end;
  if p.max_discount_amount is not null then
    v_amount := least(v_amount, p.max_discount_amount);
  end if;
  v_amount := least(v_amount, p_base);
  return jsonb_build_object('ok', true, 'amount', v_amount, 'reason', null);
end $$;
grant execute on function evaluate_promotion(uuid, text, numeric, text) to anon, authenticated;

-- ---------- 2) redemptions --------------------------------------------------------
create table if not exists coupon_redemptions (
  id           uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id) on delete restrict,
  campaign_id  uuid references campaigns(id) on delete set null,
  contract_id  uuid not null unique references contracts(id) on delete cascade,
  quote_id     uuid references quotes(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null,
  branch_id    uuid references branches(id) on delete set null,
  service_code text,
  base_amount  numeric(12,2) not null default 0,   -- before the discount
  amount       numeric(12,2) not null default 0,   -- the discount
  net_amount   numeric(12,2) not null default 0,   -- after the discount, before VAT
  status       text not null default 'redeemed' check (status in ('redeemed','cancelled')),
  redeemed_at  timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists idx_redemptions_promotion on coupon_redemptions(promotion_id);
create index if not exists idx_redemptions_campaign on coupon_redemptions(campaign_id);

create or replace function sync_coupon_redemption()
returns trigger language plpgsql security definer set search_path = public as $$
declare p promotions;
begin
  if tg_op = 'INSERT' and new.promotion_id is not null and coalesce(new.discount_amount, 0) > 0 then
    select * into p from promotions where id = new.promotion_id;
    insert into coupon_redemptions (promotion_id, campaign_id, contract_id, quote_id, customer_id, branch_id,
                                    service_code, base_amount, amount, net_amount)
    values (new.promotion_id, p.campaign_id, new.id, new.quote_id, new.customer_id, new.branch_id,
            new.service_code, coalesce(new.gross_amount, new.base_amount + new.discount_amount),
            new.discount_amount, new.base_amount)
    on conflict (contract_id) do nothing;
    -- a referral coupon used by someone else = the referral the commission engine pays
    if p.referrer_customer_id is not null and p.referrer_customer_id is distinct from new.customer_id
       and not exists (select 1 from referrals r where r.referred_customer_id = new.customer_id) then
      insert into referrals (referrer_customer_id, referral_code, referred_customer_id, status)
      values (p.referrer_customer_id, upper(p.code) || '-' || left(new.id::text, 8), new.customer_id, 'joined')
      on conflict (referral_code) do nothing;
    end if;
  elsif tg_op = 'UPDATE' and new.status::text = 'cancelled' and old.status::text <> 'cancelled' then
    update coupon_redemptions set status = 'cancelled', cancelled_at = now()
     where contract_id = new.id and status = 'redeemed';
    if found then   -- the coupon is released (a single-use coupon can be used again)
      update promotions set usage_count = greatest(usage_count - 1, 0), updated_at = now()
       where id = new.promotion_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_contract_coupon on contracts;
create trigger trg_contract_coupon after insert or update of status on contracts
  for each row execute function sync_coupon_redemption();

-- backfill: discounted contracts before this migration
insert into coupon_redemptions (promotion_id, campaign_id, contract_id, quote_id, customer_id, branch_id,
                                service_code, base_amount, amount, net_amount, status, redeemed_at)
select c.promotion_id, p.campaign_id, c.id, c.quote_id, c.customer_id, c.branch_id, c.service_code,
       coalesce(c.gross_amount, c.base_amount + c.discount_amount), c.discount_amount, c.base_amount,
       case when c.status::text = 'cancelled' then 'cancelled' else 'redeemed' end, c.created_at
  from contracts c join promotions p on p.id = c.promotion_id
 where coalesce(c.discount_amount, 0) > 0
on conflict (contract_id) do nothing;

alter table coupon_redemptions enable row level security;
drop policy if exists redemptions_read on coupon_redemptions;
create policy redemptions_read on coupon_redemptions for select to authenticated using (
  (has_perm('loyalty','view') or has_perm('pricing','view') or has_perm('sales_ops','view'))
  and in_my_branch(branch_id)
);
drop trigger if exists trg_audit_row on coupon_redemptions;
create trigger trg_audit_row after insert or update on coupon_redemptions
  for each row execute function audit_row_change();

-- ---------- 3) issue referral coupons for a campaign ------------------------------
create or replace function create_campaign_coupons(
  p_campaign_id uuid,
  p_count       integer,
  p_pct         numeric,
  p_usage_limit integer default 1,     -- 1 = استخدام واحد، null = بلا حد
  p_referrer    uuid default null,     -- العميل المُحيل (اختياري، لكوبون واحد)
  p_prefix      text default null
) returns setof promotions
language plpgsql security definer set search_path = public as $$
declare
  c        campaigns;
  v_preset numeric[] := array[
    coalesce((select value from app_config where key = 'coupon_preset_pct_1'), 5),
    coalesce((select value from app_config where key = 'coupon_preset_pct_2'), 10)];
  v_code   text;
  v_name   text;
  v_row    promotions;
  v_i      integer;
begin
  if not (has_perm('loyalty','edit') or has_perm('loyalty','manage') or has_perm('pricing','manage')) then
    raise exception 'لا تملك صلاحية إصدار كوبونات الحملات';
  end if;
  if not (p_pct = any(v_preset)) and not (has_perm('loyalty','manage') or has_perm('pricing','manage')) then
    raise exception 'نسبة الخصم المخصّصة تحتاج صلاحية الإدارة — استخدم % ٪ أو % ٪', v_preset[1], v_preset[2];
  end if;
  if p_pct is null or p_pct <= 0 or p_pct > 100 then raise exception 'نسبة الخصم بين 0 و100'; end if;
  if p_count is null or p_count < 1 or p_count > 200 then raise exception 'عدد الكوبونات بين 1 و200'; end if;
  if p_usage_limit is not null and p_usage_limit < 1 then raise exception 'عدد مرات الاستخدام 1 على الأقل'; end if;
  if p_referrer is not null and p_count <> 1 then raise exception 'كوبون المُحيل يُصدر واحدًا لكل عميل'; end if;
  select * into c from campaigns where id = p_campaign_id;
  if c.id is null then raise exception 'الحملة غير موجودة'; end if;
  if p_referrer is not null then
    select full_name into v_name from customers where id = p_referrer and in_my_branch(branch_id);
    if v_name is null then raise exception 'العميل المُحيل غير موجود أو خارج نطاق فرعك'; end if;
  end if;

  for v_i in 1..p_count loop
    loop
      v_code := upper(coalesce(nullif(btrim(p_prefix), ''), 'MAS-REF')) || trim(to_char(p_pct, 'FM990'))
                || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
      exit when not exists (select 1 from promotions where upper(code) = v_code);
    end loop;
    insert into promotions (name, type, code, description, discount_pct, service_codes, starts_at, ends_at,
                            usage_limit, requires_code, is_active, campaign_id, referrer_customer_id, referrer_name)
    values ('كوبون ' || c.name || coalesce(' — ' || v_name, ''), 'manual', v_code,
            'كوبون إحالة لحملة «' || c.name || '».', p_pct, c.service_codes, c.start_at, c.end_at,
            p_usage_limit, true, true, c.id, p_referrer, v_name)
    returning * into v_row;
    return next v_row;
  end loop;
end $$;
grant execute on function create_campaign_coupons(uuid, integer, numeric, integer, uuid, text) to authenticated;

-- ---------- 4) stats (from the redemptions) --------------------------------------
create or replace view coupon_stats with (security_invoker = true) as
select p.id as promotion_id, p.code, p.name, p.campaign_id, p.discount_pct, p.discount_amount,
       p.usage_limit, p.usage_count, p.is_active, p.starts_at, p.ends_at, p.referrer_name,
       count(r.id) filter (where r.status = 'redeemed')                    as uses,
       coalesce(sum(r.amount) filter (where r.status = 'redeemed'), 0)     as total_discount,
       coalesce(sum(r.net_amount) filter (where r.status = 'redeemed'), 0) as sales_after_discount,
       max(r.redeemed_at) filter (where r.status = 'redeemed')             as last_used_at
  from promotions p
  left join coupon_redemptions r on r.promotion_id = p.id
 where p.requires_code
 group by p.id;
grant select on coupon_stats to authenticated;
