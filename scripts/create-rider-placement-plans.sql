-- Saved rider placement plans: a named snapshot of every locality's
-- contractor/rider assignment. Placements change day to day but often
-- repeat a past day's layout, so admins save today's map as a plan and
-- re-apply any saved plan later in one click.
CREATE TABLE IF NOT EXISTS rider_placement_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- snapshot: [{ locality_id, contractor_id, rider_id }]
  assignments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_placement_plans_created_at
  ON rider_placement_plans (created_at DESC);

-- Service-role access only (admin API uses the service key)
ALTER TABLE rider_placement_plans ENABLE ROW LEVEL SECURITY;
