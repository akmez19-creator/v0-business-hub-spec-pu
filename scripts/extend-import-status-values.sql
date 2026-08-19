-- Allow the two statuses the reconciliation flow actually needs.
--
-- delivery_imports.status was constrained to
--   pending | processing | completed | failed
-- but the reconcile routes write:
--   'completed_with_errors'  when some rows failed but the batch still ran
--   'reverted'               when a batch has been undone
--
-- Both were rejected by delivery_imports_status_check. That was NOT harmless:
-- the close-out write is the last step of a commit, so a batch that hit any
-- row-level error could not record its own outcome and stayed stuck at
-- 'processing' forever - the exact failure mode that left 192 historical
-- imports looking like they never finished.
--
-- Caught by an end-to-end revert test, which reported:
--   'marking batch reverted: violates check constraint
--    "delivery_imports_status_check"'
-- while the underlying data restore had already succeeded.

ALTER TABLE delivery_imports
  DROP CONSTRAINT IF EXISTS delivery_imports_status_check;

ALTER TABLE delivery_imports
  ADD CONSTRAINT delivery_imports_status_check
  CHECK (status = ANY (ARRAY[
    'pending',
    'processing',
    'completed',
    'completed_with_errors',
    'failed',
    'reverted'
  ]));
