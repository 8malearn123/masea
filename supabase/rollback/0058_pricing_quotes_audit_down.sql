-- Rollback for 0058 — run manually after: pg_dump --format=custom --file=before_0058_down.dump "$DATABASE_URL"
-- Removes the new functions/tables/triggers/columns. Quote rows and prices stay;
-- only the added snapshot/history/attribution data is dropped.
begin;
drop function if exists create_quote_from_price(text, jsonb, text, text, date, text, uuid, jsonb);
drop function if exists set_quote_status(uuid, text, text);
drop function if exists change_pricing_rule(uuid, numeric, numeric, date, text);
drop trigger if exists trg_quotes_snapshot on quotes;
drop function if exists quotes_snapshot_immutable();
drop policy if exists quotes_pricing_read on quotes;
drop table if exists quote_events cascade;
drop function if exists quote_events_immutable();
drop table if exists pricing_rule_changes cascade;
drop function if exists pricing_rule_changes_immutable();
drop trigger if exists trg_pricing_config_stamp on pricing_config;
drop function if exists pricing_config_stamp();
drop trigger if exists trg_pricing_log_stamp on pricing_log;
drop function if exists pricing_log_stamp();
drop index if exists ux_quotes_quote_no;
alter table quotes drop column if exists quote_no, drop column if exists customer_name,
  drop column if exists customer_phone, drop column if exists nationality, drop column if exists profession,
  drop column if exists quantity, drop column if exists price_snapshot, drop column if exists sent_at,
  drop column if exists decided_at, drop column if exists parent_id;
alter table pricing_rules drop column if exists updated_at, drop column if exists updated_by;
alter table pricing_config drop column if exists updated_by, drop column if exists updated_by_name;
alter table pricing_log drop column if exists op_type, drop column if exists reference, drop column if exists user_name;
delete from app_config where key = 'pricing_coupon_expiry_alert_days';
commit;
