-- Rollback for 0063_sales.sql.
-- Sales are derived from contracts, so dropping them loses no source data
-- (contracts keep their amounts and statuses); sale notes are lost.
drop trigger if exists trg_contract_sale on contracts;
drop function if exists sync_sale_from_contract();
drop table if exists sale_notes;
drop table if exists sales;
drop function if exists sale_notes_stamp();
drop function if exists sale_notes_immutable();
drop function if exists can_view_sale(uuid, uuid);
drop function if exists contract_is_sold(text);
