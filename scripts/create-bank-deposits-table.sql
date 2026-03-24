-- =====================================================
-- BANK DEPOSITS TABLE
-- Track cash deposited to bank for balance reconciliation
-- =====================================================

CREATE TABLE IF NOT EXISTS bank_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  bank_name TEXT,
  reference_number TEXT,
  notes TEXT,
  deposited_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bank_deposits_date ON bank_deposits(deposit_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_deposited_by ON bank_deposits(deposited_by);

-- Enable RLS
ALTER TABLE bank_deposits ENABLE ROW LEVEL SECURITY;

-- Policies: Admin and storekeeper can manage
CREATE POLICY "Admin and storekeeper can manage bank deposits" ON bank_deposits
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'storekeeper'))
  );
