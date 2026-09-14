-- Apply after 20260914_inbox_autopilot_green_native_runtime.sql. Additive, dormant.
-- Fair native scheduling ledger: one row per (number, customer, newest inbound).
-- A pass that ends before claim() writes no job row, so without this ledger the
-- same newest customer was re-selected on every worker pass and starved the rest.
-- This table never authorises a send; it only bounds and rotates candidate selection.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_green_passes (
 phone_number_id text NOT NULL,
 wa_id text NOT NULL CHECK(wa_id ~ '^[0-9]{5,20}$'),
 inbound_message_id text NOT NULL CHECK(length(inbound_message_id) BETWEEN 1 AND 300),
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 3),
 last_state text NOT NULL CHECK(last_state ~ '^[a-z_]{1,100}$'),
 last_reason text NOT NULL CHECK(last_reason ~ '^[a-z_]{1,100}$'),
 last_run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 next_eligible_at timestamptz NOT NULL,
 PRIMARY KEY(phone_number_id,wa_id,inbound_message_id),
 CHECK(phone_number_id IN ('1090043534186338','968962882975955')),
 CHECK(next_eligible_at>=last_run_at)
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_green_passes_rotation ON public.inbox_autopilot_green_passes(phone_number_id,last_run_at);
ALTER TABLE public.inbox_autopilot_green_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_green_passes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_green_passes TO service_role;
COMMIT;
-- Rollback: DROP TABLE public.inbox_autopilot_green_passes; selection reverts to newest-first only.
