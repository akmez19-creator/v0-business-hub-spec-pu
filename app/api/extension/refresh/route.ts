import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// POST - Exchange a refresh token for a new session
export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json()

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: 'Refresh token is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    })

    if (error || !data.session) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Session refresh failed' },
        { status: 401, headers: corsHeaders }
      )
    }

    return NextResponse.json(
      {
        success: true,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
      { headers: corsHeaders }
    )
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request' },
      { status: 400, headers: corsHeaders }
    )
  }
}
