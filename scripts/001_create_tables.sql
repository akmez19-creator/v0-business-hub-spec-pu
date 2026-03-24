-- Business Hub Database Schema
-- Tables: profiles, deliveries, delivery_imports, clients, clients_import_log

-- ======================
-- PROFILES TABLE
-- ======================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'marketing_agent' 
    CHECK (role IN ('admin', 'manager', 'marketing_agent', 'contractor', 'rider')),
  approved BOOLEAN DEFAULT false,
  email_verified BOOLEAN DEFAULT false,
  contractor_id UUID REFERENCES public.profiles(id),
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- Indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_contractor_id ON public.profiles(contractor_id);
CREATE INDEX IF NOT EXISTS idx_profiles_approved ON public.profiles(approved);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "profiles_select_all_for_authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE TO authenticated USING (
    auth.uid() = id OR 
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "profiles_delete_admin_only" ON public.profiles
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ======================
-- DELIVERIES TABLE
-- ======================
CREATE TABLE IF NOT EXISTS public.deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rte TEXT,
  entry_date DATE DEFAULT CURRENT_DATE,
  delivery_date DATE,
  index_no TEXT,
  customer_name TEXT NOT NULL,
  contact_1 TEXT,
  contact_2 TEXT,
  region TEXT,
  qty INTEGER DEFAULT 1,
  products TEXT,
  amount DECIMAL(10,2) DEFAULT 0,
  payment_method TEXT,
  sales_type TEXT,
  notes TEXT,
  medium TEXT,
  rider_id UUID REFERENCES auth.users(id),
  contractor_id UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'pending' 
    CHECK (status IN ('pending', 'assigned', 'picked_up', 'delivered', 'nwd', 'cms')),
  status_updated_at TIMESTAMPTZ,
  rider_fee DECIMAL(10,2) DEFAULT 50,
  rider_paid BOOLEAN DEFAULT false,
  rider_paid_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_notes TEXT,
  import_batch_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for deliveries
CREATE INDEX IF NOT EXISTS idx_deliveries_rider_id ON public.deliveries(rider_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_contractor_id ON public.deliveries(contractor_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON public.deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_delivery_date ON public.deliveries(delivery_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_entry_date ON public.deliveries(entry_date);
CREATE INDEX IF NOT EXISTS idx_deliveries_region ON public.deliveries(region);
CREATE INDEX IF NOT EXISTS idx_deliveries_import_batch_id ON public.deliveries(import_batch_id);

-- Enable RLS on deliveries
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for deliveries
CREATE POLICY "deliveries_select_based_on_role" ON public.deliveries
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (
        p.role IN ('admin', 'manager', 'marketing_agent') OR
        (p.role = 'contractor' AND (deliveries.contractor_id = auth.uid() OR deliveries.rider_id IN (
          SELECT id FROM public.profiles WHERE contractor_id = auth.uid()
        ))) OR
        (p.role = 'rider' AND deliveries.rider_id = auth.uid())
      )
    )
  );

CREATE POLICY "deliveries_insert_manager_plus" ON public.deliveries
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "deliveries_update_based_on_role" ON public.deliveries
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (
        p.role IN ('admin', 'manager') OR
        (p.role = 'contractor' AND (deliveries.contractor_id = auth.uid() OR deliveries.rider_id IN (
          SELECT id FROM public.profiles WHERE contractor_id = auth.uid()
        ))) OR
        (p.role = 'rider' AND deliveries.rider_id = auth.uid())
      )
    )
  );

CREATE POLICY "deliveries_delete_manager_plus" ON public.deliveries
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- ======================
-- DELIVERY_IMPORTS TABLE
-- ======================
CREATE TABLE IF NOT EXISTS public.delivery_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  successful_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  imported_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delivery_imports_imported_by ON public.delivery_imports(imported_by);
CREATE INDEX IF NOT EXISTS idx_delivery_imports_status ON public.delivery_imports(status);

-- Enable RLS on delivery_imports
ALTER TABLE public.delivery_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_imports_select_manager_plus" ON public.delivery_imports
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "delivery_imports_insert_manager_plus" ON public.delivery_imports
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- ======================
-- CLIENTS TABLE
-- ======================
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'website', 'facebook')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_city ON public.clients(city);
CREATE INDEX IF NOT EXISTS idx_clients_created_by ON public.clients(created_by);

-- Enable RLS on clients
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select_marketing_plus" ON public.clients
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'marketing_agent'))
  );

CREATE POLICY "clients_insert_marketing_plus" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'marketing_agent'))
  );

CREATE POLICY "clients_update_marketing_plus" ON public.clients
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'marketing_agent'))
  );

CREATE POLICY "clients_delete_marketing_plus" ON public.clients
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'marketing_agent'))
  );

-- ======================
-- CLIENTS_IMPORT_LOG TABLE
-- ======================
CREATE TABLE IF NOT EXISTS public.clients_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  successful_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  imported_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS on clients_import_log
ALTER TABLE public.clients_import_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_import_log_select_marketing_plus" ON public.clients_import_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'marketing_agent'))
  );

CREATE POLICY "clients_import_log_insert_marketing_plus" ON public.clients_import_log
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'marketing_agent'))
  );

-- ======================
-- TRIGGER FOR NEW USER PROFILE
-- ======================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, approved)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'marketing_agent'),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
