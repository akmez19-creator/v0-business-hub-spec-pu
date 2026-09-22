-- Add-on lines: a customer with an open order asks for another item. The item is
-- its own delivery row (one product per row, as every report and stock flow
-- expects) but points at the order it rides with, so the rider gets one drop.
-- Additive only: nullable column, replaced read-only RPC.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS parent_delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS deliveries_parent_delivery_id_idx
  ON deliveries (parent_delivery_id) WHERE parent_delivery_id IS NOT NULL;

-- The Quick Order card needs the details an add-on inherits (where, who, notes,
-- business) and whether the row is itself an add-on, so it lists a drop once.
DROP FUNCTION IF EXISTS public.get_client_open_orders(text);
CREATE FUNCTION public.get_client_open_orders(p_phone text)
 RETURNS TABLE(
   id uuid, products text, qty integer, amount numeric, delivery_date date, status text,
   created_at timestamp with time zone, agent text,
   customer_name text, contact_2 text, locality text, notes text, medium text,
   parent_delivery_id uuid
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT d.id, d.products, d.qty, d.amount, d.delivery_date, d.status::text,
         d.created_at, pr.name AS agent,
         d.customer_name, d.contact_2, d.locality, d.notes, d.medium,
         d.parent_delivery_id
  FROM deliveries d
  LEFT JOIN profiles pr ON pr.id = d.created_by
  WHERE normalize_mru_phone(d.contact_1) = normalize_mru_phone(p_phone)
    AND d.status IN ('pending', 'assigned')
    -- A B1G1 free unit rides along with its paid row. Counting it here would
    -- tell the agent the client has 2 open orders for what is one order, which
    -- is exactly the false "duplicate" signal this badge exists to prevent.
    AND COALESCE(d.sales_type, 'sale') <> 'free_item'
  ORDER BY d.created_at DESC
  LIMIT 20;
$function$;
