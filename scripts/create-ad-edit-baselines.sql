-- Cost/client baseline captured when a product's ad is edited today.
-- Lets the dashboard show whether the edit actually improved the cost:
-- baseline (at edit time) vs live cost/client.
CREATE TABLE IF NOT EXISTS ad_edit_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key text NOT NULL,
  baseline_date date NOT NULL,
  -- Cost per client (Rs) when the edit was first detected; NULL = no clients yet
  baseline_cac numeric,
  baseline_spend_rs numeric NOT NULL DEFAULT 0,
  baseline_clients integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One baseline per product per day: the FIRST edit of the day sets it
  UNIQUE (product_key, baseline_date)
);

CREATE INDEX IF NOT EXISTS idx_ad_edit_baselines_date ON ad_edit_baselines (baseline_date);
