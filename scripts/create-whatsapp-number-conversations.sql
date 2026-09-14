-- Additive number-scoped WhatsApp state. Existing contact FK anchors and messages are not rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS public.whatsapp_inbox_numbers (
  phone_number_id text PRIMARY KEY,
  display_phone text,
  business_name text NOT NULL DEFAULT 'Unmapped WhatsApp number',
  page_id text,
  waba_id text,
  can_read boolean NOT NULL DEFAULT true,
  can_send boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  phone_number_id text NOT NULL REFERENCES public.whatsapp_inbox_numbers(phone_number_id),
  wa_id text NOT NULL REFERENCES public.whatsapp_contacts(wa_id) ON DELETE CASCADE,
  profile_name text,
  display_phone text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_snippet text,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  unread_state_known boolean NOT NULL DEFAULT true,
  last_read_at timestamptz,
  activity_version bigint NOT NULL DEFAULT 0,
  first_ad_id text,
  first_ad_headline text,
  first_ad_source_url text,
  first_ad_name text,
  first_ad_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone_number_id, wa_id)
);
-- Build the optional existing-message index separately with CONCURRENTLY; never hold its write lock through this backfill.
CREATE INDEX IF NOT EXISTS whatsapp_conversations_activity_idx
  ON public.whatsapp_conversations(last_message_at DESC NULLS LAST, phone_number_id, wa_id);

ALTER TABLE public.whatsapp_inbox_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_inbox_numbers, public.whatsapp_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_inbox_numbers, public.whatsapp_conversations TO service_role;

-- Release short schema/FK locks on the existing contact table before scanning message history.
COMMIT;
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Independently verified current account mappings. Re-running never overwrites later server configuration.
INSERT INTO public.whatsapp_inbox_numbers(phone_number_id,display_phone,business_name,page_id,waba_id,can_send) VALUES
('1090043534186338','+23059406784','Made By Moris','308584892331429','1438616924486229',true),
('968962882975955','+23052500684','Destockage By Moris','471644012696537','1241189547377134',true),
('1136021119603795','+23052507781','Destockage By Moris — historical number','471644012696537','1486190003218741',false),
('1184948841379459','+23052511213','Unmapped WhatsApp number',NULL,NULL,false)
ON CONFLICT (phone_number_id) DO NOTHING;
INSERT INTO public.whatsapp_inbox_numbers(phone_number_id)
SELECT DISTINCT phone_number_id FROM public.whatsapp_messages WHERE phone_number_id IS NOT NULL AND phone_number_id <> ''
ON CONFLICT (phone_number_id) DO NOTHING;

-- Only each message's stored owner establishes its scope. Never infer ownership from the mutable legacy contact phone.
-- Preserve legacy unread only for an unambiguous single-number customer. Otherwise expose uncertainty explicitly.
WITH scopes AS (
  SELECT phone_number_id,wa_id FROM public.whatsapp_messages
  WHERE phone_number_id IS NOT NULL AND phone_number_id <> '' GROUP BY phone_number_id,wa_id
), counts AS (SELECT wa_id,count(*) AS numbers FROM scopes GROUP BY wa_id)
INSERT INTO public.whatsapp_conversations(phone_number_id,wa_id,profile_name,display_phone,
  last_message_at,last_inbound_at,last_snippet,unread_count,unread_state_known,
  first_ad_id,first_ad_headline,first_ad_source_url,first_ad_name,first_ad_at)
SELECT s.phone_number_id,s.wa_id,c.profile_name,n.display_phone,
  latest.created_at,inbound.created_at,CASE WHEN latest.body IS NOT NULL AND latest.body<>'' THEN left(latest.body,200)
    WHEN latest.id IS NOT NULL THEN '['||latest.type||']' ELSE NULL END,
  CASE WHEN counts.numbers=1 AND c.phone_number_id=s.phone_number_id THEN greatest(c.unread_count,0) ELSE 0 END,
  counts.numbers=1 AND c.phone_number_id=s.phone_number_id,
  ad.ad_id,ad.ad_headline,ad.ad_source_url,names.ad_name,ad.created_at
FROM scopes s JOIN public.whatsapp_contacts c USING(wa_id) JOIN counts USING(wa_id)
JOIN public.whatsapp_inbox_numbers n ON n.phone_number_id=s.phone_number_id
LEFT JOIN LATERAL (SELECT id,body,type,created_at FROM public.whatsapp_messages m
  WHERE m.phone_number_id=s.phone_number_id AND m.wa_id=s.wa_id AND m.type<>'external'
    AND NOT(m.direction='out' AND coalesce(m.status,'')='failed')
  ORDER BY created_at DESC,(direction='in') DESC,id DESC LIMIT 1) latest ON true
LEFT JOIN LATERAL (SELECT created_at FROM public.whatsapp_messages m
  WHERE m.phone_number_id=s.phone_number_id AND m.wa_id=s.wa_id AND m.direction='in'
    AND m.type<>'external' AND coalesce(m.raw->>'imported','false')<>'true'
  ORDER BY created_at DESC,id DESC LIMIT 1) inbound ON true
LEFT JOIN LATERAL (SELECT ad_id,ad_headline,ad_source_url,created_at FROM public.whatsapp_messages m
  WHERE m.phone_number_id=s.phone_number_id AND m.wa_id=s.wa_id AND m.direction='in' AND m.ad_id IS NOT NULL
  ORDER BY created_at,id LIMIT 1) ad ON true
LEFT JOIN public.whatsapp_ad_names names ON names.ad_id=ad.ad_id
ON CONFLICT (phone_number_id,wa_id) DO NOTHING;

-- Metadata-only invalidation. No customer identifiers or message content enter Realtime.
CREATE SCHEMA IF NOT EXISTS inbox_live_private;
CREATE OR REPLACE FUNCTION inbox_live_private.whatsapp_number_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'whatsapp_conversations' THEN RAISE EXCEPTION 'Unexpected source'; END IF;
  IF TG_OP='UPDATE' AND (pg_catalog.to_jsonb(NEW)-'updated_at'-'last_read_at')
      IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'updated_at'-'last_read_at') THEN RETURN NULL; END IF;
  INSERT INTO public.inbox_live_events AS live(channel,version,updated_at)
    VALUES('whatsapp',1,pg_catalog.clock_timestamp()) ON CONFLICT(channel) DO UPDATE
    SET version=live.version+1,updated_at=pg_catalog.clock_timestamp();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION inbox_live_private.whatsapp_number_change() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF to_regclass('public.inbox_live_events') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS inbox_live_number_signal ON public.whatsapp_conversations;
    CREATE TRIGGER inbox_live_number_signal AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_conversations
      FOR EACH ROW EXECUTE FUNCTION inbox_live_private.whatsapp_number_change();
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
