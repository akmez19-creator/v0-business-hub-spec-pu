-- Additive receipt ledger only. No existing data/config/controls/jobs are changed.
-- Holds and their receipt must commit together. Never apply this file implicitly.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_handoff_events (
  event_key text PRIMARY KEY CHECK(event_key ~ '^[a-f0-9]{64}$'),
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  channel text NOT NULL CHECK(channel IN ('messenger','whatsapp')),
  owner_id text NOT NULL CHECK(owner_id ~ '^[0-9]{5,30}$'),
  customer_id text NOT NULL CHECK(customer_id ~ '^[0-9]{5,30}$'),
  source text NOT NULL CHECK(source IN ('meta_messenger','meta_whatsapp','green_whatsapp')),
  source_event_id text NOT NULL CHECK(length(source_event_id) BETWEEN 1 AND 2048),
  native_message_id text NOT NULL CHECK(length(native_message_id) BETWEEN 1 AND 2048),
  provider_occurred_at timestamptz NOT NULL,
  timestamp_precision text NOT NULL CHECK(timestamp_precision IN ('second','millisecond')),
  evidence_acceptance text NOT NULL CHECK(evidence_acceptance IN ('verified_live_webhook','verified_recent_green_journal')),
  first_verified_at timestamptz,
  journal_activated_at timestamptz,
  journal_max_age_seconds integer CHECK(journal_max_age_seconds BETWEEN 1 AND 900),
  hold_control_version bigint CHECK(hold_control_version>0),
  temporary_hold boolean NOT NULL DEFAULT false,
  potential_job_id uuid REFERENCES public.inbox_autopilot_jobs(id),
  disposition text NOT NULL CHECK(disposition IN ('received','proven_bot','stale_after_resume','already_held','held','pending_identity')),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  CHECK((source='meta_messenger')=(channel='messenger')),
  CHECK(evidence_acceptance<>'verified_recent_green_journal' OR
    (source='green_whatsapp' AND first_verified_at IS NOT NULL AND journal_activated_at IS NOT NULL AND journal_max_age_seconds IS NOT NULL)),
  CHECK(NOT temporary_hold OR hold_control_version IS NOT NULL),
  CHECK(disposition<>'pending_identity' OR (potential_job_id IS NOT NULL AND hold_control_version IS NOT NULL)),
  CHECK((disposition='received' AND processed_at IS NULL) OR (disposition<>'received' AND processed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_autopilot_handoff_events_reference_idx
  ON public.inbox_autopilot_handoff_events(business_code,channel,owner_id,customer_id,source,source_event_id);
CREATE INDEX IF NOT EXISTS inbox_autopilot_handoff_events_pending_idx
  ON public.inbox_autopilot_handoff_events(received_at,event_key) WHERE disposition='pending_identity';
CREATE INDEX IF NOT EXISTS inbox_autopilot_handoff_events_generation_idx
  ON public.inbox_autopilot_handoff_events(business_code,channel,owner_id,customer_id,hold_control_version);
ALTER TABLE public.inbox_autopilot_handoff_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_handoff_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_handoff_events TO service_role;
COMMIT;
