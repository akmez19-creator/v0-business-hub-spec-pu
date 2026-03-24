-- =====================================================
-- ACCOUNTING MODULE TABLES
-- =====================================================

-- 1. Add stamp_url to company_settings
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS stamp_url TEXT;

-- 2. Fix riders with same name as contractor - link profile_id
UPDATE riders r
SET profile_id = c.profile_id
FROM contractors c
WHERE r.contractor_id = c.id
AND LOWER(TRIM(r.name)) = LOWER(TRIM(c.name))
AND r.profile_id IS NULL
AND c.profile_id IS NOT NULL;

-- 3. Rider work days (for daily wage attendance tracking)
CREATE TABLE IF NOT EXISTS rider_work_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID REFERENCES riders(id) ON DELETE CASCADE NOT NULL,
  work_date DATE NOT NULL,
  status TEXT DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half_day')),
  hours_worked DECIMAL(4,2), -- optional: track actual hours
  notes TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rider_id, work_date)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_rider_work_days_rider_date ON rider_work_days(rider_id, work_date);
CREATE INDEX IF NOT EXISTS idx_rider_work_days_date ON rider_work_days(work_date);

-- 4. Deductions table
CREATE TABLE IF NOT EXISTS deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deduction_type TEXT NOT NULL CHECK (deduction_type IN ('stock_missing', 'cash_short', 'damage', 'advance', 'other')),
  target_type TEXT NOT NULL CHECK (target_type IN ('contractor', 'rider')),
  target_id UUID NOT NULL,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'reversed')),
  applied_at TIMESTAMPTZ,
  applied_to_type TEXT, -- 'payout' or 'payslip'
  applied_to_id UUID,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES profiles(id),
  reversed_reason TEXT,
  proof_url TEXT,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for deductions
CREATE INDEX IF NOT EXISTS idx_deductions_target ON deductions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_deductions_status ON deductions(status);
CREATE INDEX IF NOT EXISTS idx_deductions_created ON deductions(created_at DESC);

-- 5. Expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_type TEXT NOT NULL CHECK (expense_type IN ('fuel', 'insurance', 'declaration', 'servicing', 'maintenance', 'rental', 'mobile', 'other')),
  category TEXT NOT NULL CHECK (category IN ('vehicle', 'operational')),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('contractor', 'rider')),
  owner_id UUID NOT NULL,
  vehicle_id UUID, -- optional link to vehicles table if exists
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  description TEXT,
  expense_date DATE NOT NULL,
  receipt_url TEXT,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for expenses
CREATE INDEX IF NOT EXISTS idx_expenses_owner ON expenses(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_type ON expenses(expense_type);

-- 6. Receipts table
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT UNIQUE NOT NULL,
  from_party_type TEXT NOT NULL CHECK (from_party_type IN ('admin', 'contractor', 'rider', 'system')),
  from_party_id UUID NOT NULL,
  to_party_type TEXT NOT NULL CHECK (to_party_type IN ('admin', 'contractor', 'rider')),
  to_party_id UUID NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('payment', 'deduction', 'collection', 'stock_return')),
  reference_type TEXT, -- 'payment_transaction', 'deduction', 'cash_collection', etc.
  reference_id UUID,
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for receipts
CREATE INDEX IF NOT EXISTS idx_receipts_number ON receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_receipts_from ON receipts(from_party_type, from_party_id);
CREATE INDEX IF NOT EXISTS idx_receipts_to ON receipts(to_party_type, to_party_id);
CREATE INDEX IF NOT EXISTS idx_receipts_issued ON receipts(issued_at DESC);

-- 7. Cash collections table (for storekeeper)
CREATE TABLE IF NOT EXISTS cash_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE NOT NULL,
  collected_by UUID REFERENCES profiles(id) NOT NULL, -- storekeeper
  expected_amount DECIMAL(10,2) NOT NULL,
  collected_amount DECIMAL(10,2) NOT NULL,
  shortage DECIMAL(10,2) GENERATED ALWAYS AS (expected_amount - collected_amount) STORED,
  collection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  receipt_id UUID REFERENCES receipts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cash collections
