-- =============================================================
-- Masiat Alsharq ERP — 0012 Sales Funnel Seed
-- Idempotent seed for the public catalog (services, workers, pricing).
-- =============================================================

-- ---------- services ----------
insert into services (code, name_ar, tagline_ar, description_ar, icon, unit, sort_order) values
  ('recruitment',          'استقدام',      'استقدام عمالة منزلية من الخارج', 'استقدم عاملتك المنزلية بعقد موثّق وإجراءات كاملة حتى الوصول.', '🛬', 'fixed', 1),
  ('monthly_rental',       'تأجير شهري',   'عاملة بعقد شهري مرن',            'استأجر عاملة منزلية بعقد شهري قابل للتجديد دون التزامات الاستقدام.', '🗓️', 'month', 2),
  ('daily_rental',         'تأجير يومي',   'خدمة منزلية ليوم واحد',          'احجز عاملة لمهمة يومية: تنظيف، طبخ، أو رعاية — بسرعة ومرونة.', '🧹', 'day', 3),
  ('sponsorship_transfer', 'نقل كفالة',    'نقل كفالة عاملة قائمة',          'انقل كفالة عاملة حالية إليك بإجراءات نظامية عبر مساند وأبشر.', '🔁', 'fixed', 4)
on conflict (code) do nothing;

-- ---------- worker_profiles (12) ----------
insert into worker_profiles (full_name, nationality, profession, age, experience_years, languages, monthly_salary, status, bio_ar) values
  ('ماريا سانتوس',        'الفلبين',   'عاملة منزلية', 32, 6, array['العربية','الإنجليزية'],            1500, 'available', 'خبرة في تنظيف المنازل والعناية بالأطفال، تجيد التعامل مع الأجهزة المنزلية.'),
  ('غريس ريّس',           'الفلبين',   'مربية أطفال',  29, 5, array['الإنجليزية','الفلبينية'],          1600, 'available', 'متخصصة في رعاية الأطفال حديثي الولادة وحتى سن المدرسة.'),
  ('سيتي نورهاليزا',      'إندونيسيا', 'عاملة منزلية', 35, 8, array['العربية','الإندونيسية'],           1400, 'available', 'خبرة طويلة في الأعمال المنزلية وترتيب المنزل والطبخ البسيط.'),
  ('ديوي أنغرايني',       'إندونيسيا', 'طباخة',        38, 10, array['العربية','الإندونيسية'],          1700, 'available', 'تجيد إعداد المأكولات العربية والآسيوية بمستوى احترافي.'),
  ('غريس وانجيرو',        'كينيا',     'عاملة منزلية', 27, 4, array['الإنجليزية','السواحيلية'],         1300, 'available', 'نشيطة ومنظّمة، خبرة في تنظيف المنازل والمكاتب.'),
  ('فيث أتيينو',          'كينيا',     'مربية أطفال',  30, 6, array['الإنجليزية','السواحيلية'],         1450, 'available', 'صبورة ومحبة للأطفال مع خبرة في المتابعة الدراسية.'),
  ('سارة ناكاتو',         'أوغندا',    'عاملة منزلية', 26, 3, array['الإنجليزية'],                      1250, 'available', 'مجتهدة وسريعة التعلّم، خبرة في الأعمال المنزلية العامة.'),
  ('بريندا أكينيي',       'أوغندا',    'طباخة',        33, 7, array['الإنجليزية','السواحيلية'],         1550, 'available', 'تتقن الطبخ المنزلي وإدارة المطبخ وتجهيز الولائم.'),
  ('روكسانا بيغم',        'بنغلاديش',  'عاملة منزلية', 31, 5, array['العربية','البنغالية'],             1300, 'available', 'خبرة في التنظيف والكي والعناية بكبار السن.'),
  ('نسرين أكتر',          'بنغلاديش',  'عاملة منزلية', 28, 4, array['العربية','البنغالية'],             1300, 'available', 'دقيقة في تنظيم المنزل وترتيبه والاعتناء بالتفاصيل.'),
  ('نيلوكا فرناندو',      'سريلانكا',  'مربية أطفال',  34, 9, array['الإنجليزية','السنهالية'],          1650, 'available', 'خبرة واسعة في رعاية الأطفال والرضّع وتنظيم يومهم.'),
  ('راجو كومارا',         'سريلانكا',  'سائق',         40, 12, array['العربية','الإنجليزية','السنهالية'], 1800, 'available', 'سائق خاص بخبرة طويلة، يعرف طرق المنطقة ويلتزم بالمواعيد.')
on conflict do nothing;

-- ---------- pricing_rules ----------
-- Recruitment: one-time fee by nationality (fixed)
insert into pricing_rules (service_code, nationality, profession, duration_unit, base_price) values
  ('recruitment', 'الفلبين',   null, 'fixed', 16000),
  ('recruitment', 'إندونيسيا', null, 'fixed', 14000),
  ('recruitment', 'كينيا',     null, 'fixed', 13000),
  ('recruitment', 'أوغندا',    null, 'fixed', 12000),
  ('recruitment', 'بنغلاديش',  null, 'fixed', 11000),
  ('recruitment', 'سريلانكا',  null, 'fixed', 13500),
  ('recruitment', null,        null, 'fixed', 14000)  -- default
on conflict do nothing;

-- Monthly rental: per-month rate by nationality
insert into pricing_rules (service_code, nationality, profession, duration_unit, base_price) values
  ('monthly_rental', 'الفلبين',   null, 'month', 2500),
  ('monthly_rental', 'إندونيسيا', null, 'month', 2200),
  ('monthly_rental', 'كينيا',     null, 'month', 2000),
  ('monthly_rental', 'أوغندا',    null, 'month', 1900),
  ('monthly_rental', 'سريلانكا',  null, 'month', 2300),
  ('monthly_rental', null,        null, 'month', 2200)  -- default
on conflict do nothing;

-- Daily rental: per-day rate by task type (profession)
insert into pricing_rules (service_code, nationality, profession, duration_unit, base_price) values
  ('daily_rental', null, 'تنظيف', 'day', 180),
  ('daily_rental', null, 'طبخ',   'day', 220),
  ('daily_rental', null, 'رعاية', 'day', 200),
  ('daily_rental', null, null,    'day', 180)  -- default
on conflict do nothing;

-- Sponsorship transfer: fixed processing fee
insert into pricing_rules (service_code, nationality, profession, duration_unit, base_price) values
  ('sponsorship_transfer', null, null, 'fixed', 2000)
on conflict do nothing;
