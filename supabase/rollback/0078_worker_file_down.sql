-- Rollback for 0078_worker_file.sql.
-- The identity numbers return to worker_profiles (data copied back); the
-- private details table, its guards and the sync go. Operational workers rows
-- created by the sync stay (real records referenced by housing/contracts).
alter table worker_profiles add column if not exists passport_no text;
alter table worker_profiles add column if not exists iqama_no text;
update worker_profiles p set passport_no = d.passport_no, iqama_no = d.iqama_no
  from worker_details d where d.worker_id = p.id;
drop trigger if exists trg_sync_ops_from_profile on worker_profiles;
drop trigger if exists trg_ensure_worker_details on worker_profiles;
drop table if exists worker_details;
drop function if exists trg_sync_ops_worker();
drop function if exists sync_ops_worker(uuid);
drop function if exists guard_worker_details();
drop function if exists ensure_worker_details();
drop sequence if exists worker_barcode_seq;
delete from hr_lookups where kind = 'bank';
alter table hr_lookups drop constraint if exists hr_lookups_kind_check;
alter table hr_lookups add constraint hr_lookups_kind_check check (kind in
  ('department','job_title','nationality','profession','skill','language','doc_type'));
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists worker_photos_write on storage.objects';
    execute 'drop policy if exists worker_photos_update on storage.objects';
  end if;
end $$;
-- (cascade_hr_lookup_rename / hr_lookup_usage keep their 'bank' branch harmlessly)
