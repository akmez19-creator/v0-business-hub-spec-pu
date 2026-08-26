-- Marketing agent home: a client search box and that agent's own entries.
--
-- Marketing agents were being shown company-wide operational metrics (total
-- deliveries, pending/assigned/delivered across the whole business, and a
-- count of all 39,647 clients). None of it is actionable for someone whose job
-- is to answer a chat, look a person up, and file the order. These two
-- functions are the only data that view needs.

-- ---------------------------------------------------------------------------
-- 1. Client lookup.
--
-- Deliberately does NOT use normalize_mru_phone() on the search input.
-- That function is a VALIDATOR, not a search helper: it returns NULL for
-- anything shorter than 7 digits, so searching the partial "5711" that an
-- agent has half-typed would match nothing and the box would look broken
-- mid-keystroke. Here the digits are extracted directly and matched as a
-- prefix, so results narrow as they type.
--
-- clients.phone is already fully normalized (39,649/39,649 rows equal their
-- own normalize_mru_phone output), so the stored side needs no conversion.
CREATE OR REPLACE FUNCTION public.search_clients_for_agent(
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  region text,
  client_status text,
  total_orders int,
  delivered_rate numeric,
  last_order_date date,
  open_orders bigint
)
LANGUAGE sql
STABLE
AS $function$
  WITH input AS (
    SELECT
      btrim(coalesce(p_query, '')) AS q,
      -- Strip the +230 country code so both "+230 5711 4996" and "57114996"
      -- resolve to the same local number.
      CASE
        WHEN length(regexp_replace(coalesce(p_query, ''), '\D', '', 'g')) = 11
         AND left(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), 3) = '230'
        THEN substring(regexp_replace(coalesce(p_query, ''), '\D', '', 'g') FROM 4)
        ELSE regexp_replace(coalesce(p_query, ''), '\D', '', 'g')
      END AS digits
  ),
  -- Match and truncate FIRST, then look up open orders for the handful of rows
  -- that survive. Doing it the other way (a correlated subquery per candidate)
  -- measured 481ms because normalize_mru_phone(contact_1) is not indexable and
  -- so re-scanned deliveries once per result - too slow for a box that
  -- searches while the agent types.
  matched AS (
    SELECT c.id, c.name, c.phone, c.region, c.client_status,
           c.total_orders, c.delivered_rate, c.last_order_date
    FROM clients c, input i
    WHERE
      -- Phone first: an exact hit on a complete number uses the unique index,
      -- and a prefix match handles a number still being typed.
      (length(i.digits) >= 4 AND c.phone LIKE i.digits || '%')
      -- Then name, only when the query actually contains letters.
      OR (i.q ~ '[A-Za-z]' AND c.name ILIKE '%' || i.q || '%')
    ORDER BY
      -- Exact phone match always ranks first.
      (c.phone = i.digits) DESC,
      c.last_order_date DESC NULLS LAST,
      c.name
    LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
  ),
  -- One pass over the open orders of just those clients. contact_1 has to be
  -- normalized because 127 open rows store it with spaces.
  open_counts AS (
    SELECT normalize_mru_phone(d.contact_1) AS ph, count(*) AS n
    FROM deliveries d
    WHERE d.status IN ('pending', 'assigned')
      AND normalize_mru_phone(d.contact_1) IN (SELECT m.phone FROM matched m)
    GROUP BY 1
  )
  SELECT
    m.id, m.name, m.phone, m.region, m.client_status,
    m.total_orders, m.delivered_rate, m.last_order_date,
    coalesce(o.n, 0) AS open_orders
  FROM matched m
  LEFT JOIN open_counts o ON o.ph = m.phone
  ORDER BY coalesce(o.n, 0) DESC, m.last_order_date DESC NULLS LAST, m.name;
$function$;

-- ---------------------------------------------------------------------------
-- 2. One agent's entries for one day.
--
-- The day boundary is pinned to Indian/Mauritius. The database runs in UTC,
-- so an order filed at 01:00 local would otherwise be counted against the
-- previous day. No row currently trips this (nobody has entered an order
-- between midnight and 04:00 local), but "correct only until someone works
-- late" is not a property worth keeping.
CREATE OR REPLACE FUNCTION public.get_agent_entries_for_day(
  p_agent uuid,
  p_date date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  customer_name text,
  contact_1 text,
  products text,
  qty int,
  amount numeric,
  locality text,
  rte text,
  status text,
  delivery_date date,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    d.id,
    d.customer_name,
    d.contact_1,
    d.products,
    d.qty,
    d.amount,
    d.locality,
    d.rte,
    d.status,
    d.delivery_date,
    d.created_at
  FROM deliveries d
  WHERE d.created_by = p_agent
    AND (d.created_at AT TIME ZONE 'Indian/Mauritius')::date
        = coalesce(p_date, (now() AT TIME ZONE 'Indian/Mauritius')::date)
  ORDER BY d.created_at DESC;
$function$;
