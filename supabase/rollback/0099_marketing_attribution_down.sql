-- Rollback for 0099_marketing_attribution.sql. Spend entries and campaign columns are kept.
drop function if exists marketing_breakdown(date, date, text, uuid, uuid);
drop function if exists marketing_campaigns(date, date, uuid);
drop function if exists marketing_sources(date, date, uuid, text, text);
drop function if exists marketing_source_report(date, date, uuid, text, text);
drop function if exists contract_credit_net(uuid);
drop function if exists marketing_branch_scope(uuid);
drop function if exists marketing_can_view();
drop function if exists reverse_campaign_spend(uuid, text);
drop function if exists add_campaign_spend(uuid, date, numeric, text, text);
drop function if exists campaign_status(campaigns);
