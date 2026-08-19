-- Per-product stock position for the Inventory table.
--
-- Aggregated in SQL on purpose: there are 5,400+ undelivered rows and PostgREST
-- caps a select at 1,000, which silently truncated the numbers when this was
-- prototyped client-side. One RPC = one round trip, no cap.
--
-- Buckets (verified against live data):
--   initial_qty     SUM of every PO qty for the product, any status.
--   china_qty       PO qty still outside Mauritius: Ordered / Payment Done /
--                   Loaded and Shipped.
--   undelivered_qty deliveries qty with status pending/assigned.
--
-- 'Received' and 'Shipped to Warehouse' are intentionally in NO bucket. 327 of
-- 378 POs are 'Received', i.e. already landed - that is the same physical stock
-- products.quantity counts as In Store. Adding them would double-count.
create or replace function get_product_stock_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with po_agg as (
  select
    product_id,
    coalesce(sum(qty), 0)::bigint as initial_qty,
    coalesce(sum(
      case when status in ('Ordered', 'Payment Done', 'Loaded and Shipped')
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
$$;

grant execute on function get_product_stock_summary() to authenticated, service_role;
