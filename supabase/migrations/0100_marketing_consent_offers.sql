-- =============================================================
-- 0100 — الموافقة على الرسائل التسويقية + إرسال عروض الحملات وسجلها
-- (docs/plans/marketing-attribution-plan.md — المرحلة 4)
--
--   * لا يُرسل عرض إلا لعميل مسجّلة موافقته ولم يلغها (القدامى بلا موافقة = لا إرسال).
--   * الرسائل تدخل طابور outbound_messages القائم (0092). لا يوجد مزوّد إرسال مربوط
--     بعد: تبقى «في الطابور» ولا يُدّعى إرسالها. حين يُربط مزوّد (WhatsApp Business
--     API/Twilio) يحدّث حالة الطابور فتنعكس على سجل الحملة تلقائياً.
--   * فتح واتساب يدوياً يُسجَّل «فُتح يدوياً — غير مؤكد الإرسال» وليس «مُرسلة».
--   * استجابة العميل تُسجَّل على الرسالة؛ العقد الناتج يُربط بالحملة من «عقد جديد».
-- آمن لإعادة التشغيل.
-- =============================================================

-- ---------- 1) consent --------------------------------------------------------------
alter table customers add column if not exists marketing_consent boolean not null default false;
alter table customers add column if not exists consent_channels text[] not null default '{}';
alter table customers add column if not exists consent_at timestamptz;
alter table customers add column if not exists consent_source text;
alter table customers add column if not exists opted_out_at timestamptz;

create table if not exists customer_consent_events (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  action      text not null check (action in ('grant', 'revoke')),
  channels    text[] not null default '{}',
  source      text,
  note        text,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table customer_consent_events enable row level security;
drop policy if exists cce_read on customer_consent_events;
create policy cce_read on customer_consent_events for select to authenticated using (can_view_customers());

create or replace function set_marketing_consent(p_customer uuid, p_granted boolean, p_channels text[],
                                                 p_source text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('customers', 'edit') or has_perm('leads', 'edit') or has_perm('loyalty', 'manage')) then
    raise exception 'لا تملك صلاحية تسجيل الموافقة التسويقية';
  end if;
  if not exists (select 1 from customers where id = p_customer) then raise exception 'العميل غير موجود'; end if;
  if p_granted then
    if coalesce(cardinality(p_channels), 0) = 0 or not (p_channels <@ array['whatsapp', 'sms', 'email']) then
      raise exception 'حدّد قناة الموافقة (واتساب/رسائل نصية/بريد)';
    end if;
    if length(btrim(coalesce(p_source, ''))) < 3 then
      raise exception 'وثّق مصدر الموافقة (مثال: موافقة شفهية في الفرع بتاريخ…)';
    end if;
    update customers set marketing_consent = true, consent_channels = p_channels, consent_at = now(),
           consent_source = btrim(p_source), opted_out_at = null where id = p_customer;
  else
    update customers set marketing_consent = false, opted_out_at = now() where id = p_customer;
  end if;
  insert into customer_consent_events (customer_id, action, channels, source, note)
  values (p_customer, case when p_granted then 'grant' else 'revoke' end, coalesce(p_channels, '{}'),
          nullif(btrim(p_source), ''), nullif(btrim(p_note), ''));
end $$;
grant execute on function set_marketing_consent(uuid, boolean, text[], text, text) to authenticated;

-- ---------- 2) campaign messages ---------------------------------------------------------
alter table outbound_messages drop constraint if exists outbound_messages_status_check;
alter table outbound_messages add constraint outbound_messages_status_check
  check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled'));

