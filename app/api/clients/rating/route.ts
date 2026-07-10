import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getBadSeverity } from '@/lib/types'
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

// GET /api/clients/rating?phone=59864326
// Instant rating lookup via the unique phone index — a single indexed point read.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rawPhone = searchParams.get('phone') || ''
  const phone = normalizePhone(rawPhone)

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

  const { data: client } = await adminDb
    .from('clients')
    .select('id, name, phone, region, city, client_status, total_orders, delivered_orders, cms_orders, total_sales, last_order_date')
    .eq('phone', phone)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ found: false, phone, rating: 'new' }, { headers: corsHeaders })
  }

  const rated = (client.delivered_orders || 0) + (client.cms_orders || 0)
  const deliveredPct = rated > 0 ? Math.round(((client.delivered_orders || 0) / rated) * 100) : null

  // For bad clients, grade how bad by the number of failed (CMS) orders
  const badSeverity = client.client_status === 'bad'
    ? getBadSeverity(client.cms_orders || 0)
    : null

  return NextResponse.json({
    found: true,
    phone,
    rating: client.client_status || 'new',
    name: client.name,
    region: client.region || client.city,
    totalOrders: client.total_orders || 0,
    delivered: client.delivered_orders || 0,
    cms: client.cms_orders || 0,
    deliveredPct,
    totalSales: Number(client.total_sales || 0),
    lastOrderDate: client.last_order_date,
    badSeverity,
  }, { headers: corsHeaders })
}
