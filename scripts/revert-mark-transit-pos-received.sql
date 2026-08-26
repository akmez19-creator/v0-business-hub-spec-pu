-- Undo scripts/mark-transit-pos-received.sql.
--
-- Restores the exact status each purchase order carried before it was closed
-- out to "Received". Only rows that are still 'Received' are touched, so a PO
-- that has been edited by hand since the migration keeps its newer status
-- instead of being silently rolled back.

BEGIN;

UPDATE purchase_orders po
SET status = b.previous_status
FROM po_status_backup_2026_08_22 b
WHERE po.id = b.id
  AND po.status = 'Received';

-- Drop the snapshot only after a successful restore.
DROP TABLE po_status_backup_2026_08_22;

COMMIT;
