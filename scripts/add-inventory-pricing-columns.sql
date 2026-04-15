-- Migration: Add new inventory pricing columns to products table
-- Date: 2026-04-15
-- Description: Adds quantity, multiple pricing tiers (SPX2, SPX3, B1G1), and remarks

-- Add quantity column for stock tracking
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 0;

-- Add special pricing tier 2 (e.g., 2-pack or bulk price)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price_spx2 NUMERIC(10, 2) DEFAULT NULL;

-- Add special pricing tier 3 (e.g., 3-pack or larger bulk)
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price_spx3 NUMERIC(10, 2) DEFAULT NULL;

-- Add Buy 1 Get 1 price
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price_b1g1 NUMERIC(10, 2) DEFAULT NULL;

-- Add remarks/notes column
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT NULL;

-- Create index for category filtering (if not exists)
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Create index for stock quantity queries
CREATE INDEX IF NOT EXISTS idx_products_quantity ON products(quantity);

-- Add comment to table describing new structure
COMMENT ON COLUMN products.quantity IS 'Current stock quantity';
COMMENT ON COLUMN products.price_spx2 IS 'Special price tier 2 (e.g., 2-pack bulk price)';
COMMENT ON COLUMN products.price_spx3 IS 'Special price tier 3 (e.g., 3-pack bulk price)';
COMMENT ON COLUMN products.price_b1g1 IS 'Buy 1 Get 1 promotional price';
COMMENT ON COLUMN products.remarks IS 'Additional notes or remarks about the product';
