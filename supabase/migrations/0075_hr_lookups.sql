-- =============================================================
-- 0075 — المرحلة ب: القوائم المرجعية للموارد البشرية قابلة للإدارة
--   جدول واحد hr_lookups بنفس شكل القوائم المرجعية القائمة (code · name_ar ·
--   is_active · sort_order) بدل قوائم ثابتة في الكود:
--     department (الأقسام) · job_title (المسميات الوظيفية) · nationality
--     (الجنسيات: للموظفين/للعمالة/للكل) · profession (مهن العمالة) · skill
--     (المهارات) · language (اللغات) · doc_type (أنواع الوثائق).
--   · التعديل لمن يملك hr.manage، القراءة للجميع، لا حذف (تعطيل)، تدقيق.
--   · العناصر النظامية (is_system) لا تُعطَّل لأن منطق النظام يعتمد عليها،
--     و«السعودية» لا يتغير اسمها (الرواتب/GOSI/السعودة تقارن بالاسم).
--   · إعادة التسمية تنتقل تلقائيًا إلى السجلات التي تخزّن الاسم (الموظفون،
--     العمالة، قواعد التسعير) — لا سجلات يتيمة.
-- =============================================================

create table if not exists hr_lookups (
  kind       text not null check (kind in
               ('department','job_title','nationality','profession','skill','language','doc_type')),
  code       text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  name_ar    text not null check (length(btrim(name_ar)) between 1 and 60),
  scope      text not null default 'both' check (scope in ('staff','worker','both')),
  is_active  boolean not null default true,
  is_system  boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (kind, code)
);
create unique index if not exists hr_lookups_name_uq on hr_lookups (kind, btrim(name_ar));

-- ---------- seeds (the lists the screens used to hard-code) ------------------
insert into hr_lookups (kind, code, name_ar, sort_order) values
  ('department','admin','الإدارة',1), ('department','ops','العمليات',2),
  ('department','finance','المالية',3), ('department','hr','الموارد البشرية',4),
  ('department','sales','المبيعات',5), ('department','call_center','مركز الاتصال',6),
  ('department','housing','السكن',7),
  ('job_title','gm','المدير العام',1), ('job_title','ops_manager','مدير العمليات',2),
  ('job_title','branch_manager','مدير الفرع',3), ('job_title','accountant','محاسب',4),
  ('job_title','hr_specialist','أخصائي موارد بشرية',5), ('job_title','sales','موظفة مبيعات',6),
  ('job_title','call_center','موظفة مركز اتصال',7), ('job_title','housing_m','مشرف سكن',8),
  ('job_title','housing_f','مشرفة سكن',9), ('job_title','driver','سائق',10),
  ('job_title','recruitment','مندوب استقدام',11),
  ('profession','housemaid','عاملة منزلية',1), ('profession','cook','طباخة',2),
  ('profession','nanny','مربية أطفال',3), ('profession','cleaner','عاملة نظافة',4),
  ('profession','driver','سائق',5),
  ('skill','kids','محبة للأطفال',1), ('skill','cooking','تجيد الطبخ',2),
  ('skill','elderly','العناية بكبار السن',3), ('skill','cleaning','التنظيف',4),
  ('skill','ironing','الكي',5), ('skill','disability','رعاية ذوي الإعاقة',6),
  ('skill','driving','تجيد القيادة',7),
  ('language','ar','العربية',1), ('language','en','الإنجليزية',2), ('language','tl','الفلبينية',3),
  ('language','id','الإندونيسية',4), ('language','sw','السواحيلية',5), ('language','ur','الأردية',6),
  ('language','bn','البنغالية',7), ('language','si','السنهالية',8)
on conflict do nothing;

insert into hr_lookups (kind, code, name_ar, scope, is_system, sort_order) values
  ('nationality','SA','السعودية','staff',true,1), ('nationality','IN','الهند','both',false,2),
  ('nationality','PH','الفلبين','both',false,3), ('nationality','BD','بنغلاديش','both',false,4),
  ('nationality','EG','مصر','staff',false,5), ('nationality','PK','باكستان','both',false,6),
  ('nationality','ID','إندونيسيا','worker',false,7), ('nationality','KE','كينيا','worker',false,8),
  ('nationality','UG','أوغندا','worker',false,9), ('nationality','ET','إثيوبيا','worker',false,10),
  ('nationality','LK','سريلانكا','worker',false,11)
on conflict do nothing;

-- doc types: the code is what employee_documents.type stores; core ones are system
insert into hr_lookups (kind, code, name_ar, is_system, sort_order) values
  ('doc_type','national_id','الهوية الوطنية',true,1), ('doc_type','iqama','الإقامة',true,2),
  ('doc_type','passport','جواز سفر',true,3), ('doc_type','work_permit','رخصة العمل',true,4),
  ('doc_type','visa','التأشيرة',true,5), ('doc_type','contract','عقد عمل',false,6),
  ('doc_type','cv','السيرة الذاتية',false,7), ('doc_type','certificate','شهادة علمية/مهنية',false,8),
  ('doc_type','medical','التأمين الطبي',false,9), ('doc_type','driving_license','رخصة قيادة',false,10),
  ('doc_type','photo','صورة شخصية',false,11), ('doc_type','other','أخرى',true,12)
