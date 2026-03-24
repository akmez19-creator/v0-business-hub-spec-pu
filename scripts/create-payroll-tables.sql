-- Employee payroll profiles
CREATE TABLE IF NOT EXISTS employee_payroll_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  employee_code text,
  nic text,
  tan text,
  post text DEFAULT 'Officer',
  department text DEFAULT 'Delivery',
  date_joined date,
  tax_category text DEFAULT 'A',
  num_dependents int DEFAULT 0,
  has_bedridden_dependent boolean DEFAULT false,
  bank_account text,
  transport_allowance numeric DEFAULT 0,
  meal_allowance numeric DEFAULT 0,
  other_allowance numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(contractor_id)
);

-- Payslips table
CREATE TABLE IF NOT EXISTS payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  month text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  basic_salary numeric NOT NULL DEFAULT 0,
  transport_allowance numeric DEFAULT 0,
  overtime numeric DEFAULT 0,
  meal_allowance numeric DEFAULT 0,
  other_allowance numeric DEFAULT 0,
  gross_emoluments numeric NOT NULL DEFAULT 0,
  absence_deduction numeric DEFAULT 0,
  employee_csg numeric DEFAULT 0,
  employee_nsf numeric DEFAULT 0,
  paye numeric DEFAULT 0,
  total_deductions numeric DEFAULT 0,
  employer_csg numeric DEFAULT 0,
  employer_nsf numeric DEFAULT 0,
  employer_levy numeric DEFAULT 0,
  employer_prgf numeric DEFAULT 0,
  total_employer numeric DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  advance numeric DEFAULT 0,
  leaves_taken text DEFAULT 'NIL',
  generated_by uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(contractor_id, month)
);

-- RLS
ALTER TABLE employee_payroll_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

-- Admin/manager can do everything
CREATE POLICY "payroll_profiles_admin" ON employee_payroll_profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = (select auth.uid()) AND role IN ('admin','manager'))
  );

CREATE POLICY "payslips_admin" ON payslips
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = (select auth.uid()) AND role IN ('admin','manager'))
  );

-- Contractors can read their own payroll profile
CREATE POLICY "payroll_profiles_own_read" ON employee_payroll_profiles
  FOR SELECT USING (
    contractor_id IN (SELECT id FROM contractors WHERE profile_id = (select auth.uid()))
  );

-- Contractors can read their own payslips
CREATE POLICY "payslips_own_read" ON payslips
  FOR SELECT USING (
    contractor_id IN (SELECT id FROM contractors WHERE profile_id = (select auth.uid()))
  );
