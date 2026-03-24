-- Add pay_type and monthly_salary columns to contractors table
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'per_delivery',
  ADD COLUMN IF NOT EXISTS monthly_salary numeric DEFAULT 0;

COMMENT ON COLUMN contractors.pay_type IS 'per_delivery or fixed_monthly';
COMMENT ON COLUMN contractors.monthly_salary IS 'Monthly fixed salary when pay_type is fixed_monthly';
