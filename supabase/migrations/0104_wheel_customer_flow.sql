-- =============================================================
-- 0104 — عجلة الحظ: رابط العميل بحملة وتحقق هوية، جوائز مقيّدة ومعرّفة، ربط بالعقد، تقرير
-- (docs/plans/marketing-whatsapp-expiry-wheel-plan.md — المرحلة 3)
--
--   * المشاركة مربوطة بحملة: مرة لكل عميل لكل حملة (إعداد wheel_spins_per_customer)،
--     وبتحقق هوية (آخر 4 من الهوية + آخر 4 من الجوال المسجّل) مع قفل بعد محاولات فاشلة.
--   * العجلة لا تقبل دورات ما لم يكن مجموع احتمالات الجوائز المفعّلة 100٪ — لا تُغيَّر
--     أي نسبة تلقائياً.
--   * جائزة الخصم لا تُفعَّل إلا بخدمات محددة وحد أعلى بالريال تحدّدهما الإدارة؛ «الخدمة
--     المجانية/التأجيل» لا تُفعَّل إلا بتعريف وشروط وخدمات ومدة تعتمدها الإدارة. الجائزتان
--     الحاليتان («خصم 10٪» و«تأجيل مجاني») تُعطَّلان حتى تُعرَّفا — دون اختراع شروط.
--   * لكل جائزة: عدد مرات الاستخدام، والعدد الأقصى للجوائز، والصلاحية، والشروط الظاهرة للعميل.
--   * كل فوز يُحفظ في ملف العميل بمرجع فريد وصلاحية؛ الخصم يُطبَّق عبر الكود في حساب السعر،
--     وغير النقدية تُستخدم على عقد بمرجعها (redeem_wheel_prize) ضمن الخدمات والحد.
--   * التقرير يحسب التجديد فقط إذا استُخدمت الجائزة على عقد تجديد فعلاً.
-- آمن لإعادة التشغيل.
-- =============================================================

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('wheel_verify_max_attempts', 'محاولات التحقق الخاطئة قبل إيقاف رابط العجلة', 'التسويق', 5, 'محاولة', 22)
on conflict (key) do nothing;

-- ---------- 1) prizes ------------------------------------------------------------------
alter table wheel_prizes add column if not exists terms text;
alter table wheel_prizes add column if not exists usage_limit integer not null default 1 check (usage_limit between 1 and 100);
alter table wheel_prizes add column if not exists max_awards integer check (max_awards is null or max_awards > 0);

create or replace function wheel_prizes_guard() returns trigger language plpgsql as $$
begin
  if new.probability < 0 or new.probability > 100 then raise exception 'نسبة الاحتمال بين 0 و100'; end if;
  if new.prize_type = 'discount' then
    if new.value <= 0 or new.value > 100 then raise exception 'نسبة الخصم بين 1 و100'; end if;
    if new.is_active and (coalesce(cardinality(new.service_codes), 0) = 0 or new.max_discount_amount is null) then
      raise exception 'لا تُفعَّل جائزة الخصم قبل تحديد الخدمات المشمولة والحد الأعلى للخصم بالريال';
    end if;
  end if;
  if new.prize_type = 'free_service' and new.is_active
     and (length(btrim(coalesce(new.terms, ''))) < 10 or coalesce(cardinality(new.service_codes), 0) = 0
          or new.coupon_valid_days is null) then
    raise exception 'لا تُفعَّل هذه الجائزة قبل اعتماد تعريفها وشروطها وخدماتها ومدة صلاحيتها';
  end if;
  return new;
end $$;

-- الجائزتان غير المعرّفتين تُعطَّلان (القيم المسجّلة تبقى كما هي)
update wheel_prizes set is_active = false
 where is_active and ((prize_type = 'discount' and (coalesce(cardinality(service_codes), 0) = 0 or max_discount_amount is null))
                      or (prize_type = 'free_service' and length(btrim(coalesce(terms, ''))) < 10));

create or replace function wheel_probability_total() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(probability), 0) from wheel_prizes where is_active
$$;
grant execute on function wheel_probability_total() to authenticated;

