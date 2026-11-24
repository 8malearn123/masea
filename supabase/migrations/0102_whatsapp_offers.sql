-- =============================================================
-- 0102 — إرسال عروض واتساب من صفحة العملاء عبر WhatsApp Business Platform (Cloud API)
-- (docs/plans/marketing-whatsapp-expiry-wheel-plan.md — المرحلة 1)
--
--   * القالب التسويقي المعتمد من Meta شرط للإرسال (whatsapp_templates).
--   * الطابور outbound_messages (0092) + سجل الحملة campaign_messages (0100). دالتا الخادم
--     (supabase/functions/whatsapp-send و whatsapp-webhook) تستعملان دوال service_role هنا.
--   * لا «مُرسلة» قبل تأكيد Meta: قبول الطلب يحفظ معرّف الرسالة فقط، والحالة تتغيّر من
--     الـ Webhook (sent → delivered → read، أو failed) ولا تتراجع.
--   * إعادة المحاولة آمنة (حد أقصى، تأخير متزايد، قفل مؤقت)، حد إرسال يومي قابل للتعديل،
--     منع التكرار، الموافقة التسويقية والجوال الصالح شرطان.
--   * ربط العقد برسالة عرض موثّقة لنفس العميل؛ تقرير الحملة.
-- آمن لإعادة التشغيل.
-- =============================================================

insert into app_config (key, label_ar, grp, value, unit, sort_order) values
  ('whatsapp_daily_limit',  'الحد اليومي لرسائل واتساب التسويقية', 'التسويق', 250, 'رسالة', 20),
  ('whatsapp_max_attempts', 'محاولات إعادة إرسال رسالة واتساب الفاشلة', 'التسويق', 3, 'محاولة', 21)
on conflict (key) do nothing;

-- ---------- 1) templates ---------------------------------------------------------------
create table if not exists whatsapp_templates (
  id            uuid primary key default gen_random_uuid(),
  name_ar       text not null,
  provider_name text not null,             -- اسم القالب كما اعتُمد في WhatsApp Manager
  language      text not null default 'ar',
  body          text not null,             -- نص القالب: {{1}} اسم العميل، {{2}} العرض، {{3}} تاريخ الانتهاء
  meta_status   text not null default 'pending' check (meta_status in ('pending', 'approved', 'rejected')),
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider_name, language)
);
alter table whatsapp_templates enable row level security;
drop policy if exists wt_read on whatsapp_templates;
create policy wt_read on whatsapp_templates for select to authenticated using (has_perm('loyalty', 'view'));
drop policy if exists wt_write on whatsapp_templates;
create policy wt_write on whatsapp_templates for all to authenticated
  using (has_perm('loyalty', 'manage')) with check (has_perm('loyalty', 'manage'));
drop trigger if exists trg_audit_row on whatsapp_templates;
create trigger trg_audit_row after insert or update or delete on whatsapp_templates
  for each row execute function audit_row_change();

-- ---------- 2) messages: provider ids, timestamps, read, reply, retry ---------------------
alter table outbound_messages add column if not exists provider_message_id text;
alter table outbound_messages add column if not exists payload jsonb;
alter table outbound_messages add column if not exists attempts integer not null default 0;
alter table outbound_messages add column if not exists next_attempt_at timestamptz;
alter table outbound_messages add column if not exists locked_until timestamptz;
create unique index if not exists outbound_provider_id on outbound_messages(provider_message_id) where provider_message_id is not null;
alter table outbound_messages drop constraint if exists outbound_messages_status_check;
alter table outbound_messages add constraint outbound_messages_status_check
  check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'cancelled'));

