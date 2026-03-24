-- Add warehouse/pickup location to company_settings (company-wide, admin-managed)
ALTER TABLE public.company_settings
ADD COLUMN IF NOT EXISTS warehouse_name TEXT DEFAULT 'Warehouse',
ADD COLUMN IF NOT EXISTS warehouse_lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS warehouse_lng DOUBLE PRECISION;
