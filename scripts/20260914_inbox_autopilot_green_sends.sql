-- Isolated additive ledger only. No activation, transport change or existing
-- message/config/job updates. Never apply automatically.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_green_sends (
  attempt_id uuid PRIMARY KEY,
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
  phone_number_id text NOT NULL CHECK(phone_number_id ~ '^[0-9]{5,30}$'),
  wa_id text NOT NULL CHECK(wa_id ~ '^[0-9]{5,20}$'),
  instance_id text NOT NULL CHECK(instance_id ~ '^[1-9][0-9]{0,19}$'),
  account_id text NOT NULL,
  chat_id text NOT NULL CHECK(chat_id=wa_id||'@c.us'),
  binding_version bigint NOT NULL CHECK(binding_version>0),
  config_version bigint NOT NULL CHECK(config_version>0),
  inbound_message_id text NOT NULL CHECK(length(inbound_message_id) BETWEEN 1 AND 2048),
  inbound_event_key text NOT NULL CHECK(inbound_event_key ~ '^[a-f0-9]{64}$'),
  context_fingerprint text NOT NULL CHECK(context_fingerprint ~ '^[a-f0-9]{64}$'),
  reply_text text NOT NULL CHECK(length(btrim(reply_text))>0 AND length(reply_text)<=4000 AND octet_length(reply_text)<=16000),
  request_token uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('sending','accepted','unknown')),
  provider_message_id text CHECK(length(provider_message_id) BETWEEN 1 AND 2048),
  reason text CHECK(reason IN ('provider_outcome_unknown')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((business_code='MBM' AND phone_number_id='1090043534186338') OR (business_code='DBM' AND phone_number_id='968962882975955')),
  CHECK((state='accepted' AND provider_message_id IS NOT NULL AND accepted_at IS NOT NULL) OR
    (state IN ('sending','unknown') AND provider_message_id IS NULL AND accepted_at IS NULL)),
  UNIQUE(business_code,phone_number_id,wa_id,instance_id,inbound_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_autopilot_green_sends_native_id
  ON public.inbox_autopilot_green_sends(phone_number_id,instance_id,chat_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_autopilot_green_sends_uncertain
  ON public.inbox_autopilot_green_sends(phone_number_id,wa_id) WHERE state IN ('sending','unknown');
CREATE INDEX IF NOT EXISTS inbox_autopilot_green_sends_instance_window
  ON public.inbox_autopilot_green_sends(phone_number_id,instance_id,started_at DESC);
ALTER TABLE public.inbox_autopilot_green_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_green_sends FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_green_sends TO service_role;
COMMIT;
-- Do not delete this ledger after use: that would erase send deduplication and
-- could allow a duplicate reply. Rollback means leave integration disabled and
-- retain the ledger. No reset/retry or destructive rollback is supplied.
