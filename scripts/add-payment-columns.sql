-- Add recipient_id and recipient_type to payment_transactions for direct lookups
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS recipient_id uuid;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS recipient_type text; -- 'contractor' | 'rider'
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payer_type text; -- 'admin' | 'contractor'
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payer_id uuid;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_payment_transactions_recipient ON payment_transactions(recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_wallet ON payment_transactions(wallet_id);

-- Ensure wallets have proper indexes
CREATE INDEX IF NOT EXISTS idx_wallets_owner ON wallets(owner_type, owner_id);