alter table campaign_messages add column if not exists template_id uuid references whatsapp_templates(id) on delete set null;
alter table campaign_messages add column if not exists offer_text text;
alter table campaign_messages add column if not exists offer_expires_at timestamptz;
alter table campaign_messages add column if not exists sent_at timestamptz;
alter table campaign_messages add column if not exists delivered_at timestamptz;
alter table campaign_messages add column if not exists read_at timestamptz;
alter table campaign_messages add column if not exists reply_text text;
alter table campaign_messages add column if not exists replied_at timestamptz;
alter table campaign_messages drop constraint if exists campaign_messages_status_check;
alter table campaign_messages add constraint campaign_messages_status_check
  check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'opened_manually'));

create table if not exists whatsapp_inbound (
  id                  uuid primary key default gen_random_uuid(),
  from_address        text not null,
  body                text,
  provider_message_id text unique,
  campaign_message_id uuid references campaign_messages(id) on delete set null,
  customer_id         uuid references customers(id) on delete set null,
  received_at         timestamptz not null default now()
);
alter table whatsapp_inbound enable row level security;
drop policy if exists wi_read on whatsapp_inbound;
create policy wi_read on whatsapp_inbound for select to authenticated using (has_perm('loyalty', 'view'));

create table if not exists integration_status (
  name          text primary key,
  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz
);
alter table integration_status enable row level security;
drop policy if exists is_read on integration_status;
create policy is_read on integration_status for select to authenticated using (true);

-- حالة الطابور تنعكس على سجل الحملة مع أوقاتها (يُستبدل بها مزامن 0100)
create or replace function outbound_sync_campaign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update campaign_messages set status = new.status, error = new.error, updated_at = now(),
           sent_at = case when new.status in ('sent', 'delivered', 'read') then coalesce(sent_at, now()) else sent_at end,
           delivered_at = case when new.status in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end,
           read_at = case when new.status = 'read' then coalesce(read_at, now()) else read_at end
     where outbound_id = new.id and status <> 'opened_manually';
  end if;
  return new;
end $$;

