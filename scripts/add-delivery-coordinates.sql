-- Add latitude and longitude columns to deliveries table
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS longitude double precision;

-- Seed known Mauritius region coordinates for existing deliveries
-- These are approximate center points for each region/area
UPDATE deliveries SET latitude = -20.2350, longitude = 57.4787 WHERE region ILIKE '%bagatelle%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.2289, longitude = 57.4672 WHERE region ILIKE '%beau bassin%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.2438, longitude = 57.4900 WHERE region ILIKE '%ebene%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.1655, longitude = 57.5041 WHERE region ILIKE '%grnw%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.1991, longitude = 57.4698 WHERE region ILIKE '%la tour koenig%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.2268, longitude = 57.4738 WHERE region ILIKE '%mont roches%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.2106, longitude = 57.4719 WHERE region ILIKE '%petite rivi%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.1753, longitude = 57.4624 WHERE region ILIKE '%pointe aux sables%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.2480, longitude = 57.5050 WHERE region ILIKE '%roche brun%' AND latitude IS NULL;
UPDATE deliveries SET latitude = -20.2363, longitude = 57.4810 WHERE region ILIKE '%tribecca%' AND latitude IS NULL;

-- Default fallback: Port Louis center for any deliveries without a region match
UPDATE deliveries SET latitude = -20.1609, longitude = 57.5012 WHERE latitude IS NULL;
