-- Add warehouse/pickup location columns to contractors table
ALTER TABLE contractors
ADD COLUMN IF NOT EXISTS warehouse_lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS warehouse_lng DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS warehouse_name TEXT DEFAULT 'Warehouse';
