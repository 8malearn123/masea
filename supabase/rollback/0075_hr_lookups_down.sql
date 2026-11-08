-- Rollback for 0075_hr_lookups.sql.
-- The lists are configuration the screens fall back from; records keep the
-- names they store, so dropping the table loses no business data.
drop function if exists hr_lookup_usage(text);
drop trigger if exists trg_cascade_hr_lookup on hr_lookups;
drop trigger if exists trg_guard_hr_lookup on hr_lookups;
drop trigger if exists trg_audit_row on hr_lookups;
drop table if exists hr_lookups;
drop function if exists cascade_hr_lookup_rename();
drop function if exists guard_hr_lookup();
