-- Apply after 20260914_inbox_autopilot_green_sends.sql. Additive, dormant.
-- Do not insert a release marker or enable a business as part of this migration.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_green_history (
 id uuid PRIMARY KEY, phone_number_id text NOT NULL, wa_id text NOT NULL CHECK(wa_id ~ '^[0-9]{5,20}$'),
 instance_id text NOT NULL, account_id text NOT NULL, binding_version bigint NOT NULL CHECK(binding_version>0),
 account_verified_at timestamptz NOT NULL, fetched_at timestamptz NOT NULL,
 sync_progress integer NOT NULL CHECK(sync_progress=100),
 records jsonb NOT NULL CHECK(jsonb_typeof(records)='array' AND jsonb_array_length(records) BETWEEN 1 AND 99 AND octet_length(records::text)<5242880),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 CHECK(phone_number_id IN ('1090043534186338','968962882975955')),CHECK(account_verified_at<=fetched_at)
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_green_history_latest ON public.inbox_autopilot_green_history(phone_number_id,wa_id,fetched_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_green_enrollments (
 id uuid PRIMARY KEY,business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
 phone_number_id text NOT NULL,wa_id text NOT NULL CHECK(wa_id ~ '^[0-9]{5,20}$'),instance_id text NOT NULL,account_id text NOT NULL,
 binding_version bigint NOT NULL CHECK(binding_version>0),mode text NOT NULL CHECK(mode IN ('new_chat','staff_reviewed','provider_verified')),
 cutoff timestamptz NOT NULL,reviewed_hash text NOT NULL CHECK(reviewed_hash ~ '^[a-f0-9]{64}$'),
 trigger_message_id text NOT NULL CHECK(length(trigger_message_id) BETWEEN 1 AND 300),
 history_id uuid NOT NULL REFERENCES public.inbox_autopilot_green_history(id),
 CHECK((business_code='MBM' AND phone_number_id='1090043534186338') OR (business_code='DBM' AND phone_number_id='968962882975955')),
 UNIQUE(id,phone_number_id,wa_id)
);
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_green_scopes (
 phone_number_id text NOT NULL,wa_id text NOT NULL,enrollment_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(phone_number_id,wa_id),
 FOREIGN KEY(enrollment_id,phone_number_id,wa_id) REFERENCES public.inbox_autopilot_green_enrollments(id,phone_number_id,wa_id)
);
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_green_jobs (
 id uuid PRIMARY KEY,business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code),
 phone_number_id text NOT NULL,wa_id text NOT NULL,instance_id text NOT NULL,chat_id text NOT NULL,
 binding_version bigint NOT NULL CHECK(binding_version>0),enrollment_id uuid NOT NULL REFERENCES public.inbox_autopilot_green_enrollments(id),
 config_version bigint NOT NULL CHECK(config_version>0),control_version bigint NOT NULL DEFAULT 0 CHECK(control_version>=0),inbound_message_id text NOT NULL CHECK(length(inbound_message_id) BETWEEN 1 AND 300),
 inbound_event_key text NOT NULL CHECK(inbound_event_key ~ '^[a-f0-9]{64}$'),context_fingerprint text NOT NULL CHECK(context_fingerprint ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('queued','processing','needs_review','sending','accepted','unknown')),
 lease_token uuid,lease_expires_at timestamptz,attempt_id uuid REFERENCES public.inbox_autopilot_green_sends(attempt_id) DEFERRABLE INITIALLY DEFERRED,
 reservation_day date,reason text CHECK(reason IS NULL OR reason ~ '^[a-z_]{1,100}$'),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(chat_id=wa_id||'@c.us'),
 CHECK((business_code='MBM' AND phone_number_id='1090043534186338') OR (business_code='DBM' AND phone_number_id='968962882975955')),
 UNIQUE(phone_number_id,wa_id,instance_id,inbound_message_id),UNIQUE(attempt_id),
 CHECK((state IN ('sending','accepted','unknown') AND attempt_id IS NOT NULL AND reservation_day IS NOT NULL) OR
   (state IN ('queued','processing','needs_review') AND attempt_id IS NULL AND reservation_day IS NULL))
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_green_jobs_pending ON public.inbox_autopilot_green_jobs(business_code,updated_at,id) WHERE state IN ('queued','processing');
ALTER TABLE public.inbox_autopilot_green_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_green_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_green_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_autopilot_green_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_green_history,public.inbox_autopilot_green_enrollments,public.inbox_autopilot_green_scopes,public.inbox_autopilot_green_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.inbox_autopilot_green_history,public.inbox_autopilot_green_enrollments TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_green_scopes,public.inbox_autopilot_green_jobs TO service_role;
COMMIT;
-- Rollback operation is disable the separate runtime marker and pause business.
-- Retain immutable histories/enrollments and intent ledgers; dropping them removes dedup evidence.
