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

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('230')) digits = digits.slice(3)
  return digits
}

// Strip a trailing " xN" quantity annotation and take the first product segment.
function firstProductName(products: string | null): string | null {
  if (!products) return null
  const first = products.split(',')[0]?.trim() || ''
  const cleaned = first.replace(/\s*x\d+\s*$/i, '').trim()
  return cleaned || null
}

// GET /api/clients/last-delivered?phone=59864326
// Confirms the client is a genuine past customer (has at least one DELIVERED
// order) so the extension can gate Exchange / Trade In, and returns their most
// recent purchased product to auto-fill the returned item.
//
// Note: imported history is stored as aggregate counts on the clients table
// (delivered_orders), while per-order product rows only exist for orders created
// in-app. So eligibility uses the aggregate, and the product is a best-effort
// hint from the most recent delivery row that has product text.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const phone = normalizePhone(searchParams.get('phone') || '')

  if (phone.length < 7) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400, headers: corsHeaders })
  }

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

  // Eligibility: the client must exist and have at least one delivered order.
  const { data: client } = await adminDb
    .from('clients')
    .select('delivered_orders, total_orders, last_order_date')
    .eq('phone', phone)
    .maybeSingle()

  const deliveredCount = client?.delivered_orders || 0

  if (!client || deliveredCount <= 0) {
    return NextResponse.json(
      { found: false, deliveredCount: 0, lastProduct: null },
      { headers: corsHeaders }
    )
  }

  // Best-effort: most recent in-app order row that carries product text, so we
  // can pre-fill the product the client already has. May be null for clients
  // whose history came purely from an aggregate import.
  let lastProduct: string | null = null
  let lastProductRaw: string | null = null
  const { data: history } = await adminDb.rpc('get_client_order_history', {
    p_phone: phone,
    p_limit: 200,
  })
  if (Array.isArray(history)) {
    const withProduct = history.find((h: { products: string | null }) => firstProductName(h.products))
    if (withProduct) {
      lastProductRaw = withProduct.products
      lastProduct = firstProductName(withProduct.products)
    }
  }

  return NextResponse.json(
    {
      found: true,
      deliveredCount,
      lastProduct,
      lastProductRaw,
      lastOrderDate: client.last_order_date || null,
    },
    { headers: corsHeaders }
  )
}
