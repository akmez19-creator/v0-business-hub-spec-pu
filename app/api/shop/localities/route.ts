import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Public: the checkout needs the locality list to build its picker, and the
// order route re-validates whatever comes back anyway.
//
// Runs at request time, not build time. `export const revalidate` made Next
// prerender this route during `next build`, so a slow Supabase (17 Sep, API
// Gateway degraded) failed the whole deployment. One-hour caching now lives
// in the Cache-Control header at the CDN instead.
export const dynamic = 'force-dynamic'

const CACHE_HEADER = 'public, s-maxage=3600, stale-while-revalidate=86400'

export async function GET() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await db
    .from('localities')
    .select('name, district')
    .eq('is_active', true)
    .order('name')

  // Surface the failure instead of returning [] - an empty picker would look
  // like "no localities exist" and silently block every checkout.
  if (error) {
    console.log('[v0] shop localities failed:', error.message)
    return NextResponse.json({ success: false, localities: [] }, { status: 500 })
  }

  return NextResponse.json(
    { success: true, localities: data ?? [] },
    { headers: { 'Cache-Control': CACHE_HEADER } },
  )
}
