-- Apply only after both the frozen handoff ledger and GREEN native send table.
-- Add a transport-specific pending reference; never reuse a Meta job UUID.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.inbox_autopilot_handoff_events
  ADD COLUMN potential_green_attempt_id uuid REFERENCES public.inbox_autopilot_green_sends(attempt_id);
DO $migration$
DECLARE old_check text;
BEGIN
  SELECT conname INTO STRICT old_check FROM pg_constraint
    WHERE conrelid='public.inbox_autopilot_handoff_events'::regclass AND contype='c'
      AND pg_get_constraintdef(oid)=
        'CHECK (((disposition <> ''pending_identity''::text) OR ((potential_job_id IS NOT NULL) AND (hold_control_version IS NOT NULL))))';
  EXECUTE format('ALTER TABLE public.inbox_autopilot_handoff_events DROP CONSTRAINT %I',old_check);
END $migration$;
ALTER TABLE public.inbox_autopilot_handoff_events ADD CONSTRAINT inbox_autopilot_handoff_pending_target_check
  CHECK(disposition<>'pending_identity' OR
    (hold_control_version IS NOT NULL AND ((potential_job_id IS NOT NULL)::integer+(potential_green_attempt_id IS NOT NULL)::integer)=1));
ALTER TABLE public.inbox_autopilot_handoff_events ADD CONSTRAINT inbox_autopilot_handoff_green_target_scope_check
  CHECK(potential_green_attempt_id IS NULL OR (source='green_whatsapp' AND channel='whatsapp' AND potential_job_id IS NULL));
CREATE INDEX inbox_autopilot_handoff_green_pending_idx ON public.inbox_autopilot_handoff_events(potential_green_attempt_id)
  WHERE disposition='pending_identity' AND potential_green_attempt_id IS NOT NULL;
COMMIT;
