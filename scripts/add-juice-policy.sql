-- Add juice_policy to riders: controls whether Juice payments go to rider or contractor
ALTER TABLE riders ADD COLUMN IF NOT EXISTS juice_policy TEXT DEFAULT 'rider';

-- Add payment_proof_url to deliveries: stores uploaded screenshot proof for Juice-to-contractor payments
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;

-- Create storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload payment proofs
CREATE POLICY IF NOT EXISTS "Authenticated users can upload payment proofs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'payment-proofs');

-- Allow anyone to read payment proofs
CREATE POLICY IF NOT EXISTS "Anyone can read payment proofs"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'payment-proofs');
