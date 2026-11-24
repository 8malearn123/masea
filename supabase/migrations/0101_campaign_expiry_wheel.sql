-- =============================================================
-- 0101 — إيقاف الحملات تلقائياً وتمديدها بصلاحية + تطوير عجلة الحظ
-- (docs/plans/marketing-attribution-plan.md — المرحلة 5)
--
--   * الحملة المنتهية: حالتها «منتهية» (campaign_status — 0099) وكوبوناتها مرفوضة في
--     evaluate_promotion؛ التمديد بصلاحية إدارية مع سبب وسجل يمدّد كوبونات الحملة
--     المنتهية بنهايتها؛ لا تُحذف حملة لها عقود/عملاء محتملون/كوبونات (الاحتفاظ بالتاريخ).
--   * العجلة: الجائزة تُقيَّد بخدمات وحدّ أعلى وصلاحية؛ خصم يتجاوز الحد المفتوح
--     (إعداد wheel_open_discount_max_pct) يجب تقييده بخدمات؛ رابط آمن للعميل من جواله
--     (توكن مُجزّأ، صلاحية، استخدام واحد)؛ كل دورة مربوطة بالعميل والكوبون، وتقرير
--     بالكوبونات المستخدمة والعقود والتجديدات الناتجة.
-- آمن لإعادة التشغيل.
-- =============================================================

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('wheel_open_discount_max_pct', 'أعلى نسبة خصم في عجلة الحظ دون تقييد بخدمات', 'التسويق', 10, '٪', 10),
  ('wheel_coupon_valid_days',     'صلاحية كوبون عجلة الحظ',                         'التسويق', 30, 'يوم', 11),
  ('wheel_link_valid_hours',      'صلاحية رابط عجلة الحظ للعميل',                    'التسويق', 72, 'ساعة', 12)
on conflict (key) do nothing;

