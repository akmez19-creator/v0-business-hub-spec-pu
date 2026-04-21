-- Add clock_pin column to profiles for time tracking authentication
-- This PIN is used when clocking in/out via the extension

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS clock_pin TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN public.profiles.clock_pin IS 'Optional 4-digit PIN for clock in/out authentication via extension';