-- ---------- 2) campaign link, identity, per-campaign limit ----------------------------------------
alter table campaigns add column if not exists terms text;   -- شروط المشاركة الظاهرة للعميل
alter table wheel_links add column if not exists campaign_id uuid references campaigns(id) on delete restrict;
alter table wheel_links add column if not exists failed_attempts integer not null default 0;
alter table wheel_spins add column if not exists campaign_id uuid references campaigns(id) on delete set null;
alter table wheel_spins add column if not exists reference text;
alter table wheel_spins add column if not exists valid_until timestamptz;
alter table wheel_spins add column if not exists exhausted boolean not null default false;
create unique index if not exists wheel_spins_reference on wheel_spins(reference) where reference is not null;

create table if not exists wheel_prize_uses (
  id          uuid primary key default gen_random_uuid(),
  spin_id     uuid not null references wheel_spins(id) on delete restrict,
  contract_id uuid not null references contracts(id) on delete restrict,
  used_by     uuid references auth.users(id) on delete set null default auth.uid(),
  used_at     timestamptz not null default now(),
  unique (spin_id, contract_id)
);
alter table wheel_prize_uses enable row level security;
drop policy if exists wpu_read on wheel_prize_uses;
create policy wpu_read on wheel_prize_uses for select to authenticated using (has_perm('loyalty', 'view') or has_perm('contracts', 'view'));
drop trigger if exists trg_audit_row on wheel_prize_uses;
create trigger trg_audit_row after insert on wheel_prize_uses for each row execute function audit_row_change();

drop function if exists create_wheel_link(uuid);
create or replace function create_wheel_link(p_customer uuid, p_campaign uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(gen_random_bytes(18), 'hex'); v_exp timestamptz; v_status text; c customers%rowtype;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية إنشاء رابط العجلة'; end if;
  select * into c from customers where id = p_customer and is_active;
  if c.id is null then raise exception 'العميل غير موجود'; end if;
  if length(regexp_replace(coalesce(c.national_id, ''), '\D', '', 'g')) < 4 or coalesce(c.phone, '') !~ '^05[0-9]{8}$' then
    raise exception 'لا يمكن التحقق من هوية العميل — أكمل رقم الهوية والجوال في ملفه أولاً';
  end if;
  select campaign_status(cp) into v_status from campaigns cp where cp.id = p_campaign;
  if v_status is distinct from 'active' then raise exception 'اختر حملة نشطة للعجلة'; end if;
  if wheel_probability_total() <> 100 then
    raise exception 'إعدادات العجلة غير مكتملة: مجموع احتمالات الجوائز المفعّلة يجب أن يساوي 100٪';
  end if;
  v_exp := now() + make_interval(hours => ops_cfg('wheel_link_valid_hours', 72)::int);
  insert into wheel_links (customer_id, campaign_id, token_hash, expires_at)
  values (p_customer, p_campaign, encode(digest(v_token, 'sha256'), 'hex'), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;
grant execute on function create_wheel_link(uuid, uuid) to authenticated;

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
                 'label', label, 'prize_type', prize_type, 'chance', probability,
                 'terms', terms, 'services', service_codes, 'max_discount_amount', max_discount_amount,
                 'valid_days', coupon_valid_days, 'usage_limit', usage_limit) order by sort_order)
               from wheel_prizes where is_active), '[]'::jsonb),
    'result', (select jsonb_build_object('label', p.label, 'coupon_code', s.coupon_code, 'reference', s.reference,
                                         'valid_until', s.valid_until, 'exhausted', s.exhausted, 'terms', p.terms)
                 from wheel_spins s join wheel_prizes p on p.id = s.prize_id where s.link_id = l.id limit 1));
end $$;
grant execute on function wheel_public_view(text) to anon, authenticated;

