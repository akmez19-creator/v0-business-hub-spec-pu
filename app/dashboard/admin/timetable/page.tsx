import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { TimetableContent } from '@/components/admin/timetable-content'

export default async function TimetablePage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: currentProfile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!currentProfile || !['admin', 'manager'].includes(currentProfile.role)) {
    redirect('/dashboard')
  }
  
  // Get all executives
  const { data: executives } = await adminDb
    .from('executives')
    .select('id, first_name, last_name, position, department, employment_type')
    .eq('status', 'active')
    .order('first_name')
  
  // Get all contractors
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name, phone, is_active')
    .eq('is_active', true)
    .order('name')
  
  // Get all profiles (team members)
  const { data: profiles } = await adminDb
    .from('profiles')
    .select('id, name, email, role')
    .eq('approved', true)
    .order('name')
  
  // Get shift templates
  const { data: shiftTemplates } = await adminDb
    .from('shift_templates')
    .select('*')
    .eq('is_active', true)
    .order('start_time')
  
  // Get current week's shifts
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 6)
  
  const { data: shifts } = await adminDb
    .from('staff_shifts')
    .select('*')
    .gte('shift_date', startOfWeek.toISOString().split('T')[0])
    .lte('shift_date', endOfWeek.toISOString().split('T')[0])
  
  // Get schedules
  const { data: schedules } = await adminDb
    .from('staff_schedules')
    .select('*')
  
  // Get leave requests
  const { data: leaveRequests } = await adminDb
    .from('staff_leave_requests')
    .select('*')
    .gte('end_date', startOfWeek.toISOString().split('T')[0])
  
  return (
    <TimetableContent 
      executives={executives || []} 
      contractors={contractors || []} 
      profiles={profiles || []}
      shiftTemplates={shiftTemplates || []}
      shifts={shifts || []}
      schedules={schedules || []}
      leaveRequests={leaveRequests || []}
    />
  )
}
