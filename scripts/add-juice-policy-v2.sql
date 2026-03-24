-- Add juice_policy to riders: controls whether Juice payments go to rider or contractor
ALTER TABLE riders ADD COLUMN IF NOT EXISTS juice_policy TEXT DEFAULT 'rider';

-- Add payment_proof_url to deliveries: stores uploaded screenshot proof for Juice-to-contractor payments
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;

-- Create storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload payment proofs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload payment proofs' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated users can upload payment proofs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'payment-proofs');
  END IF;
END $$;

-- Allow anyone to read payment proofs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read payment proofs' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Anyone can read payment proofs"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'payment-proofs');
  END IF;
END $$;
