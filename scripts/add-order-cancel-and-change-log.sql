-- Lets a marketing agent amend or cancel an order from their Overview, and
-- records every change so admins can see who did what.
--
-- Why a real 'cancelled' status rather than deleting the row: the row is the
-- only evidence that a client ordered and then backed out. Deleting it hides
-- repeat cancellers and silently removes the order from the agent's own day.
--
-- Two behaviours come for free from how the rest of the schema is written and
-- are the reason this status is safe to add:
--   * delivery_contribution() returns zeros for any status it does not
--     recognise, so a cancelled order stops counting toward the client's
--     total_orders and Delivered % without touching that function.
--   * get_client_open_orders() and get_product_stock_summary() both filter
--     positively on status IN ('pending','assigned'), so cancelling drops the
--     order out of "open orders" and releases the stock it was holding.

-- ---------------------------------------------------------------------------
-- 1. Allow the new status
-- ---------------------------------------------------------------------------
-- The constraint is found by name at runtime: hard-coding a name that differs
-- between environments would fail after the DROP and leave the table with no
-- status check at all.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'deliveries'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
    AND pg_get_constraintdef(oid) ILIKE '%pending%'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE deliveries DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE deliveries
    ADD CONSTRAINT deliveries_status_check
    CHECK (status IN ('pending','assigned','picked_up','delivered','nwd','cms','cancelled'));
END $$;

-- Who cancelled, when, and why. Kept on the delivery itself so the reason is
-- visible wherever the order is, not only in the log.
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES profiles(id);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cancel_reason text;

-- ---------------------------------------------------------------------------
-- 2. Field-level change log
-- ---------------------------------------------------------------------------
-- order_modifications already exists but cannot be reused: product_name, qty
-- and unit_price are all NOT NULL there because it models a rider adding a
-- stock item in the field. It has nowhere to put "locality: Mont Ida ->
-- Helvetia". This table records one row per field actually changed.
CREATE TABLE IF NOT EXISTS delivery_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES profiles(id),
  field text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dcl_delivery ON delivery_change_log (delivery_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dcl_changed_by ON delivery_change_log (changed_by, created_at DESC);

ALTER TABLE delivery_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dcl_select ON delivery_change_log;
CREATE POLICY dcl_select ON delivery_change_log FOR SELECT TO authenticated USING (true);

-- Insert only as yourself. An agent cannot write a log entry naming someone
-- else as the author.
DROP POLICY IF EXISTS dcl_insert ON delivery_change_log;
CREATE POLICY dcl_insert ON delivery_change_log FOR INSERT TO authenticated
  WITH CHECK (changed_by = auth.uid());

-- No UPDATE or DELETE policy: an audit trail nobody can rewrite.

-- ---------------------------------------------------------------------------
-- 3. A client's orders, for the agent's search result
-- ---------------------------------------------------------------------------
-- Phone must be matched through normalize_mru_phone(): 127 open rows store
-- contact_1 with spaces, so .eq('contact_1', phone) silently misses them.
CREATE OR REPLACE FUNCTION get_client_orders_for_agent(
  p_phone text,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  products text,
  qty int,
  amount numeric,
  locality text,
  delivery_date date,
  status text,
  created_at timestamptz,
  rider_name text,
  agent_name text,
  cancel_reason text,
  is_editable boolean
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    d.id, d.products, d.qty, d.amount, d.locality, d.delivery_date,
    d.status::text, d.created_at,
    r.name AS rider_name,
    a.name AS agent_name,
    d.cancel_reason,
    -- Cosmetic hint for the UI, not a permission: a delivered or already
    -- cancelled order is finished and editing it would rewrite history.
    (d.status NOT IN ('delivered','cancelled')) AS is_editable
  FROM deliveries d
  LEFT JOIN profiles r ON r.id = d.rider_id
  LEFT JOIN profiles a ON a.id = d.created_by
  WHERE normalize_mru_phone(d.contact_1) = normalize_mru_phone(p_phone)
  ORDER BY
    -- Live orders first, then most recent.
    (d.status IN ('pending','assigned','picked_up')) DESC,
    d.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$$;

GRANT EXECUTE ON FUNCTION get_client_orders_for_agent(text, int) TO authenticated;
