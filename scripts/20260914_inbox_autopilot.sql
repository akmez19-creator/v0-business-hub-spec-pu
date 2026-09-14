-- Additive only. No canonical message, order, customer, or unread writes.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_config (
  business_code text PRIMARY KEY CHECK (business_code IN ('MBM','DBM')),
  enabled boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  delivery_date date,
  free_delivery boolean NOT NULL DEFAULT true CHECK (free_delivery),
  max_daily_replies integer NOT NULL DEFAULT 30 CHECK (max_daily_replies BETWEEN 1 AND 500),
  enabled_at timestamptz,
  last_run_at timestamptz,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT enabled OR delivery_date IS NOT NULL)
);
INSERT INTO public.inbox_autopilot_config(business_code) VALUES ('MBM'),('DBM') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_controls (
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  channel text NOT NULL CHECK (channel IN ('messenger','whatsapp')),
  owner_id text NOT NULL,
  customer_id text NOT NULL,
  paused boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(business_code,channel,owner_id,customer_id)
);
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_jobs (
  id uuid PRIMARY KEY,
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  channel text NOT NULL CHECK (channel IN ('messenger','whatsapp')),
  owner_id text NOT NULL,
  customer_id text NOT NULL,
  inbound_message_id text NOT NULL CHECK (length(inbound_message_id) BETWEEN 1 AND 2048),
  customer_name text CHECK (length(customer_name)<=200),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','needs_review','sending','sent','failed','unknown')),
  reason text,
  config_version bigint NOT NULL,
  context_fingerprint text NOT NULL CHECK (context_fingerprint ~ '^[a-f0-9]{64}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  send_token uuid UNIQUE,
  send_started_at timestamptz,
  reservation_day date,
  provider_message_id text,
  draft_text text CHECK (length(draft_text)<=4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(business_code,channel,owner_id,customer_id,inbound_message_id),
  CHECK ((send_token IS NULL AND send_started_at IS NULL AND reservation_day IS NULL) OR
    (send_token IS NOT NULL AND send_started_at IS NOT NULL AND reservation_day IS NOT NULL)),
  CHECK (state NOT IN ('sending','sent','unknown') OR send_token IS NOT NULL),
  CHECK (state<>'sent' OR provider_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_jobs_queue ON public.inbox_autopilot_jobs(business_code,state,created_at,id);
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_daily (
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  day date NOT NULL,
  reserved_count integer NOT NULL DEFAULT 0 CHECK (reserved_count>=0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count>=0 AND sent_count<=reserved_count),
  PRIMARY KEY(business_code,day)
);
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_runs (
  request_id uuid PRIMARY KEY,
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  version bigint NOT NULL,
  actor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- New data is available only through authenticated, server-authorized APIs.
ALTER TABLE public.inbox_autopilot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_config,public.inbox_autopilot_controls,public.inbox_autopilot_jobs,public.inbox_autopilot_daily,public.inbox_autopilot_runs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_config,public.inbox_autopilot_controls,public.inbox_autopilot_jobs,public.inbox_autopilot_daily,public.inbox_autopilot_runs TO service_role;
COMMIT;
