-- =============================================================
-- Masiat Alsharq ERP — 0050 Grant pricing.manage to management roles
-- Bug: إعدادات التسعير (pricing_config) محروسة بـ has_perm('pricing','manage')
-- لكن رمز الصلاحية 'full' لا يتضمّن 'manage'، فلم يكن أحد يملك pricing.manage —
-- فأصبحت شاشة إعدادات التسعير غير قابلة للتعديل لأي مستخدم (حتى المدير العام).
-- الإصلاح: منح pricing.manage صراحةً للمدير العام ومدير العمليات (الإدارة).
-- =============================================================

insert into role_permissions (role_code, module, action)
values
  ('admin', 'pricing', 'manage'),
  ('operations_manager', 'pricing', 'manage')
on conflict (role_code, module, action) do nothing;
