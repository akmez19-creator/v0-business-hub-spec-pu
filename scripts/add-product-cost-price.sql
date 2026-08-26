-- Landed cost per unit, in MUR, stated by a person.
--
-- Most products get their cost from purchase history: purchase_orders carries
-- total_cp_import (MUR landed = supplier payment + cbm cost) and qty, so one
-- unit costs total_cp_import / qty. Verified against all 616 priced POs -
-- import_cp already equals that division in every one of them, within 1%.
--
-- But 281 of the 591 products with stock on the shelf have no priced PO at all,
-- so their stock cannot be valued from history. This column is where that gap
-- gets filled by hand. It is NOT a second opinion on a PO-priced product: the
-- resolver prefers this value when it is set, precisely so a correction is
-- possible, and labels every row with which source it used.
alter table products
  add column if not exists cost_price numeric,
  add column if not exists cost_price_at timestamptz;

comment on column products.cost_price is
  'Landed cost of ONE unit in MUR, entered by a person. Overrides the cost derived from the most recent purchase order. Null means fall back to purchase history.';
comment on column products.cost_price_at is
  'When cost_price was last set, so a stale hand-entered cost can be told from a fresh one.';

-- A negative landed cost is always a typo, and a zero one silently removes the
-- product from the inventory value while looking like a filled-in field.
alter table products
  drop constraint if exists products_cost_price_positive;
alter table products
  add constraint products_cost_price_positive
  check (cost_price is null or cost_price > 0);
