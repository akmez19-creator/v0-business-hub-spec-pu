-- Add device_type column to contractors table for fullscreen preference
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'apple';

-- Add device_type column to riders table as well for riders who aren't contractors
ALTER TABLE riders ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'apple';

-- Comment explaining values
COMMENT ON COLUMN contractors.device_type IS 'Device type preference: apple or android - affects map fullscreen behavior';
COMMENT ON COLUMN riders.device_type IS 'Device type preference: apple or android - affects map fullscreen behavior';
