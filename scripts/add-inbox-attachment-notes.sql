-- What the AI saw in a customer's Messenger photo/video, cached per attachment
-- URL so redrafts never pay for the same read twice. Additive; safe to re-run.
CREATE TABLE IF NOT EXISTS public.inbox_attachment_notes (
  url_key    text PRIMARY KEY,
  mid        text,
  kind       text NOT NULL,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbox_attachment_notes ENABLE ROW LEVEL SECURITY;
-- Server-only table: read and written with the service role; no client policies.
