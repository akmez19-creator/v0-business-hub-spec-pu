-- Add missing columns for storekeeper cash collection if they don't exist

-- payment_cash column (for cash payments)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_cash DECIMAL(10,2) DEFAULT 0;

-- payment_bank column (for bank/paid payments)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_bank DECIMAL(10,2) DEFAULT 0;

-- payment_juice column (for juice payments)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_juice DECIMAL(10,2) DEFAULT 0;

-- cash_collected flag
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cash_collected BOOLEAN DEFAULT false;

-- cash_collected_at timestamp
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cash_collected_at TIMESTAMPTZ;

-- cash_collected_by user id
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS cash_collected_by UUID REFERENCES auth.users(id);

-- stock_verified flag
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS stock_verified BOOLEAN DEFAULT false;

-- stock_verified_at timestamp  
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS stock_verified_at TIMESTAMPTZ;

-- stock_verified_by user id
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS stock_verified_by UUID REFERENCES auth.users(id);

-- Create indexes for storekeeper queries
CREATE INDEX IF NOT EXISTS idx_deliveries_cash_collected ON deliveries(cash_collected) WHERE status = 'delivered';
CREATE INDEX IF NOT EXISTS idx_deliveries_stock_verified ON deliveries(stock_verified) WHERE status = 'cms';

-- Update existing 'delivered' records: 
-- If payment_method is 'cash' and payment_cash is 0, copy amount to payment_cash
UPDATE deliveries 
SET payment_cash = amount 
WHERE status = 'delivered' 
  AND payment_method = 'cash' 
  AND (payment_cash IS NULL OR payment_cash = 0)
  AND amount > 0;

-- If payment_method is 'paid', 'bank', or 'already_paid' and payment_bank is 0, copy amount to payment_bank
UPDATE deliveries 
SET payment_bank = amount 
WHERE status = 'delivered' 
  AND payment_method IN ('paid', 'bank', 'already_paid')
  AND (payment_bank IS NULL OR payment_bank = 0)
  AND amount > 0;

-- If payment_method is 'juice' or 'juice_to_rider' and payment_juice is 0, copy amount to payment_juice
UPDATE deliveries 
SET payment_juice = amount 
WHERE status = 'delivered' 
  AND payment_method IN ('juice', 'juice_to_rider')
  AND (payment_juice IS NULL OR payment_juice = 0)
  AND amount > 0;

-- Normalize old payment method values to new ones
UPDATE deliveries SET payment_method = 'juice' WHERE payment_method = 'juice_to_rider';
UPDATE deliveries SET payment_method = 'paid' WHERE payment_method IN ('bank', 'already_paid');

-- Report what was updated
SELECT 
  'Delivered with cash payments' as type,
  COUNT(*) as count,
  SUM(payment_cash) as total_cash
FROM deliveries 
WHERE status = 'delivered' AND payment_cash > 0;
