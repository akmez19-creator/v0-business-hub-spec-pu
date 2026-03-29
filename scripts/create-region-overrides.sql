-- Create table for region coordinate overrides
CREATE TABLE IF NOT EXISTS region_coordinate_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locality TEXT NOT NULL UNIQUE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
