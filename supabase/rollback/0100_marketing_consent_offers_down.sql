-- Rollback for 0100_marketing_consent_offers.sql. Consent data and message logs are kept.
drop function if exists campaign_audience(text, uuid, text);
drop function if exists record_campaign_response(uuid, text, text);
drop function if exists mark_campaign_message_manual(uuid);
drop function if exists queue_campaign_offer(uuid, uuid[], text, text);
drop trigger if exists trg_outbound_sync_campaign on outbound_messages;
drop function if exists outbound_sync_campaign();
drop function if exists set_marketing_consent(uuid, boolean, text[], text, text);
