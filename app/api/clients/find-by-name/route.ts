import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers so the Chrome extension can call this endpoint
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Names that identify nobody. "Customer Wap" alone covers 81 clients, and a
// bare "." covers 116 - they are import placeholders, not people. Matching on
// one of these would hand the agent a stranger's phone number.
const PLACEHOLDER_NAMES = new Set(['customer wap', 'customer', 'client', 'unknown', 'n/a', 'na', 'test'])

// GET /api/clients/find-by-name?name=Kishan%20Sewsagar
//
// A Facebook chat gives us the client's full name but usually no phone, so the
// order form starts blank even for someone we have served for years. This looks
// them up on the name we already have.
//
// Deliberately NOT fuzzy. 762 full names in the table are shared by more than
// one client ("Jean Claude" x6), so this returns every match and lets the
// extension decide: fill silently only when there is exactly one, otherwise ask.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const name = (searchParams.get('name') || '').trim()

  const adminDb = createAdminClient()

  // Auth: Bearer token (extension) or cookie session (dashboard)
  let authenticated = false
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const { data: { user } } = await adminDb.auth.getUser(authHeader.replace('Bearer ', ''))
    authenticated = !!user
  }
  if (!authenticated) {
    const cookieSupabase = await createClient()
    const { data: { user } } = await cookieSupabase.auth.getUser()
    authenticated = !!user
  }
  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
  }

  // A single word is a first name, and first names collide hard here ("Kevin"
  // x38, "Vishal" x34). Requiring two words keeps the lookup to real full
  // names, where 97.2% resolve to exactly one client.
  const lower = name.toLowerCase()
  if (name.length < 6 || !name.includes(' ') || PLACEHOLDER_NAMES.has(lower)) {
    return NextResponse.json({ matches: [], skipped: true }, { headers: corsHeaders })
  }

  const { data, error } = await adminDb
    .from('clients')
    .select('id, name, phone, region, delivered_orders, total_orders, last_order_date')
    .ilike('name', name)
    .limit(6)

  if (error) {
    return NextResponse.json({ matches: [], error: error.message }, { status: 500, headers: corsHeaders })
  }

  const matches = (data || [])
    .filter((c) => c.phone)
    // Someone we have actually served is the likelier subject of a follow-up,
    // so surface them first when the name is shared.
    .sort((a, b) => (Number(b.delivered_orders) || 0) - (Number(a.delivered_orders) || 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      region: c.region || null,
      deliveredCount: Number(c.delivered_orders) || 0,
      lastOrderDate: c.last_order_date || null,
    }))

  return NextResponse.json({ matches, skipped: false }, { headers: corsHeaders })
}
