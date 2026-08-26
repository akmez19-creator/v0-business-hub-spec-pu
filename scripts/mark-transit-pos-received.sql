-- Close out purchase orders whose goods have already landed in Mauritius.
--
-- WHY
-- The inventory page's "In China" column is computed from PO status, not from
-- any stored quantity. It was reading 5,480 units as sitting in China while the
-- warehouse holds none of it: the orders arrived but nobody moved the status to
-- Received. Soft Puzzle Mats is the clearest case - 900 units on hand, zone Z,
-- counted, and its PO still said "Loaded and Shipped".
--
-- This closes the stale orders so the column reflects reality. It does NOT
-- touch any quantity: products.quantity is the counted shelf stock and stays
-- exactly as it is, and "Initial" (sum of every PO qty) is unchanged because
-- this only rewrites status.
--
-- SCOPE
-- Every status between "Ordered" and "Received" in the workflow, i.e. the
-- stages where goods physically exist and are in transit:
--   Ordered, Payment Done, Shipped to Warehouse, Loaded and Shipped,
--   Partially Loaded and Shipped
-- Deliberately NOT included:
--   Message Sent / Request Discount / Negotiate Shipping - nothing ordered yet,
--     so there are no goods to be in China.
--   pending - 73 legacy imported rows (34,630 units) with no reliable meaning.
--     Marking those Received would invent an arrival that was never recorded.
--
-- REVERSIBILITY
-- The previous status of every affected row is copied to po_status_backup_2026_08_22
-- first. scripts/revert-mark-transit-pos-received.sql restores them exactly.

BEGIN;

-- Snapshot before the write. Fails loudly if run twice rather than silently
-- overwriting the only copy of the original statuses.
CREATE TABLE po_status_backup_2026_08_22 AS
SELECT id, index_no, product_name, status AS previous_status, qty, now() AS backed_up_at
FROM purchase_orders
WHERE status IN (
  'Ordered',
  'Payment Done',
  'Shipped to Warehouse',
  'Loaded and Shipped',
  'Partially Loaded and Shipped'
);

UPDATE purchase_orders
SET status = 'Received'
WHERE status IN (
  'Ordered',
  'Payment Done',
  'Shipped to Warehouse',
  'Loaded and Shipped',
  'Partially Loaded and Shipped'
);

COMMIT;
