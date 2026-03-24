-- Add juice_policy to riders: controls whether Juice payments go to rider or contractor
ALTER TABLE riders ADD COLUMN IF NOT EXISTS juice_policy TEXT DEFAULT 'rider';

-- Add payment_proof_url to deliveries: stores uploaded screenshot proof for Juice-to-contractor payments
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
