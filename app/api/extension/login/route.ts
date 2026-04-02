import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
}

// Handle preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// POST - Login from extension
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ 
        success: false, 
        error: 'Email and password are required' 
      }, { 
        status: 400, 
        headers: corsHeaders 
      })
    }

    // Attempt to sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return NextResponse.json({ 
        success: false, 
        error: error.message || 'Invalid email or password' 
      }, { 
        status: 401, 
        headers: corsHeaders 
      })
    }

    if (!data.user) {
      return NextResponse.json({ 
        success: false, 
        error: 'Login failed' 
      }, { 
        status: 401, 
        headers: corsHeaders 
      })
    }

    // Check if user has permission to use the extension
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, name')
      .eq('id', data.user.id)
      .single()

    if (!profile || !['admin', 'manager', 'marketing_agent', 'marketing_back_office', 'marketing_front_office'].includes(profile.role)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Your account does not have permission to use this extension' 
      }, { 
        status: 403, 
        headers: corsHeaders 
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        name: profile.name,
        role: profile.role
      }
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('Extension login error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Server error during login' 
    }, { 
      status: 500, 
      headers: corsHeaders 
    })
  }
}
