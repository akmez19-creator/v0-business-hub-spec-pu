-- Additive staff queue only. No order, canonical-message, customer or config writes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS public.inbox_autopilot_staff_tasks (
  id uuid PRIMARY KEY,
  job_id uuid REFERENCES public.inbox_autopilot_jobs(id),
  job_source text NOT NULL DEFAULT 'meta' CHECK(job_source IN ('meta','green_api')),
  native_job_id uuid,
  business_code text NOT NULL REFERENCES public.inbox_autopilot_config(business_code) CHECK(business_code IN ('MBM','DBM')),
  channel text NOT NULL CHECK(channel IN ('messenger','whatsapp')),
  owner_id text NOT NULL CHECK(owner_id ~ '^[0-9]{5,30}$'),
  customer_id text NOT NULL CHECK(customer_id ~ '^[0-9]{5,30}$'),
  inbound_message_id text NOT NULL CHECK(length(inbound_message_id) BETWEEN 1 AND 2048),
  customer_name text CHECK(length(customer_name)<=200),
  kind text NOT NULL CHECK(kind IN ('customer_issue','exchange_or_change_request','order_ready_for_staff')),
  context_fingerprint text NOT NULL CHECK(context_fingerprint ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=20000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id),
  UNIQUE(business_code,channel,owner_id,customer_id,job_source,inbound_message_id),
  CHECK((job_source='meta' AND job_id IS NOT NULL AND native_job_id IS NULL) OR (job_source='green_api' AND job_id IS NULL AND native_job_id IS NOT NULL AND channel='whatsapp')),
  CHECK((status='open' AND resolved_at IS NULL AND resolved_by IS NULL) OR (status='resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS inbox_autopilot_staff_tasks_open
  ON public.inbox_autopilot_staff_tasks(created_at,id) WHERE status='open';
ALTER TABLE public.inbox_autopilot_staff_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_autopilot_staff_tasks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.inbox_autopilot_staff_tasks TO service_role;
COMMIT;
