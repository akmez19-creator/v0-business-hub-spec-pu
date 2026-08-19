-- Makes a delivery import REVERSIBLE and lets a whole month be replaced safely.
--
-- Why this is needed (measured on live data, Aug 2026):
--   * deliveries.import_batch_id already existed but was NEVER written - 0 of
--     3,785 August rows had it set, so there was no way to tell which rows came
--     from which spreadsheet, and therefore no undo.
--   * All 192 delivery_imports rows were stuck at status='processing' with
--     successful_rows = 0, because the importer never marked completion. The
--     audit log existed but recorded nothing useful.
--   * One row had delivery_date year 0008 - a silent date mis-parse that a
--     failed import had no way to report.
--
-- Nothing here deletes or rewrites delivery data.

-- 1. Link rows to their import so a batch can be found and undone.
--    Partial index: only imported rows carry the id, so it stays small.
CREATE INDEX IF NOT EXISTS idx_deliveries_import_batch
  ON deliveries (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- Finding "everything in August" is the core query of a month replace.
CREATE INDEX IF NOT EXISTS idx_deliveries_delivery_date
  ON deliveries (delivery_date);

-- 2. Let the import log describe a replace, not just an append.
ALTER TABLE delivery_imports
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'append',
  ADD COLUMN IF NOT EXISTS target_month date,
  ADD COLUMN IF NOT EXISTS archived_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Archive table: a byte-for-byte copy of any delivery row a replace removes.
--    Structured as a full row snapshot in jsonb so it can never drift out of
--    sync with the 77-column deliveries table, and so a restore is exact.
CREATE TABLE IF NOT EXISTS delivery_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL,
  import_id uuid REFERENCES delivery_imports(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT 'replaced',
  delivery_date date,
  snapshot jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid,
  restored_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_delivery_archive_import
  ON delivery_archive (import_id);
CREATE INDEX IF NOT EXISTS idx_delivery_archive_date
  ON delivery_archive (delivery_date);
-- One archived copy per delivery per import, so retrying a failed replace
-- cannot pile up duplicate snapshots of the same row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_archive_unique
  ON delivery_archive (delivery_id, import_id);

-- 4. Guard against the year-0008 class of bug at the DATABASE level, so a
--    mis-parsed date can never be stored again regardless of which code path
--    writes it. Existing bad rows are corrected first or the constraint fails.
UPDATE deliveries
  SET delivery_date = NULL
  WHERE delivery_date IS NOT NULL
    AND (delivery_date < DATE '2020-01-01' OR delivery_date > DATE '2100-01-01');

ALTER TABLE deliveries
  DROP CONSTRAINT IF EXISTS deliveries_delivery_date_plausible;
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_delivery_date_plausible
  CHECK (
    delivery_date IS NULL
    OR (delivery_date >= DATE '2020-01-01' AND delivery_date <= DATE '2100-01-01')
  );

ALTER TABLE delivery_archive ENABLE ROW LEVEL SECURITY;

-- Archive is admin/service-role territory only: it holds customer contact
-- details and amounts copied verbatim from deliveries.
DROP POLICY IF EXISTS "delivery_archive_admin_read" ON delivery_archive;
CREATE POLICY "delivery_archive_admin_read" ON delivery_archive
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'owner', 'manager')
    )
  );
