-- Rollback for 0103_campaign_validity.sql. The corrected end times (23:59:59 Riyadh) are kept
-- (they reflect the intended dates). Re-apply evaluate_promotion from 0101, calc_price from 0096,
-- create_contract_draft from 0102 and campaign_status from 0099 afterwards.
drop function if exists campaign_summary(uuid);
drop function if exists publish_campaign(uuid);
drop function if exists evaluate_promotion(uuid, text, numeric, text, uuid);
