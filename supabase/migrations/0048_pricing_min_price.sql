-- =============================================================
-- Masiat Alsharq ERP — 0048 Pricing floor (min_price per rule)
-- Adds a per-rule minimum (floor) price so a quote/contract can never be
-- priced below it after discounts. Managed from the pricing screen like the
-- base price — not a hardcoded value. Backfills existing rows at ~94% of base
-- as a starting floor; admins adjust per rule afterwards.
-- =============================================================

alter table pricing_rules
  add column if not exists min_price numeric(12,2);

update pricing_rules
  set min_price = round(base_price * 0.94, 0)
  where min_price is null;
