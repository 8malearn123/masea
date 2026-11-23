-- Rollback for 0095_workers_drivers_for_contracts.sql.
drop function if exists driver_availability(timestamptz, timestamptz);
drop function if exists driver_task_step(uuid, text, uuid, text);
drop function if exists create_driver_task(uuid, text, timestamptz, timestamptz, uuid, text, text, uuid, uuid, uuid);
drop function if exists driver_task_conflict(uuid, timestamptz, timestamptz, uuid);
drop table if exists driver_tasks;
alter table contract_ops_events drop constraint if exists contract_ops_events_entity_check;
alter table contract_ops_events add constraint contract_ops_events_entity_check
  check (entity in ('settlement','return','refund','replacement','trial'));
drop function if exists worker_contract_history(uuid);
drop function if exists contract_worker_candidates(text, date, date, uuid);
drop function if exists worker_next_free_date(uuid);
delete from app_config where key = 'driver_task_default_minutes';
