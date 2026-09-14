-- Apply with the database owner after review. No existing inbox RLS or grants change.
-- Only channel/version/time are replicated. Never publish the customer/message tables.
-- Supabase: https://supabase.com/docs/guides/realtime/postgres-changes
-- Readiness: https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting
-- Function security: https://supabase.com/docs/guides/database/functions
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ('messenger_messages'), ('messenger_conversations'),
      ('whatsapp_messages'), ('whatsapp_contacts')) AS required(name)
      WHERE pg_catalog.to_regclass('public.' || name) IS NULL) THEN
    RAISE EXCEPTION 'Inbox source tables are missing; no live-event objects were installed';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS inbox_live_private;
REVOKE ALL ON SCHEMA inbox_live_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.inbox_live_events (
  channel text PRIMARY KEY CHECK (channel IN ('messenger', 'whatsapp')),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
-- Refuse to expose an unrelated/pre-existing table with additional columns.
DO $$ BEGIN
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inbox_live_events') <> 3
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'inbox_live_events' AND column_name = 'channel' AND data_type = 'text')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'inbox_live_events' AND column_name = 'version' AND data_type = 'bigint')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'inbox_live_events' AND column_name = 'updated_at' AND data_type = 'timestamp with time zone') THEN
    RAISE EXCEPTION 'Existing inbox_live_events schema differs; inspect before publishing';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.inbox_live_events WHERE channel NOT IN ('messenger','whatsapp')) THEN
    RAISE EXCEPTION 'Existing inbox_live_events contains unexpected rows; inspect before publishing';
  END IF;
END $$;
ALTER TABLE public.inbox_live_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbox_live_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inbox_live_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbox_live_events TO service_role;
DROP POLICY IF EXISTS inbox_live_events_authenticated_read ON public.inbox_live_events;
CREATE POLICY inbox_live_events_authenticated_read ON public.inbox_live_events
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
INSERT INTO public.inbox_live_events(channel) VALUES ('messenger'), ('whatsapp') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION inbox_live_private.record_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE channel_name text;
BEGIN
  -- Read APIs update updated_at even when already read. Ignore that bookkeeping
  -- alone, or event -> transcript refresh -> mark-read would form a feedback loop.
  IF TG_OP = 'UPDATE' AND (pg_catalog.to_jsonb(NEW) - 'updated_at')
      IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'updated_at') THEN RETURN NULL; END IF;
  channel_name := CASE TG_TABLE_NAME
    WHEN 'messenger_messages' THEN 'messenger'
    WHEN 'messenger_conversations' THEN 'messenger'
    WHEN 'whatsapp_messages' THEN 'whatsapp'
    WHEN 'whatsapp_contacts' THEN 'whatsapp'
    ELSE NULL END;
  IF TG_TABLE_SCHEMA <> 'public' OR channel_name IS NULL THEN
    RAISE EXCEPTION 'Unexpected source for inbox live-event trigger';
  END IF;
  INSERT INTO public.inbox_live_events AS live(channel, version, updated_at)
    VALUES(channel_name, 1, pg_catalog.clock_timestamp())
    ON CONFLICT (channel) DO UPDATE
      SET version = live.version + 1, updated_at = pg_catalog.clock_timestamp();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION inbox_live_private.record_change() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE source_name text; BEGIN
  FOREACH source_name IN ARRAY ARRAY['messenger_messages', 'messenger_conversations', 'whatsapp_messages', 'whatsapp_contacts'] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS inbox_live_signal ON public.%I', source_name);
    EXECUTE pg_catalog.format('CREATE TRIGGER inbox_live_signal AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION inbox_live_private.record_change()', source_name);
  END LOOP;
END $$;

-- Do not replace or create a publication, or alter any existing table membership.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inbox_live_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inbox_live_events;
  END IF;
END $$;

-- Read-only readiness RPC: no privileged message access and no client-controlled identifiers.
CREATE OR REPLACE FUNCTION public.inbox_live_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (SELECT pg_catalog.count(*) FROM public.inbox_live_events WHERE channel IN ('messenger','whatsapp')) = 2
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inbox_live_events')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime' AND pubupdate)
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
      JOIN pg_catalog.pg_proc AS function ON function.oid = trigger.tgfoid
      JOIN pg_catalog.pg_namespace AS function_schema ON function_schema.oid = function.pronamespace
      WHERE schema.nspname = 'public'
        AND relation.relname IN ('messenger_messages','messenger_conversations','whatsapp_messages','whatsapp_contacts')
        AND trigger.tgname = 'inbox_live_signal' AND NOT trigger.tgisinternal
        AND trigger.tgenabled IN ('O','A')
        AND function_schema.nspname = 'inbox_live_private'
        AND function.proname = 'record_change' AND function.pronargs = 0) = 4;
$$;
REVOKE ALL ON FUNCTION public.inbox_live_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_live_ready() TO authenticated, service_role;
COMMENT ON TABLE public.inbox_live_events IS 'Akmez inbox invalidation metadata only; no customer, message or business identifiers.';
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback (review and run separately):
-- BEGIN;
-- DROP TRIGGER IF EXISTS inbox_live_signal ON public.messenger_messages;
-- DROP TRIGGER IF EXISTS inbox_live_signal ON public.messenger_conversations;
-- DROP TRIGGER IF EXISTS inbox_live_signal ON public.whatsapp_messages;
-- DROP TRIGGER IF EXISTS inbox_live_signal ON public.whatsapp_contacts;
-- DROP FUNCTION IF EXISTS public.inbox_live_ready();
-- DROP FUNCTION IF EXISTS inbox_live_private.record_change();
-- DROP TABLE IF EXISTS public.inbox_live_events; -- removes only this table from publication
-- DROP SCHEMA IF EXISTS inbox_live_private; -- no CASCADE: preserve any unrelated objects
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
