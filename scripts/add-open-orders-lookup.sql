-- Orders still in flight for one phone number.
--
-- Must go through normalize_mru_phone() on BOTH sides: 127 of the 3,812 open
-- deliveries store contact_1 with spaces ('5820 7097', '54 85 07 18'), so a
-- plain equality check silently reports "no open orders" for exactly the
-- clients most likely to be duplicated. Matching the existing
-- get_client_order_history() convention rather than inventing a second one.
CREATE OR REPLACE FUNCTION public.get_client_open_orders(p_phone text)
 RETURNS TABLE(
   id uuid,
   products text,
   qty integer,
   amount numeric,
   delivery_date date,
   status text,
   created_at timestamp with time zone,
   agent text
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT d.id, d.products, d.qty, d.amount, d.delivery_date, d.status::text,
         d.created_at, pr.name AS agent
  FROM deliveries d
  LEFT JOIN profiles pr ON pr.id = d.created_by
  WHERE normalize_mru_phone(d.contact_1) = normalize_mru_phone(p_phone)
    AND d.status IN ('pending', 'assigned')
  ORDER BY d.created_at DESC
  LIMIT 20;
$function$;
