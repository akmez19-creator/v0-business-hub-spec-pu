-- Executives/Employees table for staff management
CREATE TABLE IF NOT EXISTS executives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Personal Information
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date,
  sex text CHECK (sex IN ('male', 'female', 'other')),
  marital_status text CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed')),
  nationality text DEFAULT 'Mauritian',
  
  -- Contact Information
  email text,
  phone text,
  address text,
  city text,
  
  -- Identification
  nic text UNIQUE,
  tan text,
  passport_number text,
  
  -- Employment Details
  employee_code text UNIQUE,
  department text DEFAULT 'Operations',
  position text DEFAULT 'Executive',
  employment_type text DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  date_joined date DEFAULT CURRENT_DATE,
  date_left date,
  is_active boolean DEFAULT true,
  
  -- Compensation
  pay_type text DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'hourly', 'per_delivery', 'commission')),
  base_salary numeric DEFAULT 0,
  hourly_rate numeric DEFAULT 0,
  commission_rate numeric DEFAULT 0,
  
  -- Banking
  bank_name text,
  bank_account text,
  bank_branch text,
  
  -- Emergency Contact
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  
  -- Photo
  photo_url text,
  
  -- Metadata
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add personal details columns to contractors table
ALTER TABLE contractors 
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS nationality text DEFAULT 'Mauritian',
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS nic text,
  ADD COLUMN IF NOT EXISTS tan text,
  ADD COLUMN IF NOT EXISTS employee_code text,
  ADD COLUMN IF NOT EXISTS department text DEFAULT 'Delivery',
  ADD COLUMN IF NOT EXISTS position text DEFAULT 'Contractor',
  ADD COLUMN IF NOT EXISTS employment_type text DEFAULT 'contract',
  ADD COLUMN IF NOT EXISTS date_joined date,
  ADD COLUMN IF NOT EXISTS date_left date,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_rate numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation text,
  ADD COLUMN IF NOT EXISTS notes text;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_executives_profile_id ON executives(profile_id);
CREATE INDEX IF NOT EXISTS idx_executives_department ON executives(department);
CREATE INDEX IF NOT EXISTS idx_executives_is_active ON executives(is_active);
CREATE INDEX IF NOT EXISTS idx_executives_nic ON executives(nic);
CREATE INDEX IF NOT EXISTS idx_executives_employee_code ON executives(employee_code);

-- Enable RLS
ALTER TABLE executives ENABLE ROW LEVEL SECURITY;

-- Admin/manager can do everything
CREATE POLICY "executives_admin_all" ON executives
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- Executives can view their own record
CREATE POLICY "executives_own_read" ON executives
  FOR SELECT USING (profile_id = auth.uid());
