-- Show WHO took each order, and expose open (pending/assigned) orders.
--
-- Two agents created the same Rs 475 order for the same client 55 minutes
-- apart (Hanna 06:42, Ouwais 07:37) because nothing on the order form showed
-- that the client already had an order in flight. created_by was recorded on
-- all 8,127 deliveries the whole time - it was simply never read back out.
--
-- The return type gains columns, so CREATE OR REPLACE is not enough here;
-- Postgres requires a DROP to change a function's RETURNS TABLE signature.

DROP FUNCTION IF EXISTS public.get_client_order_history(text, integer);

CREATE OR REPLACE FUNCTION public.get_client_order_history(p_phone text, p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, delivery_date date, entry_date date, status text, sales_type text, products text, qty integer, amount numeric, locality text, medium text, return_product text, notes text, created_at timestamp with time zone, agent text, rte text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT d.id, d.delivery_date, d.entry_date, d.status::text, d.sales_type,
         d.products, d.qty, d.amount, d.locality, d.medium, d.return_product,
         d.notes, d.created_at,
         -- created_by is NOT NULL in practice (8,127/8,127) but the join is
         -- left so an order can never vanish from a client's history just
         -- because its agent profile was removed.
         pr.name AS agent,
         d.rte
  FROM deliveries d
  LEFT JOIN profiles pr ON pr.id = d.created_by
  WHERE normalize_mru_phone(d.contact_1) = p_phone
  ORDER BY COALESCE(d.delivery_date, d.entry_date, d.created_at::date) DESC, d.created_at DESC
  LIMIT p_limit;
$function$;
