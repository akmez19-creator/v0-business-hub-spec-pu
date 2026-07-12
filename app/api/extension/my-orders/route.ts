import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Resolve the extension user from the Bearer token (mirrors /api/extension)
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const refreshToken = request.headers.get('X-Refresh-Token')
  if (!authHeader?.startsWith('Bearer ')) return null

  const accessToken = authHeader.replace('Bearer ', '')
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const anonSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: sessionData, error: sessionError } = await anonSupabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || '',
  })
  if (sessionError || !sessionData.user) {
    const { data: { user }, error } = await adminSupabase.auth.getUser(accessToken)
    if (error || !user) return null
    return { user, supabase: adminSupabase }
  }
  return { user: sessionData.user, supabase: adminSupabase }
}

async function resolveUser(request: NextRequest) {
  const tokenAuth = await getUserFromToken(request)
  if (tokenAuth?.user) return tokenAuth
  // Fallback to cookie auth (e.g. same-origin dashboard testing)
  const cookieSupabase = await createClient()
  const { data: { user } } = await cookieSupabase.auth.getUser()
  if (user) return { user, supabase: cookieSupabase as any }
  return null
}

// An entry can be amended by its creator only while it hasn't entered the
// delivery pipeline: still pending AND not yet assigned to a rider.
function isEditable(d: { status: string | null; rider_id: string | null }) {
  return (d.status === 'pending' || !d.status) && !d.rider_id
}

// GET - list the agent's own recent entries (default: last 7 days)
export async function GET(request: NextRequest) {
  try {
    const auth = await resolveUser(request)
    if (!auth?.user) {
      return NextResponse.json({ authenticated: false, orders: [] }, { headers: corsHeaders })
    }
    const { user, supabase } = auth

    const sinceDays = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 7))
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('deliveries')
      .select('id, customer_name, contact_1, contact_2, locality, products, qty, amount, delivery_date, entry_date, status, rider_id, sales_type, notes, created_at')
      .eq('created_by', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: corsHeaders })
    }

    const orders = (data || []).map((d: { status: string | null; rider_id: string | null }) => ({
      ...d,
      editable: isEditable(d),
    }))

    return NextResponse.json({ authenticated: true, orders }, { headers: corsHeaders })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Server error' }, { status: 500, headers: corsHeaders })
  }
}

// PUT - amend one of the agent's own entries (date + core fields)
export async function PUT(request: NextRequest) {
  try {
    const auth = await resolveUser(request)
    if (!auth?.user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }
    const { user, supabase } = auth

    const body = await request.json()
    const { deliveryId, fields } = body || {}
    if (!deliveryId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ success: false, error: 'Missing deliveryId or fields' }, { status: 400, headers: corsHeaders })
    }

    // Load the current row and verify ownership + editability
    const { data: current, error: loadErr } = await supabase
      .from('deliveries')
      .select('id, created_by, status, rider_id, delivery_date, contact_1, contact_2, locality, products, qty, notes')
      .eq('id', deliveryId)
      .maybeSingle()

    if (loadErr || !current) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404, headers: corsHeaders })
    }
    if (current.created_by !== user.id) {
      return NextResponse.json({ success: false, error: 'You can only amend orders you created' }, { status: 403, headers: corsHeaders })
    }
    if (!isEditable(current)) {
      return NextResponse.json({
        success: false,
        error: 'This order can no longer be amended (it has been assigned or dispatched). Please ask a manager.',
      }, { status: 409, headers: corsHeaders })
    }

    // Build the update from only the allowed fields, diffing against current
    const updateData: Record<string, unknown> = {}
    const changes: Record<string, { from: unknown; to: unknown }> = {}

    const setIfChanged = (col: string, rawNext: unknown, normalize?: (v: unknown) => unknown) => {
      const next = normalize ? normalize(rawNext) : rawNext
      const prev = (current as Record<string, unknown>)[col] ?? null
      const nextVal = next ?? null
      if (String(prev) !== String(nextVal)) {
        updateData[col] = nextVal
        changes[col] = { from: prev, to: nextVal }
      }
    }

    const trimOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

    if ('delivery_date' in fields) setIfChanged('delivery_date', fields.delivery_date, (v) => (v ? String(v) : null))
    if ('contact_1' in fields) setIfChanged('contact_1', fields.contact_1, trimOrNull)
    if ('contact_2' in fields) setIfChanged('contact_2', fields.contact_2, trimOrNull)
    if ('products' in fields) setIfChanged('products', fields.products, trimOrNull)
    if ('notes' in fields) setIfChanged('notes', fields.notes, trimOrNull)
    if ('qty' in fields) {
      const q = parseInt(String(fields.qty), 10)
      setIfChanged('qty', q > 0 ? q : 1)
    }

    // Region change also re-stamps route code + contractor/rider from localities
    if ('region' in fields || 'locality' in fields) {
      const rawRegion = (fields.region ?? fields.locality) as string
      const localityName = (rawRegion || '').trim().split('/')[0].trim()
      if (localityName && localityName !== current.locality) {
        const { data: loc } = await supabase
          .from('localities')
          .select('route_code, contractor_id, default_rider_id')
          .ilike('name', localityName)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
        updateData.locality = localityName
        updateData.rte = loc?.route_code || null
        updateData.contractor_id = loc?.contractor_id || null
        // keep unassigned so it stays editable and follows normal assignment flow
        changes.locality = { from: current.locality, to: localityName }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, message: 'No changes', unchanged: true }, { headers: corsHeaders })
    }

    updateData.updated_at = new Date().toISOString()

    const { error: updErr } = await supabase
      .from('deliveries')
      .update(updateData)
      .eq('id', deliveryId)
      // Guard again at write time so a race can't slip past the status gate
      .eq('created_by', user.id)
      .is('rider_id', null)
      .eq('status', 'pending')

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500, headers: corsHeaders })
    }

    // Audit log (best effort - never blocks the amendment)
    const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle()
    await supabase.from('delivery_amendments').insert({
      delivery_id: deliveryId,
      amended_by: user.id,
      amended_by_name: profile?.name || null,
      changes,
      source: 'extension',
    })

    return NextResponse.json({
      success: true,
      message: 'Order updated',
      changedFields: Object.keys(changes),
    }, { headers: corsHeaders })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Server error' }, { status: 500, headers: corsHeaders })
  }
}
