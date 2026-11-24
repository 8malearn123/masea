-- =============================================================
-- 0105 — ضبط احتمالات عجلة الحظ (100٪ بقرار الإدارة) وإحكام آلية الدوران
--
--   * التوزيع المعتمد: 100 نقطة 40 · 20 ريال محفظة 25 · 500 نقطة 10 · 50 ريال محفظة 5 ·
--     حظ أوفر 20 = 100٪؛ «خصم 10٪» و«تأجيل مجاني» 0٪ ومعطّلتان (لا تُحذفان). القيم لا تتغيّر.
--   * لا يُحفظ أي تعديل يترك مجموع احتمالات الجوائز المفعّلة ≠ 100٪ (فحص عند نهاية المعاملة)؛
--     تعديل النسب معاً عبر set_wheel_probabilities.
--   * الاختيار على الخادم فقط (wheel_pick_prize)؛ النتيجة تُعيد prize_id لتتوقف العجلة عليها.
--   * قفل لكل عميل/حملة يمنع منح جائزتين لدورتين متزامنتين.
--   * تدقيق تعديلات الجوائز. لا مساس بالأرصدة أو الدورات السابقة.
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) the approved distribution (by name; values untouched) ----------
update wheel_prizes p set probability = v.prob, is_active = v.act
  from (values ('100 نقطة', 40::numeric, true), ('20 ريال محفظة', 25, true), ('500 نقطة', 10, true),
               ('50 ريال محفظة', 5, true), ('حظ أوفر', 20, true),
               ('خصم 10٪', 0, false), ('تأجيل مجاني', 0, false)) v(label, prob, act)
 where p.label = v.label and (p.probability <> v.prob or p.is_active <> v.act);

-- ---------- 2) never persist a total other than 100% ----------
create or replace function wheel_prizes_total_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_n int;
begin
  select coalesce(sum(probability), 0), count(*) into v_total, v_n from wheel_prizes where is_active;
  if v_n > 0 and v_total <> 100 then
    raise exception 'مجموع احتمالات الجوائز المفعّلة يجب أن يساوي 100٪ (الحالي %٪)', v_total;
  end if;
  return null;
end $$;
drop trigger if exists trg_wheel_prizes_total on wheel_prizes;
create constraint trigger trg_wheel_prizes_total after insert or update or delete on wheel_prizes
  deferrable initially deferred for each row execute function wheel_prizes_total_check();

drop trigger if exists trg_audit_row on wheel_prizes;
create trigger trg_audit_row after insert or update or delete on wheel_prizes
  for each row execute function audit_row_change();

-- تعديل النسب والتفعيل معاً في معاملة واحدة (RLS: loyalty.manage)
create or replace function set_wheel_probabilities(p_items jsonb) returns void
language plpgsql set search_path = public as $$
declare it jsonb;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية تعديل جوائز العجلة'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    update wheel_prizes
       set probability = (it->>'probability')::numeric,
           is_active   = coalesce((it->>'is_active')::boolean, is_active)
     where id = (it->>'id')::uuid;
    if not found then raise exception 'الجائزة غير موجودة'; end if;
  end loop;
  set constraints trg_wheel_prizes_total immediate;   -- رسالة واضحة الآن بدل فشل عند الحفظ
end $$;
grant execute on function set_wheel_probabilities(jsonb) to authenticated;

-- ---------- 3) server-side pick ----------
-- p_r في [0,100): الجائزة التي يقع فيها p_r ضمن المجاميع التراكمية بترتيب العرض (جائزة 0٪ لا تُختار)
create or replace function wheel_pick_prize(p_r numeric) returns uuid
language sql stable security definer set search_path = public as $$
  select id from (
    select id, sum(probability) over (order by sort_order, id) as upto
      from wheel_prizes where is_active and probability > 0
  ) x where p_r < upto order by upto limit 1
$$;
revoke execute on function wheel_pick_prize(numeric) from public, anon, authenticated;

