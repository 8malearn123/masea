-- =============================================================
-- Masiat Alsharq ERP — 0054 Grant loyalty.manage to management roles
-- Bug (نفس خلل 0050 في التسعير): إعدادات الولاء والفئات والباقات
-- (loyalty_config / customer_tiers / packages) محروسة بـ has_perm('loyalty','manage')
-- لكن رمز 'full' لا يتضمّن 'manage'، فلا أحد يستطيع تعديلها — فكانت شاشة
-- «الإدارة» في الولاء عرضاً ثابتاً. الإصلاح: منح loyalty.manage للمدير العام
-- ومدير العمليات، لتصبح الإعدادات قابلة للتعديل من الواجهة.
-- يُبنى فوق الجداول القائمة (0020) — لا جداول جديدة.
-- =============================================================

insert into role_permissions (role_code, module, action)
values
  ('admin', 'loyalty', 'manage'),
  ('operations_manager', 'loyalty', 'manage')
on conflict (role_code, module, action) do nothing;

-- every edit to the managed loyalty settings is audited
create or replace function trg_loyalty_settings_audit()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into audit_log (user_id, action, table_name, old_data, new_data)
  values (auth.uid(), 'loyalty.' || lower(tg_op), tg_table_name,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

drop trigger if exists loyalty_config_audit on loyalty_config;
create trigger loyalty_config_audit after insert or update or delete on loyalty_config
  for each row execute function trg_loyalty_settings_audit();
drop trigger if exists customer_tiers_audit on customer_tiers;
create trigger customer_tiers_audit after insert or update or delete on customer_tiers
  for each row execute function trg_loyalty_settings_audit();
drop trigger if exists packages_audit on packages;
create trigger packages_audit after insert or update or delete on packages
  for each row execute function trg_loyalty_settings_audit();

-- ---------- services.icon: emoji → icon keys (UI renders lucide by service code) ----
update services set icon = case code
  when 'recruitment'          then 'plane'
  when 'monthly_rental'       then 'calendar'
  when 'daily_rental'         then 'sparkles'
  when 'sponsorship_transfer' then 'repeat'
  else icon end;
