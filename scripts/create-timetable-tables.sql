-- Staff Timetable/Schedule Tables
-- Run this in your Supabase SQL Editor

-- Staff schedules table - defines working hours for each staff member
CREATE TABLE IF NOT EXISTS staff_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL,
  staff_type TEXT NOT NULL CHECK (staff_type IN ('executive', 'contractor', 'profile')),
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 6=Saturday
  start_time TIME,
  end_time TIME,
  is_off_day BOOLEAN DEFAULT FALSE,
  break_start TIME,
  break_end TIME,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(staff_id, staff_type, day_of_week)
);

-- Staff shifts table - actual worked shifts with clock in/out
CREATE TABLE IF NOT EXISTS staff_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL,
  staff_type TEXT NOT NULL CHECK (staff_type IN ('executive', 'contractor', 'profile')),
  shift_date DATE NOT NULL,
  scheduled_start TIME,
  scheduled_end TIME,
  actual_clock_in TIMESTAMP WITH TIME ZONE,
  actual_clock_out TIMESTAMP WITH TIME ZONE,
  break_duration INTEGER DEFAULT 0, -- in minutes
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'absent', 'late', 'early_leave')),
  overtime_minutes INTEGER DEFAULT 0,
  notes TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Leave/Time-off requests
CREATE TABLE IF NOT EXISTS staff_leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL,
  staff_type TEXT NOT NULL CHECK (staff_type IN ('executive', 'contractor', 'profile')),
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'sick', 'personal', 'unpaid', 'maternity', 'paternity', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shift templates for quick scheduling
CREATE TABLE IF NOT EXISTS shift_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration INTEGER DEFAULT 60, -- in minutes
  color TEXT DEFAULT '#f97316',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default shift templates
INSERT INTO shift_templates (name, start_time, end_time, break_duration, color) VALUES
  ('Morning Shift', '08:00', '16:00', 60, '#10b981'),
  ('Afternoon Shift', '12:00', '20:00', 60, '#f59e0b'),
  ('Evening Shift', '16:00', '00:00', 60, '#8b5cf6'),
  ('Night Shift', '22:00', '06:00', 60, '#6366f1'),
  ('Full Day', '09:00', '18:00', 60, '#f97316'),
  ('Half Day AM', '08:00', '12:00', 0, '#06b6d4'),
  ('Half Day PM', '13:00', '17:00', 0, '#ec4899')
ON CONFLICT DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_staff_schedules_staff ON staff_schedules(staff_id, staff_type);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_date ON staff_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_staff ON staff_shifts(staff_id, staff_type);
CREATE INDEX IF NOT EXISTS idx_staff_leave_dates ON staff_leave_requests(start_date, end_date);

-- Enable RLS
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Allow authenticated users to read
CREATE POLICY "Allow authenticated read schedules" ON staff_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read shifts" ON staff_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read leave" ON staff_leave_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated read templates" ON shift_templates FOR SELECT TO authenticated USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role all schedules" ON staff_schedules FOR ALL TO service_role USING (true);
CREATE POLICY "Allow service role all shifts" ON staff_shifts FOR ALL TO service_role USING (true);
CREATE POLICY "Allow service role all leave" ON staff_leave_requests FOR ALL TO service_role USING (true);
CREATE POLICY "Allow service role all templates" ON shift_templates FOR ALL TO service_role USING (true);