-- ---------- 3) the spin (server-side) ---------------------------------------------------------------
create or replace function spin_wheel_core(p_customer_id uuid, p_link uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg   loyalty_config%rowtype;
  v_r     numeric;
  v_acc   numeric := 0;
  v_prize wheel_prizes%rowtype;
  v_code  text;
  v_ref   text;
  v_name  text;
  v_spin  uuid;
  v_promo uuid;
  v_until timestamptz;
  v_out   boolean := false;
begin
  select * into v_cfg from loyalty_config where id = 1;
  if (select count(*) from wheel_spins where customer_id = p_customer_id
        and campaign_id is not distinct from p_campaign) >= v_cfg.wheel_spins_per_customer then
    raise exception 'سبق لك المشاركة في هذه الحملة';
  end if;
  if wheel_probability_total() <> 100 then
    raise exception 'إعدادات العجلة غير مكتملة: مجموع احتمالات الجوائز المفعّلة يجب أن يساوي 100٪';
  end if;
  v_r := random() * 100;
  for v_prize in select * from wheel_prizes where is_active order by sort_order loop
    v_acc := v_acc + v_prize.probability;
    exit when v_r <= v_acc;
  end loop;
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

  return jsonb_build_object('label', case when v_out then 'نفدت هذه الجائزة — حظاً أوفر' else v_prize.label end,
                            'prize_type', case when v_out then 'none' else v_prize.prize_type end,
                            'coupon_code', v_code, 'reference', coalesce(v_code, v_ref),
                            'valid_until', case when not v_out and v_prize.prize_type in ('discount', 'free_service') then v_until end,
                            'terms', v_prize.terms);
end $$;
revoke execute on function spin_wheel_core(uuid, uuid, uuid) from public, anon, authenticated;
drop function if exists spin_wheel_core(uuid, uuid);

create or replace function spin_wheel(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('loyalty', 'view') then raise exception 'لا تملك صلاحية عجلة الحظ'; end if;
  return spin_wheel_core(p_customer_id, null, null);
end $$;

drop function if exists spin_wheel_by_token(text);
create or replace function spin_wheel_by_token(p_token text, p_id_last4 text, p_phone_last4 text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l wheel_links; c customers%rowtype; cp campaigns%rowtype; r jsonb;
begin
  l := wheel_link_resolve(p_token);
  if l.id is null then raise exception 'الرابط غير صحيح'; end if;
  if l.used_at is not null then raise exception 'استُخدم هذا الرابط مسبقاً'; end if;
  if l.expires_at < now() then raise exception 'انتهت صلاحية الرابط'; end if;
  if l.failed_attempts >= ops_cfg('wheel_verify_max_attempts', 5)::int then raise exception 'أُوقف الرابط بعد محاولات تحقق خاطئة — تواصل مع الفرع'; end if;
  select * into cp from campaigns where id = l.campaign_id;
  if cp.id is null or campaign_status(cp) <> 'active' then raise exception 'انتهت حملة العجلة'; end if;
  select * into c from customers where id = l.customer_id;
  if right(regexp_replace(coalesce(c.national_id, ''), '\D', '', 'g'), 4) <> coalesce(p_id_last4, '')
     or right(coalesce(c.phone, ''), 4) <> coalesce(p_phone_last4, '') then
    update wheel_links set failed_attempts = failed_attempts + 1 where id = l.id;
    return jsonb_build_object('error', 'بيانات التحقق غير مطابقة');
  end if;
  update wheel_links set used_at = now() where id = l.id and used_at is null;
  if not found then raise exception 'استُخدم هذا الرابط مسبقاً'; end if;
  r := spin_wheel_core(l.customer_id, l.id, l.campaign_id);
  return r;
end $$;
grant execute on function spin_wheel_by_token(text, text, text) to anon, authenticated;

-- ---------- 4) prizes in the customer file + use on a contract ------------------------------------
create or replace function customer_wheel_prizes(p_customer uuid)
returns table (spin_id uuid, spun_at timestamptz, campaign_name text, label text, prize_type text, reference text,
               coupon_code text, valid_until timestamptz, services text[], max_discount_amount numeric,
               usage_limit integer, uses bigint, terms text, exhausted boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.spun_at, cp.name, p.label, p.prize_type, s.reference, s.coupon_code, s.valid_until,
         p.service_codes, p.max_discount_amount, p.usage_limit,
         (select count(*) from wheel_prize_uses u where u.spin_id = s.id)
           + (select count(*) from coupon_redemptions cr where cr.promotion_id = s.promotion_id and cr.status = 'redeemed'),
         p.terms, s.exhausted
    from wheel_spins s join wheel_prizes p on p.id = s.prize_id left join campaigns cp on cp.id = s.campaign_id
   where s.customer_id = p_customer and (has_perm('loyalty', 'view') or has_perm('contracts', 'view'))
   order by s.spun_at desc
$$;
grant execute on function customer_wheel_prizes(uuid) to authenticated;

-- الجوائز غير النقدية (مرجع MAS-PRIZE) تُستخدم على عقد لنفس العميل ضمن الخدمات والصلاحية والحد
create or replace function redeem_wheel_prize(p_reference text, p_contract uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s wheel_spins%rowtype; p wheel_prizes%rowtype; k contracts%rowtype;
begin
  if not (has_perm('contracts', 'edit') or has_perm('contracts', 'create')) then raise exception 'لا تملك صلاحية'; end if;
  select * into s from wheel_spins where reference = upper(btrim(p_reference));
  if s.id is null or s.exhausted then raise exception 'مرجع الجائزة غير صحيح'; end if;
  select * into p from wheel_prizes where id = s.prize_id;
  if p.prize_type = 'discount' then raise exception 'جائزة الخصم تُطبَّق بإدخال الكود في التسعير'; end if;
  select * into k from contracts where id = p_contract;
  if k.id is null or not contract_in_my_scope(p_contract) then raise exception 'العقد غير موجود'; end if;
  if k.customer_id <> s.customer_id then raise exception 'الجائزة تخص عميلاً آخر'; end if;
  if s.valid_until is not null and now() > s.valid_until then raise exception 'انتهت صلاحية الجائزة'; end if;
  if coalesce(cardinality(p.service_codes), 0) > 0 and not (k.service_code = any(p.service_codes)) then
    raise exception 'الجائزة لا تشمل خدمة هذا العقد';
  end if;
  if (select count(*) from wheel_prize_uses where spin_id = s.id) >= p.usage_limit then
    raise exception 'استُخدمت الجائزة بالعدد المسموح';
  end if;
  insert into wheel_prize_uses (spin_id, contract_id) values (s.id, p_contract);
end $$;
grant execute on function redeem_wheel_prize(text, uuid) to authenticated;

-- ---------- 5) report ---------------------------------------------------------------------------------
drop function if exists wheel_report(date, date);
create or replace function wheel_report(p_from date, p_to date, p_campaign uuid default null, p_branch uuid default null)
returns table (prize_label text, prize_type text, participants bigint, spins bigint, winners bigint, used bigint,
               discount_total numeric, contracts bigint, renewals bigint, contracts_value numeric, renewals_value numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_branch uuid := marketing_branch_scope(p_branch);
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية التقارير'; end if;
  return query
  with s as (
    select s.*, cu.branch_id as cust_branch from wheel_spins s join customers cu on cu.id = s.customer_id
     where (s.spun_at at time zone 'Asia/Riyadh')::date between p_from and p_to
       and (p_campaign is null or s.campaign_id = p_campaign)
       and (v_branch is null or cu.branch_id = v_branch)
  ), used as (   -- العقود التي استُخدمت عليها الجائزة فعلاً (كود الخصم أو مرجع الجائزة)
    select s.id as spin_id, cr.contract_id, cr.amount as discount from s join coupon_redemptions cr
        on cr.promotion_id = s.promotion_id and cr.status = 'redeemed'
    union all
    select s.id, u.contract_id, 0 from s join wheel_prize_uses u on u.spin_id = s.id
  ), uk as (
    select used.*, k.total_amount, k.parent_contract_id, k.status::text as st
      from used join contracts k on k.id = used.contract_id
  )
  select p.label, p.prize_type,
         count(distinct s.customer_id),
         count(s.id),
         count(s.id) filter (where not s.exhausted and p.prize_type <> 'none'),
         (select count(distinct uk.spin_id) from uk join s s2 on s2.id = uk.spin_id where s2.prize_id = p.id),
         coalesce((select sum(uk.discount) from uk join s s2 on s2.id = uk.spin_id where s2.prize_id = p.id), 0),
         (select count(*) from uk join s s2 on s2.id = uk.spin_id where s2.prize_id = p.id and uk.st <> 'cancelled' and uk.parent_contract_id is null),
         (select count(*) from uk join s s2 on s2.id = uk.spin_id where s2.prize_id = p.id and uk.st <> 'cancelled' and uk.parent_contract_id is not null),
         coalesce((select sum(uk.total_amount) from uk join s s2 on s2.id = uk.spin_id where s2.prize_id = p.id and uk.st <> 'cancelled' and uk.parent_contract_id is null), 0),
         coalesce((select sum(uk.total_amount) from uk join s s2 on s2.id = uk.spin_id where s2.prize_id = p.id and uk.st <> 'cancelled' and uk.parent_contract_id is not null), 0)
    from s join wheel_prizes p on p.id = s.prize_id
   group by p.id, p.label, p.prize_type, p.sort_order
   order by p.sort_order;
end $$;
grant execute on function wheel_report(date, date, uuid, uuid) to authenticated;