CREATE INDEX IF NOT EXISTS idx_cash_collections_contractor ON cash_collections(contractor_id);
CREATE INDEX IF NOT EXISTS idx_cash_collections_date ON cash_collections(collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_collections_collector ON cash_collections(collected_by);

-- 8. Stock transactions table (for storekeeper giving/receiving stock)
CREATE TABLE IF NOT EXISTS stock_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('stock_out', 'stock_in')),
  processed_by UUID REFERENCES profiles(id) NOT NULL, -- storekeeper
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock transaction items (individual products)
CREATE TABLE IF NOT EXISTS stock_transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_transaction_id UUID REFERENCES stock_transactions(id) ON DELETE CASCADE NOT NULL,
  product_id UUID NOT NULL, -- references products table
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for stock transactions
CREATE INDEX IF NOT EXISTS idx_stock_transactions_contractor ON stock_transactions(contractor_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_date ON stock_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transaction_items_tx ON stock_transaction_items(stock_transaction_id);

-- 9. Function to generate receipt number
CREATE OR REPLACE FUNCTION generate_receipt_number()
RETURNS TEXT AS $$
DECLARE
  year_month TEXT;
  seq_num INTEGER;
  new_number TEXT;
BEGIN
  year_month := TO_CHAR(NOW(), 'YYYY-MM');
  
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(receipt_number FROM 'RCP-\d{4}-\d{2}-(\d+)') AS INTEGER)
  ), 0) + 1
  INTO seq_num
  FROM receipts
  WHERE receipt_number LIKE 'RCP-' || year_month || '-%';
  
  new_number := 'RCP-' || year_month || '-' || LPAD(seq_num::TEXT, 4, '0');
  
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- 10. Enable RLS on new tables
ALTER TABLE rider_work_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transaction_items ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies

-- rider_work_days: contractors can manage their riders' attendance
CREATE POLICY "Contractors can view their riders work days" ON rider_work_days
  FOR SELECT USING (
    rider_id IN (
      SELECT r.id FROM riders r
      JOIN contractors c ON r.contractor_id = c.id
      WHERE c.profile_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'storekeeper'))
  );

CREATE POLICY "Contractors can insert their riders work days" ON rider_work_days
  FOR INSERT WITH CHECK (
    rider_id IN (
      SELECT r.id FROM riders r
      JOIN contractors c ON r.contractor_id = c.id
      WHERE c.profile_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Contractors can update their riders work days" ON rider_work_days
  FOR UPDATE USING (
    rider_id IN (
      SELECT r.id FROM riders r
      JOIN contractors c ON r.contractor_id = c.id
      WHERE c.profile_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- deductions: admin can manage, contractors/riders can view their own
CREATE POLICY "Admin can manage deductions" ON deductions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can view their deductions" ON deductions
  FOR SELECT USING (
    (target_type = 'contractor' AND target_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid()))
    OR (target_type = 'rider' AND target_id IN (SELECT id FROM riders WHERE profile_id = auth.uid()))
  );

-- expenses: contractors can manage their own, admin can view all
CREATE POLICY "Contractors can manage their expenses" ON expenses
  FOR ALL USING (
    (owner_type = 'contractor' AND owner_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid()))
    OR (owner_type = 'rider' AND owner_id IN (
      SELECT r.id FROM riders r
      JOIN contractors c ON r.contractor_id = c.id
      WHERE c.profile_id = auth.uid()
    ))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- receipts: parties involved can view
CREATE POLICY "Users can view their receipts" ON receipts
  FOR SELECT USING (
    (from_party_type = 'contractor' AND from_party_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid()))
    OR (to_party_type = 'contractor' AND to_party_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid()))
    OR (from_party_type = 'rider' AND from_party_id IN (SELECT id FROM riders WHERE profile_id = auth.uid()))
    OR (to_party_type = 'rider' AND to_party_id IN (SELECT id FROM riders WHERE profile_id = auth.uid()))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'storekeeper'))
  );

CREATE POLICY "System can insert receipts" ON receipts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contractor', 'storekeeper'))
  );

-- cash_collections: storekeeper and admin can manage, contractors can view their own
CREATE POLICY "Storekeeper and admin can manage cash collections" ON cash_collections
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'storekeeper'))
  );

CREATE POLICY "Contractors can view their cash collections" ON cash_collections
  FOR SELECT USING (
    contractor_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid())
  );

-- stock_transactions: storekeeper and admin can manage, contractors can view their own
CREATE POLICY "Storekeeper and admin can manage stock transactions" ON stock_transactions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'storekeeper'))
  );

CREATE POLICY "Contractors can view their stock transactions" ON stock_transactions
  FOR SELECT USING (
    contractor_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid())
  );

-- stock_transaction_items: same as stock_transactions
CREATE POLICY "Storekeeper and admin can manage stock transaction items" ON stock_transaction_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'storekeeper'))
  );

CREATE POLICY "Contractors can view their stock transaction items" ON stock_transaction_items
  FOR SELECT USING (
    stock_transaction_id IN (
      SELECT id FROM stock_transactions
      WHERE contractor_id IN (SELECT id FROM contractors WHERE profile_id = auth.uid())
    )
  );
