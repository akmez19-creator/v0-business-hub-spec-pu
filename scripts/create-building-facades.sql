-- Per-building AI-generated facade textures
CREATE TABLE IF NOT EXISTS building_facades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  geom_hash TEXT UNIQUE NOT NULL,
  center_lng FLOAT NOT NULL,
  center_lat FLOAT NOT NULL,
  name TEXT,
  facade_url TEXT NOT NULL,
  style TEXT DEFAULT 'tropical',
  geometry JSONB,
  height FLOAT DEFAULT 10,
  min_height FLOAT DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_building_facades_geom_hash ON building_facades(geom_hash);
CREATE INDEX IF NOT EXISTS idx_building_facades_center ON building_facades(center_lng, center_lat);

ALTER TABLE building_facades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read facades" ON building_facades FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert facades" ON building_facades FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update own facades" ON building_facades FOR UPDATE USING (auth.uid() = created_by);