-- ---------- 1) campaigns: extension + history ------------------------------------------
create table if not exists campaign_extensions (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  old_end     timestamptz,
  new_end     timestamptz not null,
  reason      text not null,
  extended_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table campaign_extensions enable row level security;
drop policy if exists cext_read on campaign_extensions;
create policy cext_read on campaign_extensions for select to authenticated using (has_perm('loyalty', 'view'));

create or replace function extend_campaign(p_campaign uuid, p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c campaigns%rowtype; v_old timestamptz;
begin
  if not (has_perm('loyalty', 'manage') and (is_admin() or get_my_role() in ('operations_manager', 'branch_manager'))) then
    raise exception 'تمديد الحملة بصلاحية إدارية (مدير الفرع/العمليات/المدير العام)';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'سبب التمديد مطلوب'; end if;
  select * into c from campaigns where id = p_campaign for update;
  if not found then raise exception 'الحملة غير موجودة'; end if;
  v_old := coalesce(c.extended_until, c.end_at);
  if p_until is null or p_until <= greatest(now(), coalesce(v_old, now())) then
    raise exception 'تاريخ التمديد بعد النهاية الحالية وبعد اليوم';
  end if;
  insert into campaign_extensions (campaign_id, old_end, new_end, reason) values (p_campaign, v_old, p_until, btrim(p_reason));
  update campaigns set extended_until = p_until, updated_at = now() where id = p_campaign;
  -- كوبونات الحملة التي كانت تنتهي بنهايتها تُمدَّد معها (الخاصة بتاريخ آخر لا تتغيّر)
  update promotions set ends_at = p_until
   where campaign_id = p_campaign and ends_at is not distinct from v_old;
end $$;
grant execute on function extend_campaign(uuid, timestamptz, text) to authenticated;

create or replace function campaigns_guard_delete() returns trigger language plpgsql as $$
begin
  if exists (select 1 from contracts where campaign_id = old.id)
     or exists (select 1 from leads where campaign_id = old.id)
     or exists (select 1 from customers where acquisition_campaign_id = old.id)
     or exists (select 1 from coupon_redemptions where campaign_id = old.id) then
    raise exception 'لا تُحذف حملة مرتبطة بعملاء أو عقود — أوقفها بدلاً من ذلك';
  end if;
  return old;
end $$;
drop trigger if exists trg_campaigns_guard_delete on campaigns;
create trigger trg_campaigns_guard_delete before delete on campaigns
  for each row execute function campaigns_guard_delete();

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
    if (c.start_at is not null and now() < c.start_at) or (coalesce(c.extended_until, c.end_at) is not null and now() > coalesce(c.extended_until, c.end_at)) then
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

-- ---------- 2) wheel prizes rules -----------------------------------------------------------
alter table wheel_prizes add column if not exists service_codes text[];
alter table wheel_prizes add column if not exists max_discount_amount numeric(12,2) check (max_discount_amount is null or max_discount_amount > 0);
alter table wheel_prizes add column if not exists coupon_valid_days integer check (coupon_valid_days is null or coupon_valid_days between 1 and 365);

create or replace function wheel_prizes_guard() returns trigger language plpgsql as $$
begin
  if new.prize_type = 'discount' then
    if new.value <= 0 or new.value > 100 then raise exception 'نسبة الخصم بين 1 و100'; end if;
    if new.value > ops_cfg('wheel_open_discount_max_pct', 10) and coalesce(cardinality(new.service_codes), 0) = 0 then
      raise exception 'خصم %٪ يتجاوز الحد المفتوح — حدّد الخدمات المشمولة', new.value;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_wheel_prizes_guard on wheel_prizes;
create trigger trg_wheel_prizes_guard before insert or update on wheel_prizes
  for each row execute function wheel_prizes_guard();

-- ---------- 3) spins: customer, coupon, link -----------------------------------------------------
create table if not exists wheel_links (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table wheel_links enable row level security;
drop policy if exists wl_read on wheel_links;
create policy wl_read on wheel_links for select to authenticated using (has_perm('loyalty', 'view'));
alter table wheel_spins add column if not exists link_id uuid references wheel_links(id) on delete set null;
alter table wheel_spins add column if not exists promotion_id uuid references promotions(id) on delete set null;
alter table wheel_spins add column if not exists coupon_code text;

create or replace function spin_wheel_core(p_customer_id uuid, p_link uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg   loyalty_config%rowtype;
  v_used  integer;
  v_total numeric;
  v_r     numeric;
  v_acc   numeric := 0;
  v_prize wheel_prizes%rowtype;
  v_code  text;
  v_name  text;
  v_spin  uuid;
  v_promo uuid;
begin
  select * into v_cfg from loyalty_config where id = 1;
  select count(*) into v_used from wheel_spins where customer_id = p_customer_id;
  if v_used >= v_cfg.wheel_spins_per_customer then
    raise exception 'تجاوزت عدد محاولات عجلة الحظ المسموحة';
  end if;

  select sum(probability) into v_total from wheel_prizes where is_active;
  v_r := random() * v_total;
  for v_prize in select * from wheel_prizes where is_active order by sort_order loop
    v_acc := v_acc + v_prize.probability;
    exit when v_r <= v_acc;
  end loop;

  if v_prize.id is null then raise exception 'لا توجد جوائز مفعّلة على العجلة'; end if;
  insert into wheel_spins (customer_id, prize_id, link_id) values (p_customer_id, v_prize.id, p_link)
  returning id into v_spin;

  if v_prize.prize_type = 'points' then
    insert into points_ledger (customer_id, type, points, description)
    values (p_customer_id, 'earn', v_prize.value::integer, 'جائزة عجلة الحظ');
    perform loyalty_sync_balances(p_customer_id);
  elsif v_prize.prize_type = 'wallet' then
    insert into wallet_ledger (customer_id, type, amount, source, description)
    values (p_customer_id, 'credit', v_prize.value, 'prize', 'جائزة عجلة الحظ');
    perform loyalty_sync_balances(p_customer_id);
  elsif v_prize.prize_type = 'discount' then
    select full_name into v_name from customers where id = p_customer_id;
    loop
      v_code := 'MAS-DISC' || trim(to_char(v_prize.value, 'FM999990')) || '-'
                || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
      exit when not exists (select 1 from promotions where upper(code) = v_code);
    end loop;
    -- الخصم مقيّد بخدمات الجائزة وحدّها الأعلى وصلاحيتها (0101) — لا يُطبَّق على كل الخدمات تلقائياً
    insert into promotions (name, type, code, description, discount_pct, service_codes,
                            max_discount_amount, usage_limit, requires_code, is_active, starts_at, ends_at)
    values ('عجلة الحظ: ' || v_prize.label || ' — ' || coalesce(v_name, 'عميل'), 'manual', v_code,
            'جائزة عجلة الحظ — استخدام واحد.', v_prize.value,
            case when coalesce(cardinality(v_prize.service_codes), 0) > 0 then v_prize.service_codes end,
            v_prize.max_discount_amount, 1, true, true, now(),
            now() + make_interval(days => coalesce(v_prize.coupon_valid_days, ops_cfg('wheel_coupon_valid_days', 30)::int)))
    returning id into v_promo;
    update wheel_spins set promotion_id = v_promo, coupon_code = v_code where id = v_spin;
  end if;

  return jsonb_build_object('label', v_prize.label, 'prize_type', v_prize.prize_type,
                            'value', v_prize.value, 'coupon_code', v_code,
                            'service_codes', v_prize.service_codes, 'max_discount_amount', v_prize.max_discount_amount);
end;
$$;

revoke execute on function spin_wheel_core(uuid, uuid) from public, anon, authenticated;

-- الدوران من شاشة الموظف (بصلاحية) — نفس القواعد
create or replace function spin_wheel(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('loyalty', 'view') then raise exception 'لا تملك صلاحية عجلة الحظ'; end if;
  return spin_wheel_core(p_customer_id, null);
end $$;
grant execute on function spin_wheel(uuid) to authenticated;

-- رابط آمن للعميل: يُرجَع التوكن مرة واحدة، ويُحفظ مُجزّأً فقط
create or replace function create_wheel_link(p_customer uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(gen_random_bytes(18), 'hex'); v_exp timestamptz;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية إنشاء رابط العجلة'; end if;
  if not exists (select 1 from customers where id = p_customer and is_active) then raise exception 'العميل غير موجود'; end if;
  v_exp := now() + make_interval(hours => ops_cfg('wheel_link_valid_hours', 72)::int);
  insert into wheel_links (customer_id, token_hash, expires_at)
  values (p_customer, encode(digest(v_token, 'sha256'), 'hex'), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;
grant execute on function create_wheel_link(uuid) to authenticated;

create or replace function wheel_link_resolve(p_token text) returns wheel_links
language sql stable security definer set search_path = public as $$
  select * from wheel_links where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;
revoke execute on function wheel_link_resolve(text) from public, anon, authenticated;

-- ما يراه العميل: اسمه الأول والجوائز ونسبها المعلنة وحالة الرابط (بلا بيانات حساسة)
create or replace function wheel_public_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l wheel_links; v_name text; v_total numeric;
begin
  l := wheel_link_resolve(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  select split_part(full_name, ' ', 1) into v_name from customers where id = l.customer_id;
  select sum(probability) into v_total from wheel_prizes where is_active;
  return jsonb_build_object(
    'first_name', v_name,
    'expired', l.expires_at < now(),
    'used', l.used_at is not null,
    'prizes', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'prize_type', prize_type,
                     'chance', round(probability * 100 / nullif(v_total, 0), 1)) order by sort_order)
                     from wheel_prizes where is_active), '[]'::jsonb),
    'result', (select jsonb_build_object('label', p.label, 'coupon_code', s.coupon_code)
                 from wheel_spins s join wheel_prizes p on p.id = s.prize_id where s.link_id = l.id limit 1));
end $$;
grant execute on function wheel_public_view(text) to anon, authenticated;

create or replace function spin_wheel_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l wheel_links; r jsonb;
begin
  l := wheel_link_resolve(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  if l.used_at is not null then raise exception 'استُخدم هذا الرابط مسبقاً'; end if;
  if l.expires_at < now() then raise exception 'انتهت صلاحية الرابط'; end if;
  update wheel_links set used_at = now() where id = l.id and used_at is null;
  if not found then raise exception 'استُخدم هذا الرابط مسبقاً'; end if;
  r := spin_wheel_core(l.customer_id, l.id);
  return r - 'service_codes' - 'max_discount_amount';
end $$;
grant execute on function spin_wheel_by_token(text) to anon, authenticated;

-- ---------- 4) wheel report -------------------------------------------------------------------------
create or replace function wheel_report(p_from date, p_to date)
returns table (prize_label text, prize_type text, spins bigint, coupons bigint, redeemed bigint,
               contracts_value numeric, renewals bigint, collected numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية التقارير'; end if;
  return query
  select p.label, p.prize_type, count(s.id),
         count(s.promotion_id),
         count(cr.id) filter (where cr.status = 'redeemed'),
         coalesce(sum(k.total_amount) filter (where cr.status = 'redeemed'), 0),
         count(k.id) filter (where cr.status = 'redeemed' and (k.parent_contract_id is not null
           or exists (select 1 from contracts k0 where k0.customer_id = k.customer_id and k0.created_at < k.created_at
                        and k0.status::text <> 'cancelled'))),
         coalesce(sum((select sum(pm.amount) from payments pm where pm.contract_id = k.id and pm.status = 'received'))
                    filter (where cr.status = 'redeemed'), 0)
    from wheel_spins s
    join wheel_prizes p on p.id = s.prize_id
    left join coupon_redemptions cr on cr.promotion_id = s.promotion_id
    left join contracts k on k.id = cr.contract_id
   where s.spun_at::date between p_from and p_to
   group by p.label, p.prize_type, p.sort_order
   order by p.sort_order;
end $$;
grant execute on function wheel_report(date, date) to authenticated;
