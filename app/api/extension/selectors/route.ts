import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

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

// POST - Save selectors (admin only)
export async function POST(request: NextRequest) {
  try {
    const tokenAuth = await getUserFromToken(request)
    
    if (!tokenAuth) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }
    
    const { user, supabase } = tokenAuth
    
    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (profile?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Only admins can update selectors' }, { status: 403, headers: corsHeaders })
    }
    
    const body = await request.json()
    const { selectors } = body
    
    // Upsert the selectors into settings table
    const { error } = await supabase
      .from('settings')
      .upsert({
        key: 'extension_selectors',
        value: selectors,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      })
    
    if (error) {
      console.error('Save selectors error:', error)
      return NextResponse.json({ success: false, error: 'Failed to save selectors' }, { status: 500, headers: corsHeaders })
    }
    
    return NextResponse.json({ success: true, message: 'Selectors saved for all users' }, { headers: corsHeaders })
  } catch (error) {
    console.error('Selectors API error:', error)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500, headers: corsHeaders })
  }
}
