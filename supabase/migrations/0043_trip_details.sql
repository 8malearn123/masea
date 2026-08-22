-- =============================================================
-- Masiat Alsharq ERP — 0043 Trip details for the driver's board
-- The driver needs to know, per trip: where the customer is, when to be there
-- (drop-off), and when to pick the worker back up. customer_phone already
-- exists on service_requests (0011); add the address + the two appointments.
-- =============================================================

alter table service_requests
  add column if not exists customer_address text,
  add column if not exists dropoff_at timestamptz,   -- متى تكون عند العميل (موعد التوصيل)
  add column if not exists pickup_at  timestamptz;    -- متى تأخذها من العميل (موعد الاستلام)
