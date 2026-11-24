-- Rollback for 0101_campaign_expiry_wheel.sql. Re-apply evaluate_promotion from 0066 and
-- spin_wheel from 0059 after running this. Links, spins and extension logs are kept.
drop function if exists wheel_report(date, date);
drop function if exists spin_wheel_by_token(text);
drop function if exists wheel_public_view(text);
drop function if exists wheel_link_resolve(text);
drop function if exists create_wheel_link(uuid);
drop function if exists spin_wheel_core(uuid, uuid);
drop trigger if exists trg_wheel_prizes_guard on wheel_prizes;
drop function if exists wheel_prizes_guard();
drop trigger if exists trg_campaigns_guard_delete on campaigns;
drop function if exists campaigns_guard_delete();
drop function if exists extend_campaign(uuid, timestamptz, text);
delete from app_config where key in ('wheel_open_discount_max_pct', 'wheel_coupon_valid_days', 'wheel_link_valid_hours');
