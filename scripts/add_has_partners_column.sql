-- Add has_partners boolean column to contractors table
-- Defaults to false: contractors must be approved by admin to use partner deliveries
ALTER TABLE contractors ADD COLUMN IF NOT EXISTS has_partners boolean DEFAULT false;