-- ---------- 3) eligibility + audience helpers ---------------------------------------------
create or replace function whatsapp_eligibility(p_customers uuid[])
returns table (customer_id uuid, eligible boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية إرسال العروض'; end if;
  return query
    select c.id,
           (c.marketing_consent and c.opted_out_at is null and 'whatsapp' = any(c.consent_channels)
             and coalesce(c.phone, '') ~ '^05[0-9]{8}$' and c.is_active),
           case when not c.is_active then 'inactive'
                when c.opted_out_at is not null then 'opted_out'
                when not c.marketing_consent or not ('whatsapp' = any(c.consent_channels)) then 'no_consent'
                when coalesce(c.phone, '') !~ '^05[0-9]{8}$' then 'no_phone'
                else null end
      from customers c
     where c.id = any(p_customers) and (is_cross_branch() or c.branch_id = get_my_branch());
end $$;
grant execute on function whatsapp_eligibility(uuid[]) to authenticated;

-- الخدمات التي طلبها/تعاقد عليها كل عميل (لفلترة صفحة العملاء)
create or replace function customer_service_codes()
returns table (customer_id uuid, service_code text)
language sql stable security definer set search_path = public as $$
  select distinct x.customer_id, x.service_code from (
    select c.customer_id, c.service_code from contracts c
     where c.service_code is not null and (is_cross_branch() or c.branch_id = get_my_branch())
    union
    select l.customer_id, l.service_code from leads l
     where l.customer_id is not null and l.service_code is not null
       and (is_cross_branch() or l.branch_id = get_my_branch())
  ) x where can_view_customers()
$$;
grant execute on function customer_service_codes() to authenticated;

-- ---------- 4) queue an offer --------------------------------------------------------------
create or replace function whatsapp_today_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from campaign_messages
   where channel = 'whatsapp' and status <> 'cancelled'
     and (created_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date
$$;

create or replace function queue_whatsapp_offer(p_campaign uuid, p_customers uuid[], p_template uuid,
                                                p_offer text, p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t whatsapp_templates%rowtype; v_status text; c record; v_out uuid; v_name text; v_exp text; v_body text;
        v_q int := 0; v_ne int := 0; v_dup int := 0; v_lim int := 0;
        v_left int := ops_cfg('whatsapp_daily_limit', 250)::int - whatsapp_today_count();
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية إرسال العروض'; end if;
  select * into t from whatsapp_templates where id = p_template;
  if t.id is null or not t.is_active or t.meta_status <> 'approved' then
    raise exception 'اختر قالب رسالة معتمداً من Meta';
  end if;
  select campaign_status(cp) into v_status from campaigns cp where cp.id = p_campaign;
  if v_status is null then raise exception 'الحملة غير موجودة'; end if;
  if v_status <> 'active' then raise exception 'لا يُرسل عرض لحملة غير نشطة'; end if;
  if length(btrim(coalesce(p_offer, ''))) < 3 then raise exception 'اكتب العرض'; end if;
  if p_expires is null or p_expires <= now() then raise exception 'تاريخ انتهاء العرض بعد الآن'; end if;
  v_exp := to_char(p_expires at time zone 'Asia/Riyadh', 'YYYY-MM-DD');
  for c in select e.customer_id, e.eligible from whatsapp_eligibility(p_customers) e loop
    if not c.eligible then v_ne := v_ne + 1; continue; end if;
    if exists (select 1 from campaign_messages m where m.campaign_id = p_campaign and m.customer_id = c.customer_id
                and m.status in ('queued', 'sent', 'delivered', 'read')) then
      v_dup := v_dup + 1; continue;
    end if;
    if v_left <= 0 then v_lim := v_lim + 1; continue; end if;
    select split_part(full_name, ' ', 1) into v_name from customers where id = c.customer_id;
    v_body := replace(replace(replace(t.body, '{{1}}', v_name), '{{2}}', btrim(p_offer)), '{{3}}', v_exp);
    insert into outbound_messages (channel, to_address, template, body, entity, entity_id, payload)
    select 'whatsapp', '966' || substr(cu.phone, 2), 'campaign_offer', v_body, 'campaign', p_campaign,
           jsonb_build_object('template', t.provider_name, 'language', t.language,
                              'params', jsonb_build_array(v_name, btrim(p_offer), v_exp))
      from customers cu where cu.id = c.customer_id
    returning id into v_out;
    insert into campaign_messages (campaign_id, customer_id, channel, to_address, body, outbound_id,
                                   template_id, offer_text, offer_expires_at)
    select p_campaign, c.customer_id, 'whatsapp', o.to_address, v_body, v_out, t.id, btrim(p_offer), p_expires
      from outbound_messages o where o.id = v_out;
    v_q := v_q + 1; v_left := v_left - 1;
  end loop;
  return jsonb_build_object('queued', v_q, 'not_eligible', v_ne, 'duplicate', v_dup, 'over_limit', v_lim,
                            'remaining_today', greatest(v_left, 0));
end $$;
grant execute on function queue_whatsapp_offer(uuid, uuid[], uuid, text, timestamptz) to authenticated;

-- إعادة محاولة رسالة فاشلة بقرار الموظف (لا تكرار: نفس السجل)
create or replace function retry_campaign_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m campaign_messages%rowtype;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية'; end if;
  select * into m from campaign_messages where id = p_id;
  if m.id is null or m.status <> 'failed' then raise exception 'تُعاد محاولة الرسائل الفاشلة فقط'; end if;
  update outbound_messages set status = 'queued', error = null, attempts = 0, next_attempt_at = null,
         locked_until = null, provider_message_id = null where id = m.outbound_id;
end $$;
grant execute on function retry_campaign_message(uuid) to authenticated;

-- ---------- 5) provider side (service_role only — Edge Functions) ---------------------------
create or replace function whatsapp_claim_batch(p_limit integer default 20)
returns table (id uuid, to_address text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  update outbound_messages o set locked_until = now() + interval '5 minutes', attempts = o.attempts + 1
   where o.id in (select x.id from outbound_messages x
                   where x.channel = 'whatsapp' and x.status = 'queued' and x.provider_message_id is null
                     and x.payload is not null
                     and (x.next_attempt_at is null or x.next_attempt_at <= now())
                     and (x.locked_until is null or x.locked_until < now())
                   order by x.created_at limit greatest(least(p_limit, 100), 1)
                   for update skip locked)
  returning o.id, o.to_address, o.payload, o.attempts;
end $$;

create or replace function whatsapp_submitted(p_id uuid, p_provider_id text) returns void
language sql security definer set search_path = public as $$
  update outbound_messages set provider_message_id = p_provider_id, locked_until = null, error = null where id = p_id
$$;

create or replace function whatsapp_submit_failed(p_id uuid, p_error text, p_retryable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o outbound_messages%rowtype;
begin
  select * into o from outbound_messages where id = p_id;
  if p_retryable and o.attempts < ops_cfg('whatsapp_max_attempts', 3) then
    update outbound_messages set locked_until = null, error = left(p_error, 500),
           next_attempt_at = now() + make_interval(mins => 5 * o.attempts) where id = p_id;
  else
    update outbound_messages set status = 'failed', locked_until = null, error = left(p_error, 500) where id = p_id;
  end if;
end $$;

-- حالات Meta: لا تتراجع الحالة (read > delivered > sent)، والفشل يُسجَّل
create or replace function whatsapp_status_update(p_provider_id text, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o outbound_messages%rowtype; rank_old int; rank_new int;
begin
  select * into o from outbound_messages where provider_message_id = p_provider_id;
  if o.id is null then return; end if;
  rank_old := case o.status when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 4 end;
  rank_new := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else -1 end;
  if rank_new < 0 or (rank_new <= rank_old and p_status <> 'failed') or o.status in ('failed', 'cancelled') then return; end if;
  update outbound_messages set status = p_status, error = coalesce(left(p_error, 500), error),
         sent_at = case when p_status in ('sent', 'delivered', 'read') then coalesce(sent_at, now()) else sent_at end
   where id = o.id;
end $$;

create or replace function whatsapp_inbound_record(p_from text, p_body text, p_provider_id text) returns void
language plpgsql security definer set search_path = public as $$
declare m campaign_messages%rowtype;
begin
  if exists (select 1 from whatsapp_inbound where provider_message_id = p_provider_id) then return; end if;
  select * into m from campaign_messages where to_address = p_from and created_at > now() - interval '30 days'
   order by created_at desc limit 1;
  insert into whatsapp_inbound (from_address, body, provider_message_id, campaign_message_id, customer_id)
  values (p_from, left(p_body, 2000), p_provider_id, m.id, m.customer_id);
  if m.id is not null then
    update campaign_messages set reply_text = left(p_body, 2000), replied_at = now(), updated_at = now() where id = m.id;
  end if;
end $$;

create or replace function integration_heartbeat(p_name text, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  insert into integration_status (name, last_ok_at, last_error, last_error_at)
  values (p_name, case when p_ok then now() end, case when not p_ok then left(p_error, 500) end, case when not p_ok then now() end)
  on conflict (name) do update set
    last_ok_at = case when p_ok then now() else integration_status.last_ok_at end,
    last_error = case when p_ok then integration_status.last_error else left(p_error, 500) end,
    last_error_at = case when p_ok then integration_status.last_error_at else now() end
$$;

do $$
declare f text;
begin
  foreach f in array array['whatsapp_claim_batch(integer)', 'whatsapp_submitted(uuid, text)',
                           'whatsapp_submit_failed(uuid, text, boolean)', 'whatsapp_status_update(text, text, text)',
                           'whatsapp_inbound_record(text, text, text)', 'integration_heartbeat(text, boolean, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------- 6) contract ↔ offer message ----------------------------------------------------
alter table contracts add column if not exists campaign_message_id uuid references campaign_messages(id) on delete set null;

create or replace function apply_contract_marketing(p_contract uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_src text; v_acq text; v_msg campaign_messages%rowtype;
begin
  select cu.acquisition_source_code into v_acq
    from contracts c join customers cu on cu.id = c.customer_id where c.id = p_contract;
  v_src := coalesce(nullif(p->>'source_code', ''), v_acq);
  -- علاقة موثّقة برسالة عرض أُرسلت لنفس العميل (0102) تحدّد الحملة
  if nullif(p->>'campaign_message_id', '') is not null then
    select m.* into v_msg from campaign_messages m join contracts c on c.customer_id = m.customer_id
     where m.id = (p->>'campaign_message_id')::uuid and c.id = p_contract;
    if v_msg.id is null then raise exception 'رسالة العرض لا تخص عميل هذا العقد'; end if;
  end if;
  if v_src is not null and not exists (select 1 from lead_sources where code = v_src) then
    raise exception 'مصدر العقد غير صحيح';
  end if;
  update contracts set
    source_code = v_src,
    source_note = nullif(btrim(coalesce(p->>'source_note', '')), ''),
    campaign_id = coalesce(v_msg.campaign_id, nullif(p->>'campaign_id', '')::uuid),
    campaign_message_id = v_msg.id,
    lead_id = coalesce(contracts.lead_id, nullif(p->>'lead_id', '')::uuid),
    acquisition_source_code = coalesce(contracts.acquisition_source_code, v_acq),
    first_contact_at = coalesce(contracts.first_contact_at, (select cu.first_contact_at from customers cu
                                                     join contracts c on c.customer_id = cu.id where c.id = p_contract))
  where contracts.id = p_contract;
end $$;


-- عروض أُرسلت لعميل (لاختيار العلاقة الموثّقة عند إنشاء العقد)
create or replace function customer_offer_messages(p_customer uuid)
returns table (id uuid, campaign_id uuid, campaign_name text, offer_text text, status text, created_at timestamptz,
               offer_expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.campaign_id, c.name, m.offer_text, m.status, m.created_at, m.offer_expires_at
    from campaign_messages m join campaigns c on c.id = m.campaign_id
   where m.customer_id = p_customer and m.created_at > now() - interval '90 days'
     and (has_perm('contracts', 'create') or has_perm('loyalty', 'view'))
   order by m.created_at desc
$$;
grant execute on function customer_offer_messages(uuid) to authenticated;

-- ---------- 7) campaign WhatsApp report -------------------------------------------------------
create or replace function campaign_whatsapp_report(p_campaign uuid)
returns table (messages bigint, queued bigint, sent bigint, delivered bigint, read bigint, failed bigint,
               manual bigint, replied bigint, interested bigint, engaged_customers bigint,
               contracts bigint, contracts_value numeric, collected numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not marketing_can_view() then raise exception 'لا تملك صلاحية التقارير'; end if;
  return query
  with m as (select * from campaign_messages where campaign_id = p_campaign),
       k as (select c.* from contracts c where c.campaign_message_id in (select id from m) and c.status::text <> 'cancelled')
  select count(*),
         count(*) filter (where m.status = 'queued'),
         count(*) filter (where m.status = 'sent'),
         count(*) filter (where m.status = 'delivered'),
         count(*) filter (where m.status = 'read'),
         count(*) filter (where m.status = 'failed'),
         count(*) filter (where m.status = 'opened_manually'),
         count(*) filter (where m.replied_at is not null),
         count(*) filter (where m.response = 'interested'),
         count(distinct m.customer_id) filter (where m.read_at is not null or m.replied_at is not null or m.response = 'interested'),
         (select count(*) from k),
         coalesce((select sum(total_amount) from k), 0),
         coalesce((select sum(p.amount) from payments p where p.contract_id in (select id from k) and p.status = 'received'), 0)
    from m;
end $$;
grant execute on function campaign_whatsapp_report(uuid) to authenticated;
