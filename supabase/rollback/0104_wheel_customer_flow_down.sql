-- Rollback for 0104_wheel_customer_flow.sql. Spins, prize uses, references and the added
-- columns are kept (history); prizes disabled by 0104 stay disabled (re-enable deliberately).
-- Re-apply from 0101 afterwards: wheel_prizes_guard, spin_wheel_core, spin_wheel,
-- create_wheel_link, wheel_public_view, spin_wheel_by_token, wheel_report.
drop function if exists wheel_report(date, date, uuid, uuid);
drop function if exists redeem_wheel_prize(text, uuid);
drop function if exists customer_wheel_prizes(uuid);
drop function if exists spin_wheel_by_token(text, text, text);
drop function if exists spin_wheel_core(uuid, uuid, uuid);
drop function if exists create_wheel_link(uuid, uuid);
drop function if exists wheel_probability_total();
