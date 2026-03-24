-- Add location flagging columns to deliveries
-- location_flagged: true if client pinned location outside their region
-- location_source: how the client provided their location (gps, manual_pin, shared)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS location_flagged BOOLEAN DEFAULT false;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS location_source TEXT;
