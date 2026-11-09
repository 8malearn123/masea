-- =============================================================
-- 0086 — الموقع العام (صفحة الهبوط): بيانات الشركة المُدارة + طلب الخدمة من الزائر
--   • company_profile: صف واحد يُدار من «الإعدادات» (settings.manage) ويُقرأ علنًا —
--     الهاتف وواتساب والبريد والعنوان والسجل التجاري وروابط التواصل وصور الموقع. لا
--     قيمة افتراضية مختلَقة: ما لا يُدخله الإداري لا يظهر في الصفحة.
--   • public_site_info(): ما تعرضه الصفحة من بيانات حقيقية — بيانات الشركة، الفروع
--     والخدمات الفعّالة، عدد الجنسيات المتاحة، حدود التأجير بالساعة ومدة ضمان
--     الاستبدال من app_config (التي لا يقرؤها الزائر مباشرة).
--   • submit_web_lead(): الزائر يرسل طلب خدمة → عميل محتمل في خط المبيعات (المصدر
--     «الموقع الإلكتروني»، المرحلة «جديد»، فرع المدينة). تحقق في الخادم، حقل فخّ
--     للروبوتات، وحد للطلبات المكررة من نفس الجوال.
--   • حاوية site-media العامة لصور الموقع (الكتابة settings.manage).
-- التراجع: supabase/rollback/0086_public_site_down.sql
-- =============================================================

create table if not exists company_profile (
  id               integer primary key default 1 check (id = 1),
  display_name     text,
  legal_name       text,
  cr_number        text,
  vat_number       text,
  founded_year     integer check (founded_year is null or founded_year between 1950 and 2100),
  phone            text,
  whatsapp         text,
  email            text,
  address          text,
  working_hours    text,
  maps_url         text,
  instagram_url    text,
  x_url            text,
  snapchat_url     text,
  tiktok_url       text,
  linkedin_url     text,
  hero_image_url   text,
  experience_image_url text,
  privacy_url      text,
  terms_url        text,
  updated_at       timestamptz not null default now(),
  constraint company_phone_chk check (phone is null or phone ~ '^(05[0-9]{8}|9200[0-9]{5}|800[0-9]{7}|01[0-9]{7,8})$'),
  constraint company_whatsapp_chk check (whatsapp is null or whatsapp ~ '^9665[0-9]{8}$'),
  constraint company_email_chk check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- روابط آمنة فقط (https)
  constraint company_urls_chk check (
    (maps_url is null or maps_url ~ '^https://')
    and (instagram_url is null or instagram_url ~ '^https://')
    and (x_url is null or x_url ~ '^https://')
    and (snapchat_url is null or snapchat_url ~ '^https://')
    and (tiktok_url is null or tiktok_url ~ '^https://')
    and (linkedin_url is null or linkedin_url ~ '^https://')
    and (hero_image_url is null or hero_image_url ~ '^https://')
    and (experience_image_url is null or experience_image_url ~ '^https://')
    and (privacy_url is null or privacy_url ~ '^https://')
    and (terms_url is null or terms_url ~ '^https://'))
);
-- الاسم الرسمي فقط (من هوية المشروع) — بقية الحقول يملؤها الإداري
insert into company_profile (id, display_name) values (1, 'ماسية الشرق للاستقدام') on conflict (id) do nothing;

alter table company_profile enable row level security;
drop policy if exists company_profile_read on company_profile;
drop policy if exists company_profile_write on company_profile;
create policy company_profile_read on company_profile for select to anon, authenticated using (true);
create policy company_profile_write on company_profile for update to authenticated
  using (has_perm('settings', 'manage')) with check (has_perm('settings', 'manage'));
grant select on company_profile to anon;

