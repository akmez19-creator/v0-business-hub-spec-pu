import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Handle preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Helper to get user from Authorization header token
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  
  const token = authHeader.replace('Bearer ', '')
  
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return null
  }
  
  return { user, supabase }
}

// GET - Fetch current worktime status
export async function GET(request: NextRequest) {
  try {
    const tokenAuth = await getUserFromToken(request)
    
    if (!tokenAuth) {
      return NextResponse.json({ 
        error: 'Not authenticated' 
      }, { 
        status: 401, 
        headers: corsHeaders 
      })
    }
    
    const { user, supabase } = tokenAuth
    const today = new Date().toISOString().split('T')[0]
    
    // Get today's shift
    const { data: todayShift } = await supabase
      .from('staff_shifts')
      .select('*')
      .eq('staff_id', user.id)
      .eq('staff_type', 'profile')
      .eq('shift_date', today)
      .single()
    
    // Get recent history (last 7 days)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    
    const { data: history } = await supabase
      .from('staff_shifts')
      .select('shift_date, actual_clock_in, actual_clock_out, status')
      .eq('staff_id', user.id)
      .eq('staff_type', 'profile')
      .gte('shift_date', weekAgo.toISOString().split('T')[0])
      .order('shift_date', { ascending: false })
      .limit(7)
    
    const isClockedIn = todayShift?.status === 'in_progress' && todayShift?.actual_clock_in
    const clockInTime = todayShift?.actual_clock_in || null
    
    // Calculate today's hours
    let todayHours = 0
    if (todayShift?.actual_clock_in && todayShift?.actual_clock_out) {
      const start = new Date(todayShift.actual_clock_in)
      const end = new Date(todayShift.actual_clock_out)
      todayHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    }
    
    // Format history
    const formattedHistory = (history || []).map(h => {
      let hours = '0.00'
      if (h.actual_clock_in && h.actual_clock_out) {
        const start = new Date(h.actual_clock_in)
        const end = new Date(h.actual_clock_out)
        hours = ((end.getTime() - start.getTime()) / (1000 * 60 * 60)).toFixed(2)
      }
      return {
        date: new Date(h.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        hours,
        status: h.status
      }
    })
    
    return NextResponse.json({
      isClockedIn,
      clockInTime,
      todayHours,
      history: formattedHistory
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('Worktime GET error:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch worktime data' 
    }, { 
      status: 500, 
      headers: corsHeaders 
    })
  }
}

// POST - Clock in or clock out
export async function POST(request: NextRequest) {
  try {
    const tokenAuth = await getUserFromToken(request)
    
    if (!tokenAuth) {
      return NextResponse.json({ 
        error: 'Not authenticated' 
      }, { 
        status: 401, 
        headers: corsHeaders 
      })
    }
    
    const { user, supabase } = tokenAuth
    const body = await request.json()
    const { action, pin, auto } = body
    
    if (!action || !['clock_in', 'clock_out'].includes(action)) {
      return NextResponse.json({ 
        error: 'Invalid action' 
      }, { 
        status: 400, 
        headers: corsHeaders 
      })
    }
    
    // Auto mode: triggered by login (clock in) or idle detection (clock out).
    // The user already authenticated with email + password, so no PIN is needed.
    if (!auto) {
      // Validate PIN (4 digits)
      if (!pin || !/^\d{4}$/.test(pin)) {
        return NextResponse.json({ 
          error: 'Please enter a valid 4-digit PIN' 
        }, { 
          status: 400, 
          headers: corsHeaders 
        })
      }
      
      // Get user profile and verify PIN
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, clock_pin')
        .eq('id', user.id)
        .single()
      
      if (!profile) {
        return NextResponse.json({ 
          error: 'Profile not found' 
        }, { 
          status: 404, 
          headers: corsHeaders 
        })
      }
      
      // If user has a PIN set, verify it
      if (profile.clock_pin && profile.clock_pin !== pin) {
        return NextResponse.json({ 
          error: 'Invalid PIN' 
        }, { 
          status: 403, 
          headers: corsHeaders 
        })
      }
      
      // If no PIN is set, set it to the provided PIN
      if (!profile.clock_pin) {
        await supabase
          .from('profiles')
          .update({ clock_pin: pin })
          .eq('id', user.id)
      }
    }
    
    const today = new Date().toISOString().split('T')[0]
    const now = new Date().toISOString()
    
    if (action === 'clock_in') {
      // Check if already clocked in
      const { data: existing } = await supabase
        .from('staff_shifts')
        .select('id, status, actual_clock_in')
        .eq('staff_id', user.id)
        .eq('staff_type', 'profile')
        .eq('shift_date', today)
        .single()
      
      if (existing?.status === 'in_progress') {
        // In auto mode (login), already being clocked in is fine - keep the running shift
        if (auto) {
          return NextResponse.json({
            success: true,
            message: 'Already clocked in',
            clockInTime: existing.actual_clock_in
          }, { headers: corsHeaders })
        }
        return NextResponse.json({ 
          error: 'Already clocked in' 
        }, { 
          status: 400, 
          headers: corsHeaders 
        })
      }
      
      if (existing) {
        // Update existing shift
        await supabase
          .from('staff_shifts')
          .update({
            actual_clock_in: now,
            status: 'in_progress',
            updated_at: now
          })
          .eq('id', existing.id)
      } else {
        // Create new shift
        await supabase
          .from('staff_shifts')
          .insert({
            staff_id: user.id,
            staff_type: 'profile',
            shift_date: today,
            actual_clock_in: now,
            status: 'in_progress'
          })
      }
      
      return NextResponse.json({
        success: true,
        message: 'Clocked in successfully',
        clockInTime: now
      }, { headers: corsHeaders })
      
    } else {
      // Clock out
      const { data: shift } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('staff_id', user.id)
        .eq('staff_type', 'profile')
        .eq('shift_date', today)
        .eq('status', 'in_progress')
        .single()
      
      if (!shift) {
        // In auto mode (idle logout), not being clocked in is fine
        if (auto) {
          return NextResponse.json({
            success: true,
            message: 'Not clocked in'
          }, { headers: corsHeaders })
        }
        return NextResponse.json({ 
          error: 'Not currently clocked in' 
        }, { 
          status: 400, 
          headers: corsHeaders 
        })
      }
      
      // Calculate worked hours
      const clockIn = new Date(shift.actual_clock_in)
      const clockOut = new Date()
      const workedHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60)
      
      await supabase
        .from('staff_shifts')
        .update({
          actual_clock_out: now,
          status: 'completed',
          updated_at: now
        })
        .eq('id', shift.id)
      
      return NextResponse.json({
        success: true,
        message: 'Clocked out successfully',
        workedHours: workedHours.toFixed(2)
      }, { headers: corsHeaders })
    }
  } catch (error) {
    console.error('Worktime POST error:', error)
    return NextResponse.json({ 
      error: 'Failed to process request' 
    }, { 
      status: 500, 
      headers: corsHeaders 
    })
  }
}