create or replace function spin_wheel_core(p_customer_id uuid, p_link uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg   loyalty_config%rowtype;
  v_prize wheel_prizes%rowtype;
  v_code  text;
  v_ref   text;
  v_name  text;
  v_spin  uuid;
  v_promo uuid;
  v_until timestamptz;
  v_out   boolean := false;
  v_pick  uuid;
begin
  -- دورة واحدة في كل مرة لنفس العميل والحملة (يمنع منح جائزتين بدورتين متزامنتين)
  perform pg_advisory_xact_lock(hashtext('wheel:' || p_customer_id::text || ':' || coalesce(p_campaign::text, '-')));
  select * into v_cfg from loyalty_config where id = 1;
  if (select count(*) from wheel_spins where customer_id = p_customer_id
        and campaign_id is not distinct from p_campaign) >= v_cfg.wheel_spins_per_customer then
    raise exception 'سبق لك المشاركة في هذه الحملة';
  end if;
  if wheel_probability_total() <> 100 then
    raise exception 'إعدادات العجلة غير مكتملة: مجموع احتمالات الجوائز المفعّلة يجب أن يساوي 100٪';
  end if;
  -- سحبة واحدة تُحسب أولاً (لا تُعاد لكل صف)
  v_pick := wheel_pick_prize((random() * 100)::numeric);
  select * into v_prize from wheel_prizes where id = v_pick;
  if v_prize.id is null then raise exception 'لا توجد جوائز مفعّلة على العجلة'; end if;
  -- نفدت الكمية القصوى للجائزة → لا جائزة (لا تُعاد السحبة ولا تتغيّر النسب المعلنة)
  if v_prize.max_awards is not null and (select count(*) from wheel_spins where prize_id = v_prize.id and not exhausted) >= v_prize.max_awards then
    v_out := true;
  end if;
  v_until := now() + make_interval(days => coalesce(v_prize.coupon_valid_days, ops_cfg('wheel_coupon_valid_days', 30)::int));
  insert into wheel_spins (customer_id, prize_id, link_id, campaign_id, exhausted, valid_until)
  values (p_customer_id, v_prize.id, p_link, p_campaign, v_out,
          case when not v_out and v_prize.prize_type in ('discount', 'free_service') then v_until end)
  returning id into v_spin;

  if not v_out and v_prize.prize_type = 'points' then
    insert into points_ledger (customer_id, type, points, description)
    values (p_customer_id, 'earn', v_prize.value::integer, 'جائزة عجلة الحظ');
    perform loyalty_sync_balances(p_customer_id);
  elsif not v_out and v_prize.prize_type = 'wallet' then
    insert into wallet_ledger (customer_id, type, amount, source, description)
    values (p_customer_id, 'credit', v_prize.value, 'prize', 'جائزة عجلة الحظ');
    perform loyalty_sync_balances(p_customer_id);
  elsif not v_out and v_prize.prize_type = 'discount' then
    select full_name into v_name from customers where id = p_customer_id;
    loop
      v_code := 'MAS-DISC' || trim(to_char(v_prize.value, 'FM999990')) || '-'
                || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from promotions where upper(code) = v_code);
    end loop;
    insert into promotions (name, type, code, description, discount_pct, service_codes, max_discount_amount,
                            usage_limit, requires_code, is_active, starts_at, ends_at)
    values ('عجلة الحظ: ' || v_prize.label || ' — ' || coalesce(v_name, 'عميل'), 'manual', v_code,
            'جائزة عجلة الحظ.', v_prize.value, v_prize.service_codes, v_prize.max_discount_amount,
            v_prize.usage_limit, true, true, now(), v_until)
    returning id into v_promo;
    update wheel_spins set promotion_id = v_promo, coupon_code = v_code, reference = v_code where id = v_spin;
  elsif not v_out and v_prize.prize_type = 'free_service' then
    loop
      v_ref := 'MAS-PRIZE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from wheel_spins where reference = v_ref);
    end loop;
    update wheel_spins set reference = v_ref where id = v_spin;
  end if;

  return jsonb_build_object('spin_id', v_spin, 'prize_id', v_prize.id,
                            'label', case when v_out then 'نفدت هذه الجائزة — حظاً أوفر' else v_prize.label end,
                            'prize_type', case when v_out then 'none' else v_prize.prize_type end,
                            'value', case when v_out then 0 else v_prize.value end,
                            'coupon_code', v_code, 'reference', coalesce(v_code, v_ref),
                            'valid_until', case when not v_out and v_prize.prize_type in ('discount', 'free_service') then v_until end,
                            'terms', v_prize.terms);
end $$;
revoke execute on function spin_wheel_core(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------- 4) the public view exposes prize ids (to land on the server's pick) ----------
create or replace function wheel_public_view(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l wheel_links; v_name text; cp campaigns%rowtype;
begin
  l := wheel_link_resolve(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  select split_part(full_name, ' ', 1) into v_name from customers where id = l.customer_id;
  select * into cp from campaigns where id = l.campaign_id;
  return jsonb_build_object(
    'first_name', v_name,
    'campaign_name', cp.name,
    'campaign_terms', cp.terms,
    'campaign_active', cp.id is not null and campaign_status(cp) = 'active',
    'ready', wheel_probability_total() = 100,
    'expired', l.expires_at < now(),
    'used', l.used_at is not null,
    'locked', l.failed_attempts >= ops_cfg('wheel_verify_max_attempts', 5)::int,
    'prizes', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', id, 'label', label, 'prize_type', prize_type, 'chance', probability,
                 'terms', terms, 'services', service_codes, 'max_discount_amount', max_discount_amount,
                 'valid_days', coupon_valid_days, 'usage_limit', usage_limit) order by sort_order, id)
               from wheel_prizes where is_active), '[]'::jsonb),
    'result', (select jsonb_build_object('prize_id', p.id, 'label', p.label, 'coupon_code', s.coupon_code,
                                         'reference', s.reference, 'valid_until', s.valid_until,
                                         'exhausted', s.exhausted, 'terms', p.terms)
                 from wheel_spins s join wheel_prizes p on p.id = s.prize_id where s.link_id = l.id limit 1));
end $$;
grant execute on function wheel_public_view(text) to anon, authenticated;
