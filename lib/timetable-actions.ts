'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ShiftData {
  staff_id: string
  staff_type: string
  shift_date: string
  scheduled_start: string
  scheduled_end: string
  notes?: string | null
}

interface ScheduleData {
  staff_id: string
  staff_type: string
  schedule: Array<{
    day_of_week: number
    start_time: string | null
    end_time: string | null
    is_off_day: boolean
  }>
}

export async function createShift(data: ShiftData) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  // Check if shift already exists for this staff on this date
  const { data: existing } = await adminDb
    .from('staff_shifts')
    .select('id')
    .eq('staff_id', data.staff_id)
    .eq('staff_type', data.staff_type)
    .eq('shift_date', data.shift_date)
    .single()
  
  if (existing) {
    // Update existing shift
    const { error } = await adminDb
      .from('staff_shifts')
      .update({
        scheduled_start: data.scheduled_start,
        scheduled_end: data.scheduled_end,
        notes: data.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    
    if (error) {
      console.error('Error updating shift:', error)
      return { error: error.message }
    }
  } else {
    // Create new shift
    const { error } = await adminDb
      .from('staff_shifts')
      .insert({
        staff_id: data.staff_id,
        staff_type: data.staff_type,
        shift_date: data.shift_date,
        scheduled_start: data.scheduled_start,
        scheduled_end: data.scheduled_end,
        notes: data.notes,
        status: 'scheduled',
      })
    
    if (error) {
      console.error('Error creating shift:', error)
      return { error: error.message }
    }
  }
  
  revalidatePath('/dashboard/admin/timetable')
  return { success: true }
}

export async function updateSchedule(data: ScheduleData) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  // Delete existing schedules for this staff
  await adminDb
    .from('staff_schedules')
    .delete()
    .eq('staff_id', data.staff_id)
    .eq('staff_type', data.staff_type)
  
  // Insert new schedules
  const scheduleRows = data.schedule.map(s => ({
    staff_id: data.staff_id,
    staff_type: data.staff_type,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    is_off_day: s.is_off_day,
    created_by: user.id,
  }))
  
  const { error } = await adminDb
    .from('staff_schedules')
    .insert(scheduleRows)
  
  if (error) {
    console.error('Error updating schedule:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/timetable')
  return { success: true }
}

export async function clockIn(staffId: string, staffType: string, pin: string) {
  const adminDb = createAdminClient()
  
  // Verify PIN (you can customize this logic)
  // For now, we'll just create the clock-in record
  
  const today = new Date().toISOString().split('T')[0]
  
  // Check if there's a scheduled shift for today
  const { data: shift } = await adminDb
    .from('staff_shifts')
    .select('*')
    .eq('staff_id', staffId)
    .eq('staff_type', staffType)
    .eq('shift_date', today)
    .single()
  
  if (shift) {
    // Update existing shift with clock-in
    const { error } = await adminDb
      .from('staff_shifts')
      .update({
        actual_clock_in: new Date().toISOString(),
        status: 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', shift.id)
    
    if (error) {
      return { error: error.message }
    }
  } else {
    // Create new shift for today
    const { error } = await adminDb
      .from('staff_shifts')
      .insert({
        staff_id: staffId,
        staff_type: staffType,
        shift_date: today,
        actual_clock_in: new Date().toISOString(),
        status: 'in_progress',
      })
    
    if (error) {
      return { error: error.message }
    }
  }
  
  revalidatePath('/dashboard/admin/timetable')
  return { success: true }
}

export async function clockOut(staffId: string, staffType: string) {
  const adminDb = createAdminClient()
  
  const today = new Date().toISOString().split('T')[0]
  
  const { data: shift } = await adminDb
    .from('staff_shifts')
    .select('*')
    .eq('staff_id', staffId)
    .eq('staff_type', staffType)
    .eq('shift_date', today)
    .eq('status', 'in_progress')
    .single()
  
  if (!shift) {
    return { error: 'No active shift found' }
  }
  
  const clockOut = new Date()
  const clockIn = new Date(shift.actual_clock_in)
  const workedMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000)
  
  // Calculate overtime if scheduled times exist
  let overtimeMinutes = 0
  if (shift.scheduled_end) {
    const scheduledEnd = new Date(`${today}T${shift.scheduled_end}`)
    if (clockOut > scheduledEnd) {
      overtimeMinutes = Math.floor((clockOut.getTime() - scheduledEnd.getTime()) / 60000)
    }
  }
  
  const { error } = await adminDb
    .from('staff_shifts')
    .update({
      actual_clock_out: clockOut.toISOString(),
      status: 'completed',
      overtime_minutes: overtimeMinutes,
      updated_at: clockOut.toISOString(),
    })
    .eq('id', shift.id)
  
  if (error) {
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/timetable')
  return { success: true, workedMinutes, overtimeMinutes }
}

export async function createLeaveRequest(data: {
  staff_id: string
  staff_type: string
  leave_type: string
  start_date: string
  end_date: string
  reason?: string
}) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { error } = await adminDb
    .from('staff_leave_requests')
    .insert({
      staff_id: data.staff_id,
      staff_type: data.staff_type,
      leave_type: data.leave_type,
      start_date: data.start_date,
      end_date: data.end_date,
      reason: data.reason,
      status: 'pending',
    })
  
  if (error) {
    console.error('Error creating leave request:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/timetable')
  return { success: true }
}

export async function approveLeaveRequest(id: string, approved: boolean, rejectionReason?: string) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await adminDb
    .from('staff_leave_requests')
    .update({
      status: approved ? 'approved' : 'rejected',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  
  if (error) {
    console.error('Error updating leave request:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/timetable')
  return { success: true }
}
