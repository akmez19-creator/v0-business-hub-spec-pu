-- The most recent delivery we raised for one phone number, so Quick Order can
-- prefill a returning client's name, second number, locality and delivery
-- instructions instead of asking for them again.
--
-- Same normalize_mru_phone() convention as get_client_open_orders(): stored
-- numbers carry spaces, so a literal match misses exactly the repeat clients.
-- Matches contact_2 as well - a client who gave their partner's number first
-- and now writes from their own is still the same household.
-- Cancelled rows are skipped (their details were never confirmed by a delivery);
-- a delivered row wins over a pending one of the same age because a rider
-- actually found that address.
CREATE OR REPLACE FUNCTION public.get_client_last_delivery(p_phone text)
 RETURNS TABLE(
   id uuid,
   customer_name text,
   contact_1 text,
   contact_2 text,
   locality text,
   delivery_notes text,
   products text,
   status text,
   delivery_date date,
   created_at timestamp with time zone,
   past_orders integer
 )
 LANGUAGE sql
 STABLE
AS $function$
  WITH mine AS (
    SELECT d.*
    FROM deliveries d
    WHERE (normalize_mru_phone(d.contact_1) = normalize_mru_phone(p_phone)
        OR (d.contact_2 IS NOT NULL AND normalize_mru_phone(d.contact_2) = normalize_mru_phone(p_phone)))
      AND d.status <> 'cancelled'
      AND COALESCE(d.sales_type, 'sale') <> 'free_item'
  )
  SELECT m.id, m.customer_name, m.contact_1, m.contact_2, m.locality,
         NULLIF(TRIM(COALESCE(m.delivery_notes, '')), '') AS delivery_notes,
         m.products, m.status::text, m.delivery_date, m.created_at,
         (SELECT COUNT(*)::integer FROM mine) AS past_orders
  FROM mine m
  ORDER BY (m.status = 'delivered') DESC, m.created_at DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_client_last_delivery(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_last_delivery(text) TO authenticated, service_role;
