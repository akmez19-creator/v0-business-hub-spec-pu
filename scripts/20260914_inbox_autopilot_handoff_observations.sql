-- Additive metadata ledger. Apply before any activation. Never activate here.
-- Customer bodies, credentials and mutable canonical payloads are not copied.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_handoff_observations (
  event_key text PRIMARY KEY CHECK(event_key ~ '^[a-f0-9]{64}$'),
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  channel text NOT NULL CHECK(channel IN ('messenger','whatsapp')),
  owner_id text NOT NULL CHECK(owner_id ~ '^[0-9]{5,30}$'),
  customer_id text NOT NULL CHECK(customer_id ~ '^[0-9]{5,30}$'),
  source text NOT NULL CHECK(source IN ('meta_messenger','meta_whatsapp')),
  source_event_id text NOT NULL CHECK(length(source_event_id) BETWEEN 1 AND 2048),
  native_message_id text NOT NULL CHECK(length(native_message_id) BETWEEN 1 AND 2048),
  provider_occurred_at timestamptz NOT NULL,
  timestamp_precision text NOT NULL CHECK(timestamp_precision IN ('second','millisecond')),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  evidence_acceptance text NOT NULL CHECK(evidence_acceptance='verified_live_webhook'),
  first_verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((source='meta_messenger')=(channel='messenger'))
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_handoff_observations_pending
  ON public.inbox_autopilot_handoff_observations(business_code,first_verified_at,event_key);
CREATE INDEX IF NOT EXISTS inbox_autopilot_handoff_observations_scope_ring
  ON public.inbox_autopilot_handoff_observations(business_code,channel,owner_id,customer_id,event_key);
ALTER TABLE public.inbox_autopilot_handoff_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_handoff_observations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.inbox_autopilot_handoff_observations TO service_role;
COMMIT;
