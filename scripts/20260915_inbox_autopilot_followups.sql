-- Customer follow-up ladder (+30 min / +3 h / +6 h / +24 h after OUR last message, customer silent).
-- Additive and dormant: nothing sends until a business row has enabled=true.
-- One ledger row per (business, chat, anchor message, step) - the UNIQUE key is the only
-- thing standing between a cron overlap and a double message, so it is not optional.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';

-- Separate from inbox_autopilot_config.enabled so the ladder toggles without touching
-- reply autopilot. Daily volume is NOT separate: follow-ups reserve against the existing
-- inbox_autopilot_daily / max_daily_replies budget so total outbound stays bounded.
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_followups_config (
 business_code text PRIMARY KEY CHECK(business_code IN ('MBM','DBM')),
 enabled boolean NOT NULL DEFAULT false,
 max_per_hour integer NOT NULL DEFAULT 20 CHECK(max_per_hour BETWEEN 1 AND 200),
 version bigint NOT NULL DEFAULT 1,
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.inbox_autopilot_followups_config(business_code) VALUES('MBM'),('DBM') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inbox_autopilot_followups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_code text NOT NULL CHECK(business_code IN ('MBM','DBM')),
 channel text NOT NULL CHECK(channel IN ('messenger','whatsapp')),
 owner_id text NOT NULL CHECK(owner_id ~ '^[0-9]{5,32}$'),
 customer_id text NOT NULL CHECK(customer_id ~ '^[0-9]{5,32}$'),
 anchor_message_id text NOT NULL CHECK(length(anchor_message_id) BETWEEN 1 AND 300),
 anchor_at timestamptz NOT NULL,
 step integer NOT NULL CHECK(step BETWEEN 1 AND 4),
 state text NOT NULL CHECK(state IN ('sending','sent','unknown','skipped','failed')),
 reason text CHECK(reason IS NULL OR reason ~ '^[a-z_]{1,100}$'),
 draft_text text CHECK(draft_text IS NULL OR length(draft_text) BETWEEN 1 AND 2000),
 provider_message_id text CHECK(provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 2048),
 due_at timestamptz NOT NULL,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_code,channel,owner_id,customer_id,anchor_message_id,step),
 CHECK(state<>'sent' OR provider_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_followups_chat ON public.inbox_autopilot_followups(business_code,channel,owner_id,customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS inbox_autopilot_followups_recent ON public.inbox_autopilot_followups(business_code,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_autopilot_followups_provider_id ON public.inbox_autopilot_followups(channel,provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.inbox_autopilot_followups_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_followups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_followups_config,public.inbox_autopilot_followups FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_followups_config,public.inbox_autopilot_followups TO service_role;
COMMIT;
-- Rollback: DROP TABLE public.inbox_autopilot_followups, public.inbox_autopilot_followups_config;
