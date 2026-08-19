-- Adds a real ordering date to purchase orders.
--
-- Deliberately NOT backfilled. created_at / imported_at / updated_at are one
-- identical bulk-import timestamp for all 378 existing rows, so copying any of
-- them into order_date would fabricate ordering dates that look authoritative
-- in the Inventory table. Left NULL and shown as "Set date" until entered.
alter table purchase_orders
  add column if not exists order_date date;

comment on column purchase_orders.order_date is
  'Date this batch was ordered from the supplier. Entered by hand; one product can have several POs with different order dates.';

-- The Inventory summary groups POs by product, so this is the access path.
create index if not exists purchase_orders_product_order_date_idx
  on purchase_orders (product_id, order_date desc);
