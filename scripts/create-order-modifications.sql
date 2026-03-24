-- Order Modifications table + deliveries columns for on-the-fly order changes

-- ======================
-- ORDER_MODIFICATIONS TABLE
-- ======================
CREATE TABLE IF NOT EXISTS public.order_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_delivery_id UUID NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  source_delivery_id UUID REFERENCES public.deliveries(id) ON DELETE SET NULL,
  modified_by UUID NOT NULL REFERENCES auth.users(id),
  rider_id UUID REFERENCES auth.users(id),
  contractor_id UUID REFERENCES auth.users(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (reason IN ('client_request', 'nwd_available', 'cms_available', 'stock_available')),
  notes TEXT,
  delivery_date DATE DEFAULT CURRENT_DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_modifications_target ON public.order_modifications(target_delivery_id);
CREATE INDEX IF NOT EXISTS idx_order_modifications_source ON public.order_modifications(source_delivery_id);
CREATE INDEX IF NOT EXISTS idx_order_modifications_rider ON public.order_modifications(rider_id);
CREATE INDEX IF NOT EXISTS idx_order_modifications_contractor ON public.order_modifications(contractor_id);
CREATE INDEX IF NOT EXISTS idx_order_modifications_date ON public.order_modifications(delivery_date);
CREATE INDEX IF NOT EXISTS idx_order_modifications_status ON public.order_modifications(status);

ALTER TABLE public.order_modifications ENABLE ROW LEVEL SECURITY;

-- Riders can insert their own modifications
CREATE POLICY "order_modifications_insert_rider" ON public.order_modifications
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('rider', 'contractor', 'admin', 'manager'))
  );

-- Select: rider sees own, contractor sees their riders', admin sees all
CREATE POLICY "order_modifications_select" ON public.order_modifications
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (
        p.role IN ('admin', 'manager') OR
        (p.role = 'rider' AND order_modifications.rider_id = auth.uid()) OR
        (p.role = 'contractor' AND order_modifications.contractor_id = auth.uid())
      )
    )
  );

-- Update: contractor can approve/reject, admin can do anything
CREATE POLICY "order_modifications_update" ON public.order_modifications
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (
        p.role IN ('admin', 'manager') OR
        (p.role = 'contractor' AND order_modifications.contractor_id = auth.uid())
      )
    )
  );

-- ======================
-- ADD COLUMNS TO DELIVERIES
-- ======================
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10,2);
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS is_modified BOOLEAN DEFAULT false;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS modification_count INTEGER DEFAULT 0;
