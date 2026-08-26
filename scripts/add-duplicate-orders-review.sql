-- Open orders that look like the same order entered twice.
--
-- Grouped on (phone, product) across pending/assigned deliveries, which finds
-- 176 groups - but most of those are NOT mistakes. Probed on live data: pairs
-- range from 55 minutes apart (the Hanna/Ouwais case) to 24 days apart
-- ('m8 smartband - pink', two different delivery dates), and a client
-- re-ordering the same item three weeks later is repeat business, not an
-- error. Deleting on the wide definition would destroy real orders.
--
-- So the confidence tiers below are the whole point of this function; the
-- caller must not flatten them:
--   same_day  - identical product AND identical delivery date (45 groups,
--               Rs 28,286). These are duplicates in the ordinary sense.
--   near      - different delivery dates but entered within 24h of each other.
--               Usually a re-entry after the agent changed the date.
--   distant   - everything else. Almost always legitimate repeat business,
--               listed last and never presented as a problem.
CREATE OR REPLACE FUNCTION public.get_duplicate_open_orders()
 RETURNS TABLE(
   phone text,
   client_name text,
   products text,
   delivery_date date,
   order_count bigint,
   redundant_value numeric,
   agents text[],
   agent_count bigint,
   confidence text,
   hours_apart numeric,
   order_ids uuid[]
 )
 LANGUAGE sql
 STABLE
AS $function$
  WITH open_orders AS (
    SELECT d.id,
           normalize_mru_phone(d.contact_1) AS ph,
           lower(trim(d.products)) AS prod,
           d.customer_name,
           d.products AS raw_products,
           d.delivery_date,
           d.amount,
           d.created_at,
           COALESCE(pr.name, 'Unknown agent') AS agent
    FROM deliveries d
    LEFT JOIN profiles pr ON pr.id = d.created_by
    WHERE d.status IN ('pending', 'assigned')
      AND d.contact_1 IS NOT NULL
      AND d.products IS NOT NULL
      AND trim(d.products) <> ''
  ),
  grouped AS (
    SELECT ph,
           prod,
           delivery_date,
           count(*) AS n,
           -- What the extra copies are worth: everything beyond one order.
           sum(amount) - (sum(amount) / count(*)) AS redundant_value,
           array_agg(DISTINCT agent) AS agents,
           count(DISTINCT agent) AS agent_count,
           array_agg(id) AS order_ids,
           min(created_at) AS first_created,
           max(created_at) AS last_created,
           max(customer_name) AS client_name,
           max(raw_products) AS raw_products
    FROM open_orders
    GROUP BY ph, prod, delivery_date
    HAVING count(*) > 1
  )
  SELECT g.ph,
         g.client_name,
         g.raw_products,
         g.delivery_date,
         g.n,
         round(g.redundant_value, 2),
         g.agents,
         g.agent_count,
         'same_day'::text,
         round(EXTRACT(epoch FROM (g.last_created - g.first_created)) / 3600.0, 1),
         g.order_ids
  FROM grouped g

  UNION ALL

  -- Same product, DIFFERENT delivery dates. Split by how close together they
  -- were entered, because that is what separates a re-entry from a re-order.
  SELECT p.ph,
         -- open_orders exposes these under their delivery-table names; the
         -- `client_name` / aggregated aliases only exist inside `grouped`.
         p.customer_name,
         p.raw_products,
         p.delivery_date,
         2::bigint,
         round(p.amount, 2),
         ARRAY[p.prev_agent, p.agent],
         (CASE WHEN p.prev_agent IS DISTINCT FROM p.agent THEN 2 ELSE 1 END)::bigint,
         CASE WHEN p.created_at - p.prev_created < interval '24 hours'
              THEN 'near' ELSE 'distant' END,
         round(EXTRACT(epoch FROM (p.created_at - p.prev_created)) / 3600.0, 1),
         ARRAY[p.prev_id, p.id]
  FROM (
    SELECT o.*,
           lag(o.id) OVER w AS prev_id,
           lag(o.created_at) OVER w AS prev_created,
           lag(o.delivery_date) OVER w AS prev_date,
           lag(o.agent) OVER w AS prev_agent
    FROM open_orders o
    WINDOW w AS (PARTITION BY o.ph, o.prod ORDER BY o.created_at)
  ) p
  WHERE p.prev_id IS NOT NULL
    AND p.delivery_date IS DISTINCT FROM p.prev_date

  ORDER BY 9, 6 DESC;
$function$;
