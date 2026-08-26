-- Widen the "In China" definition to every in-transit purchase order status.
--
-- The column listed only Ordered / Payment Done / Loaded and Shipped, so two
-- real transit stages were invisible: "Shipped to Warehouse" and "Partially
-- Loaded and Shipped" (812 units at the time of writing). Goods sitting in the
-- supplier's warehouse are still goods you have paid for and do not have.
--
-- Excluded on purpose:
--   Message Sent / Request Discount / Negotiate Shipping - still negotiating,
--     nothing has been ordered, so there is no stock anywhere to report.
--   pending - 73 legacy imported rows whose stage was never recorded. Counting
--     34,630 unexplained units as "in China" would be a fabrication.
--   Received - arrived; it is on the shelf and counted by products.quantity.
--
-- Only the china_qty CASE changes. initial_qty, deliveries resolution and the
-- undelivered logic are byte-for-byte identical to the previous definition.

CREATE OR REPLACE FUNCTION public.get_product_stock_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with po_agg as (
  select
    product_id,
    coalesce(sum(qty), 0)::bigint as initial_qty,
    coalesce(sum(
      case when status in (
        'Ordered',
        'Payment Done',
        'Shipped to Warehouse',
        'Loaded and Shipped',
        'Partially Loaded and Shipped'
      )
      then qty else 0 end
    ), 0)::bigint as china_qty,
    max(order_date) as latest_order_date,
    jsonb_agg(
      jsonb_build_object('id', id, 'date', order_date, 'qty', qty, 'status', status)
      order by order_date desc nulls last, id
    ) as po_batches
  from purchase_orders
  where product_id is not null
  group by product_id
),
-- Deliveries mostly lack product_id (307 of 5,415), so fall back to the same
-- chain the Product Master route uses: product_id -> exact name -> alias.
-- Both maps are grouped by key so a duplicate name cannot multiply qty rows.
name_map as (
  select lower(btrim(name)) as key, min(id::text)::uuid as product_id
  from products
  where name is not null and btrim(name) <> ''
  group by 1
),
alias_map as (
  select lower(btrim(alias_name)) as key, min(product_id::text)::uuid as product_id
  from product_aliases
  where alias_name is not null and product_id is not null
  group by 1
),
-- Undelivered = not yet delivered. NOT filtered to future delivery_date: every
-- pending date currently sits in the past, so a "scheduled ahead" filter
-- returns zero rows and the column would read as broken.
resolved as (
  select coalesce(d.product_id, nm.product_id, am.product_id) as product_id, d.qty
  from deliveries d
  left join name_map nm
    on d.product_id is null and nm.key = lower(btrim(d.products))
  left join alias_map am
    on d.product_id is null and nm.product_id is null and am.key = lower(btrim(d.products))
  where d.status in ('pending', 'assigned')
),
undel as (
  select product_id, coalesce(sum(qty), 0)::bigint as undelivered_qty
  from resolved
  where product_id is not null
  group by product_id
),
ids as (
  select product_id from po_agg
  union
  select product_id from undel
)
select jsonb_build_object(
  'products', coalesce((
    select jsonb_object_agg(
      i.product_id::text,
      jsonb_build_object(
        'initialQty', coalesce(pa.initial_qty, 0),
        'chinaQty', coalesce(pa.china_qty, 0),
        'undeliveredQty', coalesce(u.undelivered_qty, 0),
        'latestOrderDate', pa.latest_order_date,
        'poBatches', coalesce(pa.po_batches, '[]'::jsonb)
      )
    )
    from ids i
    left join po_agg pa using (product_id)
    left join undel u using (product_id)
  ), '{}'::jsonb),
  -- Surfaced in the UI rather than hidden: these deliveries could not be tied
  -- to a product, so Undelivered is a slight undercount.
  'unresolvedDeliveries', (select count(*) from resolved where product_id is null)
);
$function$
;
