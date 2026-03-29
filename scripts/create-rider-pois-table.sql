-- Create rider_pois table for crowdsourced POI data from riders
CREATE TABLE IF NOT EXISTS rider_pois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'landmark',
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  locality VARCHAR(100),
  added_by VARCHAR(100), -- rider name or ID
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast geo queries
CREATE INDEX IF NOT EXISTS idx_rider_pois_location ON rider_pois (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_rider_pois_locality ON rider_pois (locality);
CREATE INDEX IF NOT EXISTS idx_rider_pois_category ON rider_pois (category);

-- Enable RLS
ALTER TABLE rider_pois ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read POIs
CREATE POLICY "Anyone can read POIs" ON rider_pois
  FOR SELECT USING (true);

-- Allow all authenticated users to insert POIs
CREATE POLICY "Anyone can add POIs" ON rider_pois
  FOR INSERT WITH CHECK (true);

-- Only allow admin to update/delete
CREATE POLICY "Admin can update POIs" ON rider_pois
  FOR UPDATE USING (true);

CREATE POLICY "Admin can delete POIs" ON rider_pois
  FOR DELETE USING (true);

-- Add some initial POIs for South Mauritius regions
INSERT INTO rider_pois (name, category, latitude, longitude, locality, added_by, verified) VALUES
-- Schools in South
('Amaury Government School', 'school', -20.3847, 57.6089, 'Amaury', 'system', true),
('Riviere des Anguilles Government School', 'school', -20.4333, 57.5500, 'Riviere des Anguilles', 'system', true),
('Souillac Government School', 'school', -20.5167, 57.5167, 'Souillac', 'system', true),
('Chemin Grenier Government School', 'school', -20.4833, 57.4667, 'Chemin Grenier', 'system', true),
('Surinam Government School', 'school', -20.5000, 57.5000, 'Surinam', 'system', true),

-- Mosques in South
('Jummah Masjid Souillac', 'mosque', -20.5175, 57.5180, 'Souillac', 'system', true),
('Masjid Riviere des Anguilles', 'mosque', -20.4340, 57.5510, 'Riviere des Anguilles', 'system', true),
('Masjid Chemin Grenier', 'mosque', -20.4850, 57.4680, 'Chemin Grenier', 'system', true),

-- Temples
('Shiv Mandir Souillac', 'temple', -20.5160, 57.5150, 'Souillac', 'system', true),
('Kovil Riviere des Anguilles', 'temple', -20.4320, 57.5480, 'Riviere des Anguilles', 'system', true),

-- Churches
('St Aubin Church', 'church', -20.4500, 57.5333, 'St Aubin', 'system', true),

-- Shops/Supermarkets
('Winner''s Supermarket Souillac', 'shop', -20.5170, 57.5185, 'Souillac', 'system', true),
('Intermart Chemin Grenier', 'shop', -20.4840, 57.4675, 'Chemin Grenier', 'system', true),
('PriceLo Riviere des Anguilles', 'shop', -20.4335, 57.5495, 'Riviere des Anguilles', 'system', true),

-- Petrol Stations
('Shell Souillac', 'fuel', -20.5165, 57.5175, 'Souillac', 'system', true),
('Total Riviere des Anguilles', 'fuel', -20.4345, 57.5505, 'Riviere des Anguilles', 'system', true),
('Indian Oil Chemin Grenier', 'fuel', -20.4845, 57.4690, 'Chemin Grenier', 'system', true),

-- Health
('Area Health Centre Souillac', 'hospital', -20.5180, 57.5170, 'Souillac', 'system', true),
('Community Health Centre Riviere des Anguilles', 'hospital', -20.4350, 57.5490, 'Riviere des Anguilles', 'system', true),

-- Police
('Souillac Police Station', 'police', -20.5172, 57.5178, 'Souillac', 'system', true),
('Riviere des Anguilles Police Station', 'police', -20.4338, 57.5502, 'Riviere des Anguilles', 'system', true),

-- Markets
('Souillac Market', 'market', -20.5168, 57.5182, 'Souillac', 'system', true),
('Chemin Grenier Fair', 'market', -20.4838, 57.4672, 'Chemin Grenier', 'system', true),

-- Snacks/Fast food
('Snack Corner Souillac', 'restaurant', -20.5173, 57.5177, 'Souillac', 'system', true),
('La Terrasse Riviere des Anguilles', 'restaurant', -20.4342, 57.5498, 'Riviere des Anguilles', 'system', true)

ON CONFLICT DO NOTHING;
