-- Create products inventory table
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  image_url TEXT,
  sku TEXT,
  price NUMERIC(10,2) DEFAULT 0,
  category TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add product_id column to deliveries
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id);

-- Add product mapping type to import_mappings
-- (mapping_type = 'product' maps excel product name -> product id)

-- Seed products from existing delivery product names
INSERT INTO products (name, is_active)
SELECT DISTINCT products, true
FROM deliveries
WHERE products IS NOT NULL AND TRIM(products) != ''
ON CONFLICT (name) DO NOTHING;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_deliveries_product_id ON deliveries(product_id);

-- Backfill product_id in existing deliveries
UPDATE deliveries d
SET product_id = p.id
FROM products p
WHERE d.products = p.name AND d.product_id IS NULL;

-- Create storage bucket for product images (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;
