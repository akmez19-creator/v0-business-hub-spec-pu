-- Company Settings table for invoice/business info
CREATE TABLE IF NOT EXISTS public.company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL DEFAULT 'Juice Dash Ltd',
  company_address TEXT DEFAULT '',
  brn TEXT DEFAULT '',
  vat_number TEXT DEFAULT '',
  vat_rate DECIMAL(5,2) DEFAULT 15.00,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed one default row
INSERT INTO public.company_settings (company_name, brn)
VALUES ('Juice Dash Ltd', 'C19167358')
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read (needed for public invoice on reply page)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'company_settings_read_all' AND tablename = 'company_settings') THEN
    CREATE POLICY company_settings_read_all ON public.company_settings FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- Only admin can update
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'company_settings_update_admin' AND tablename = 'company_settings') THEN
    CREATE POLICY company_settings_update_admin ON public.company_settings FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