create or replace function touch_company_profile() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  -- حقول فارغة = غير معروفة (لا نص فارغ يُعرض)
  new.display_name := nullif(btrim(new.display_name), '');
  new.legal_name := nullif(btrim(new.legal_name), '');
  new.cr_number := nullif(btrim(new.cr_number), '');
  new.vat_number := nullif(btrim(new.vat_number), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  new.whatsapp := nullif(regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g'), '');
  new.email := nullif(lower(btrim(new.email)), '');
  new.address := nullif(btrim(new.address), '');
  new.working_hours := nullif(btrim(new.working_hours), '');
  return new;
end $$;
drop trigger if exists trg_touch_company_profile on company_profile;
create trigger trg_touch_company_profile before update on company_profile
  for each row execute function touch_company_profile();
drop trigger if exists trg_audit_row on company_profile;
create trigger trg_audit_row after update on company_profile
  for each row execute function audit_row_change();

-- ---------- public info for the landing page -------------------------------------
create or replace function public_site_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', (select to_jsonb(c) - 'id' - 'updated_at' from company_profile c where id = 1),
    'branches', coalesce((select jsonb_agg(b.city order by b.city) from branches b where b.city is not null), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name_ar) order by s.sort_order)
                            from services s where s.is_active), '[]'::jsonb),
    'nationalities', (select count(distinct nationality) from worker_profiles where is_active and nationality is not null),
    'hourly_min_hours', (select value from app_config where key = 'hourly_min_hours'),
    'hourly_max_hours', (select value from app_config where key = 'hourly_max_hours'),
    'replacement_guarantee_days', (select value from app_config where key = 'replacement_guarantee_days')
  )
$$;
revoke execute on function public_site_info() from public;
grant execute on function public_site_info() to anon, authenticated;

-- ---------- visitor service request → sales lead -----------------------------------
create or replace function submit_web_lead(
  p_full_name text, p_phone text, p_service_code text, p_city text,
  p_notes text default null, p_website text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_branch uuid;
  v_id     uuid;
  v_recent integer;
begin
  -- حقل فخّ مخفي: يملؤه الروبوت فقط — نردّ بنجاح دون حفظ
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    return jsonb_build_object('ok', true, 'ref', null);
  end if;
  if length(v_name) < 3 or length(v_name) > 80 then
    raise exception 'الاسم مطلوب (3 أحرف على الأقل)';
  end if;
  if v_phone like '9665%' and length(v_phone) = 12 then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone like '5%' and length(v_phone) = 9 then v_phone := '0' || v_phone; end if;
  if v_phone !~ '^05[0-9]{8}$' then
    raise exception 'رقم الجوال بصيغة 05xxxxxxxx';
  end if;
  if not exists (select 1 from services where code = p_service_code and is_active) then
    raise exception 'اختر الخدمة المطلوبة';
  end if;
  v_branch := resolve_branch_id(nullif(btrim(coalesce(p_city, '')), ''));
  if v_branch is null then
    raise exception 'اختر أقرب فرع لك';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'الملاحظات 500 حرف كحد أقصى';
  end if;
  -- طلب مكرر لنفس الجوال والخدمة خلال 24 ساعة: نعيد مرجعه بدل إنشاء آخر
  select id into v_id from leads
   where phone = v_phone and service_code = p_service_code and source_code = 'website'
     and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'ref', upper(left(v_id::text, 8)), 'duplicate', true);
  end if;
  select count(*) into v_recent from leads
   where phone = v_phone and source_code = 'website' and created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    raise exception 'استلمنا طلباتك اليوم وسيتواصل معك فريقنا قريبًا';
  end if;

  insert into leads (full_name, phone, source_code, service_code, stage_code, branch_id, notes, city)
  values (v_name, v_phone, 'website', p_service_code, 'new', v_branch,
          nullif(btrim(coalesce(p_notes, '')), ''), btrim(p_city))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'ref', upper(left(v_id::text, 8)));
end $$;
revoke execute on function submit_web_lead(text, text, text, text, text, text) from public;
grant execute on function submit_web_lead(text, text, text, text, text, text) to anon, authenticated;

-- ---------- public site images --------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — bucket site-media skipped';
    return;
  end if;
  execute $b$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('site-media', 'site-media', true, 3145728, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types $b$;
  execute 'drop policy if exists site_media_write on storage.objects';
  execute $p$ create policy site_media_write on storage.objects for insert to authenticated
    with check (bucket_id = 'site-media' and public.has_perm('settings','manage')) $p$;
end $$;