on conflict do nothing;

-- values already stored in records become list items (nothing is lost)
insert into hr_lookups (kind, name_ar, sort_order)
select 'job_title', btrim(job_title), 100 from employees
 where coalesce(btrim(job_title), '') <> '' group by btrim(job_title)
on conflict do nothing;
insert into hr_lookups (kind, name_ar, sort_order)
select 'department', btrim(department), 100 from employee_details
 where coalesce(btrim(department), '') <> '' group by btrim(department)
on conflict do nothing;
insert into hr_lookups (kind, name_ar, scope, sort_order)
select 'nationality', btrim(nationality), 'both', 100 from (
  select nationality from employees union select nationality from worker_profiles) n
 where coalesce(btrim(nationality), '') <> '' group by btrim(nationality)
on conflict do nothing;
insert into hr_lookups (kind, name_ar, sort_order)
select 'profession', btrim(profession), 100 from worker_profiles
 where coalesce(btrim(profession), '') <> '' group by btrim(profession)
on conflict do nothing;

-- ---------- guards: system items, Saudi name, cascade rename -----------------
create or replace function guard_hr_lookup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name_ar := btrim(new.name_ar);
  if tg_op = 'UPDATE' then
    if new.kind <> old.kind or new.code <> old.code then
      raise exception 'لا يتغير نوع العنصر أو رمزه' using errcode = '42501';
    end if;
    if old.is_system and not new.is_active then
      raise exception '«%» عنصر نظامي يعتمد عليه النظام ولا يُعطَّل', old.name_ar using errcode = '42501';
    end if;
    if new.is_system is distinct from old.is_system then
      raise exception 'صفة «نظامي» لا تُعدَّل من الواجهة' using errcode = '42501';
    end if;
    if old.kind = 'nationality' and old.code = 'SA' and new.name_ar <> old.name_ar then
      raise exception 'اسم الجنسية السعودية ثابت — تعتمد عليه الرواتب والتأمينات والسعودة' using errcode = '42501';
    end if;
    new.updated_at := now();
  elsif new.is_system and auth.uid() is not null then   -- seeds (migrations) only
    raise exception 'لا تُضاف عناصر نظامية من الواجهة' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_hr_lookup on hr_lookups;
create trigger trg_guard_hr_lookup before insert or update on hr_lookups
  for each row execute function guard_hr_lookup();

-- rename flows into every record that stores the Arabic name
create or replace function cascade_hr_lookup_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text := old.name_ar; n text := new.name_ar;
begin
  if o = n then return null; end if;
  case new.kind
    when 'department' then
      update employee_details set department = n where department = o;
    when 'job_title' then
      update employees set job_title = n where job_title = o;
    when 'nationality' then
      update employees set nationality = n where nationality = o;
      update worker_profiles set nationality = n where nationality = o;
      update pricing_rules set nationality = n where nationality = o;
    when 'profession' then
      update worker_profiles set profession = n where profession = o;
      update pricing_rules set profession = n where profession = o;
    when 'skill' then
      update worker_profiles set skills = array_replace(skills, o, n) where o = any(skills);
    when 'language' then
      update worker_profiles set languages = array_replace(languages, o, n) where o = any(languages);
    else null;  -- doc_type: records store the code
  end case;
  return null;
end $$;

drop trigger if exists trg_cascade_hr_lookup on hr_lookups;
create trigger trg_cascade_hr_lookup after update of name_ar on hr_lookups
  for each row execute function cascade_hr_lookup_rename();

-- how many records use each item (shown before renaming/disabling)
create or replace function hr_lookup_usage(p_kind text)
returns table (name_ar text, uses bigint)
language sql stable security definer set search_path = public as $$
  select x.v, count(*) from (
    select department as v from employee_details where p_kind = 'department'
    union all select job_title from employees where p_kind = 'job_title'
    union all select nationality from employees where p_kind = 'nationality'
    union all select nationality from worker_profiles where p_kind = 'nationality'
    union all select profession from worker_profiles where p_kind = 'profession'
    union all select unnest(skills) from worker_profiles where p_kind = 'skill'
    union all select unnest(languages) from worker_profiles where p_kind = 'language'
    union all select type from employee_documents where p_kind = 'doc_type' and is_active
  ) x
  where x.v is not null and has_perm('hr','view')
  group by x.v
$$;
grant execute on function hr_lookup_usage(text) to authenticated;

-- ---------- RLS + audit ------------------------------------------------------
alter table hr_lookups enable row level security;
drop policy if exists hr_lookups_read on hr_lookups;
drop policy if exists hr_lookups_insert on hr_lookups;
drop policy if exists hr_lookups_update on hr_lookups;
create policy hr_lookups_read on hr_lookups for select to authenticated using (true);
create policy hr_lookups_insert on hr_lookups for insert to authenticated
  with check (has_perm('hr','manage'));
create policy hr_lookups_update on hr_lookups for update to authenticated
  using (has_perm('hr','manage')) with check (has_perm('hr','manage'));
-- no delete policy: «حذف» = تعطيل

drop trigger if exists trg_audit_row on hr_lookups;
create trigger trg_audit_row after insert or update or delete on hr_lookups
  for each row execute function audit_row_change();
