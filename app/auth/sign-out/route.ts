import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  
  const url = new URL('/auth/login', request.url)
  // Use 303 See Other to force browser to follow redirect as GET
  return NextResponse.redirect(url, { status: 303 })
}
