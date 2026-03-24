-- Add reply_token column to deliveries for client reply links
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS reply_token TEXT UNIQUE;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS reply_token_created_at TIMESTAMPTZ;

-- Create index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_deliveries_reply_token ON deliveries(reply_token) WHERE reply_token IS NOT NULL;

-- RLS policies for public token-based access
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_by_reply_token' AND tablename = 'deliveries') THEN
    CREATE POLICY public_read_by_reply_token ON deliveries FOR SELECT TO anon USING (reply_token IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_update_by_reply_token' AND tablename = 'deliveries') THEN
    CREATE POLICY public_update_by_reply_token ON deliveries FOR UPDATE TO anon USING (reply_token IS NOT NULL) WITH CHECK (reply_token IS NOT NULL);
  END IF;
END $$;
