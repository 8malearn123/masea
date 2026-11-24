-- Rollback for 0102_whatsapp_offers.sql. Templates, messages, replies and links are kept.
-- Re-apply apply_contract_marketing from 0098 and outbound_sync_campaign from 0100 afterwards.
drop function if exists campaign_whatsapp_report(uuid);
drop function if exists customer_offer_messages(uuid);
drop function if exists integration_heartbeat(text, boolean, text);
drop function if exists whatsapp_inbound_record(text, text, text);
drop function if exists whatsapp_status_update(text, text, text);
drop function if exists whatsapp_submit_failed(uuid, text, boolean);
drop function if exists whatsapp_submitted(uuid, text);
drop function if exists whatsapp_claim_batch(integer);
drop function if exists retry_campaign_message(uuid);
drop function if exists queue_whatsapp_offer(uuid, uuid[], uuid, text, timestamptz);
drop function if exists whatsapp_today_count();
drop function if exists customer_service_codes();
drop function if exists whatsapp_eligibility(uuid[]);
delete from app_config where key in ('whatsapp_daily_limit', 'whatsapp_max_attempts');
