-- Add juice collection columns to deliveries table
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS juice_collected boolean DEFAULT false;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS juice_collected_by uuid REFERENCES profiles(id);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS juice_collected_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS contractor_juice_counted numeric DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS contractor_juice_counted_at timestamptz;

-- Create index for juice collection queries
CREATE INDEX IF NOT EXISTS idx_deliveries_juice_collection 
ON deliveries(status, juice_collected, payment_juice) 
WHERE status = 'delivered' AND juice_collected = false AND payment_juice > 0;
