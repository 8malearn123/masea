-- Rollback for 0105_wheel_probabilities.sql. The approved probabilities are kept (an admin
-- decision). Re-apply spin_wheel_core and wheel_public_view from 0104 afterwards.
drop trigger if exists trg_wheel_prizes_total on wheel_prizes;
drop function if exists wheel_prizes_total_check();
drop trigger if exists trg_audit_row on wheel_prizes;
drop function if exists set_wheel_probabilities(jsonb);
drop function if exists wheel_pick_prize(numeric);
