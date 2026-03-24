import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { type EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/dashboard'

  const supabase = await createClient()
  let authError = null

  // Handle PKCE flow (OAuth, magic link with PKCE)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authError = error
  }
  // Handle email confirmation flow (signup confirmation, password recovery)
  else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    authError = error
  }

  // If no error, handle successful authentication
  if (!authError) {
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // Update email_verified status
      await supabase
        .from('profiles')
        .update({ email_verified: true })
        .eq('id', user.id)
      
      // Get user role to determine redirect
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, approved')
        .eq('id', user.id)
        .single()
      
      if (profile) {
        // Role-based redirect per specification
        if (profile.role === 'contractor') {
          return NextResponse.redirect(`${origin}/dashboard/contractors`)
        } else if (profile.role === 'rider') {
          return NextResponse.redirect(`${origin}/dashboard/riders`)
        } else if (profile.role === 'storekeeper') {
          return NextResponse.redirect(`${origin}/dashboard/storekeeper`)
        }
      }
    }
    
    // Default redirect for admin/manager/marketing_agent
    return NextResponse.redirect(`${origin}${next}`)
  }

  // Return the user to an error page with the error details
  return NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent(authError?.message || 'Could not authenticate user')}`)
}