create table if not exists campaign_messages (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references campaigns(id) on delete restrict,
  customer_id   uuid not null references customers(id) on delete restrict,
  channel       text not null check (channel in ('whatsapp', 'sms')),
  to_address    text not null,
  body          text not null,
  outbound_id   uuid references outbound_messages(id) on delete set null,
  status        text not null default 'queued'
                check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled', 'opened_manually')),
  error         text,
  response      text check (response in ('interested', 'not_interested', 'no_reply')),
  response_note text,
  responded_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_campaign_messages on campaign_messages(campaign_id, created_at desc);
create index if not exists idx_campaign_messages_customer on campaign_messages(customer_id);
alter table campaign_messages enable row level security;
drop policy if exists cm_read on campaign_messages;
create policy cm_read on campaign_messages for select to authenticated
  using (has_perm('loyalty', 'view') or has_perm('reports', 'view'));
drop trigger if exists trg_audit_row on campaign_messages;
create trigger trg_audit_row after insert or update on campaign_messages
  for each row execute function audit_row_change();

-- حالة الطابور (من مزوّد الإرسال لاحقاً) تنعكس على سجل الحملة
create or replace function outbound_sync_campaign() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update campaign_messages set status = new.status, error = new.error, updated_at = now()
     where outbound_id = new.id and status <> 'opened_manually';
  end if;
  return new;
end $$;
drop trigger if exists trg_outbound_sync_campaign on outbound_messages;
create trigger trg_outbound_sync_campaign after update of status on outbound_messages
  for each row execute function outbound_sync_campaign();

-- إرسال العرض: للعملاء الموافقين فقط؛ يُرجع ما وُضع في الطابور وما تُخطّي ولماذا
create or replace function queue_campaign_offer(p_campaign uuid, p_customers uuid[], p_channel text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record; v_body text; v_out uuid; v_q int := 0; v_nc int := 0; v_np int := 0; v_dup int := 0;
        v_status text;
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية إرسال العروض'; end if;
  if p_channel not in ('whatsapp', 'sms') then raise exception 'القناة غير مدعومة'; end if;
  if length(btrim(coalesce(p_body, ''))) < 10 then raise exception 'اكتب نص العرض'; end if;
  select campaign_status(cp) into v_status from campaigns cp where cp.id = p_campaign;
  if v_status is null then raise exception 'الحملة غير موجودة'; end if;
  if v_status <> 'active' then raise exception 'لا يُرسل عرض لحملة غير نشطة'; end if;
  for c in select cu.* from customers cu where cu.id = any(p_customers) loop
    if not c.marketing_consent or c.opted_out_at is not null or not (p_channel = any(c.consent_channels)) then
      v_nc := v_nc + 1; continue;
    end if;
    if coalesce(c.phone, '') !~ '^05[0-9]{8}$' then v_np := v_np + 1; continue; end if;
    if exists (select 1 from campaign_messages m where m.campaign_id = p_campaign and m.customer_id = c.id
                and m.status in ('queued', 'sent', 'delivered')) then
      v_dup := v_dup + 1; continue;
    end if;
    v_body := replace(btrim(p_body), '{الاسم}', split_part(c.full_name, ' ', 1));
    insert into outbound_messages (channel, to_address, template, body, entity, entity_id)
    values (p_channel, '966' || substr(c.phone, 2), 'campaign_offer', v_body, 'campaign', p_campaign)
    returning id into v_out;
    insert into campaign_messages (campaign_id, customer_id, channel, to_address, body, outbound_id)
    values (p_campaign, c.id, p_channel, '966' || substr(c.phone, 2), v_body, v_out);
    v_q := v_q + 1;
  end loop;
  return jsonb_build_object('queued', v_q, 'skipped_no_consent', v_nc, 'skipped_no_phone', v_np, 'skipped_duplicate', v_dup);
end $$;
grant execute on function queue_campaign_offer(uuid, uuid[], text, text) to authenticated;

-- فتح واتساب يدوياً من جهاز الموظف — لا يُعدّ إرسالاً مؤكداً
create or replace function mark_campaign_message_manual(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية'; end if;
  update campaign_messages set status = 'opened_manually', updated_at = now() where id = p_id and status in ('queued', 'failed');
  update outbound_messages set status = 'cancelled', error = 'أُرسل يدوياً من جهاز الموظف (غير مؤكد)'
   where id = (select outbound_id from campaign_messages where id = p_id) and status = 'queued';
end $$;
grant execute on function mark_campaign_message_manual(uuid) to authenticated;

create or replace function record_campaign_response(p_id uuid, p_response text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('loyalty', 'manage') or has_perm('leads', 'edit')) then raise exception 'لا تملك صلاحية'; end if;
  if p_response not in ('interested', 'not_interested', 'no_reply') then raise exception 'الاستجابة غير صحيحة'; end if;
  update campaign_messages set response = p_response, response_note = nullif(btrim(p_note), ''),
         responded_at = now(), updated_at = now() where id = p_id;
  if not found then raise exception 'الرسالة غير موجودة'; end if;
  -- «غير مهتم/إلغاء» من العميل يُسجَّل كإلغاء للموافقة إن طُلب في الملاحظة لاحقاً من ملفه (لا تلقائياً)
end $$;
grant execute on function record_campaign_response(uuid, text, text) to authenticated;

-- العملاء المستهدفون: الموافقون فقط مع الفرع والمصدر
create or replace function campaign_audience(p_channel text, p_branch uuid default null, p_source text default null)
returns table (id uuid, full_name text, phone text, branch_id uuid, acquisition_source_code text,
               consent_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('loyalty', 'manage') then raise exception 'لا تملك صلاحية'; end if;
  return query
    select c.id, c.full_name, c.phone, c.branch_id, c.acquisition_source_code, c.consent_at
      from customers c
     where c.marketing_consent and c.opted_out_at is null and p_channel = any(c.consent_channels)
       and c.is_active
       and (p_branch is null or c.branch_id = marketing_branch_scope(p_branch))
       and (is_cross_branch() or c.branch_id = get_my_branch())
       and (p_source is null or c.acquisition_source_code = p_source)
     order by c.full_name;
end $$;
grant execute on function campaign_audience(text, uuid, text) to authenticated;
