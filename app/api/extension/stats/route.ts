import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Helper to get user from Authorization header token
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.replace('Bearer ', '')
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return { user, supabase }
}

// GET - Agent self-service stats:
//   - Today: total clients handled, working time (first entry -> last entry),
//     average clients per working hour (all based on order creation time)
//   - Search: clients from the last 30 days (ALL agents), filterable by
//     name / phone, grouped into one row per client
export async function GET(request: NextRequest) {
  try {
    const tokenAuth = await getUserFromToken(request)
    if (!tokenAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }
    const { user, supabase } = tokenAuth

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()

    // ---- Today's metrics (this agent, by order creation time) ----
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const { data: todayRows } = await supabase
      .from('deliveries')
      .select('created_at, customer_name, contact_1')
      .eq('created_by', user.id)
      .gte('created_at', startOfDay.toISOString())
      .order('created_at', { ascending: true })

    const rows = todayRows || []

    // Distinct clients = unique contact number (falls back to name when blank)
    const clientKeys = new Set<string>()
    for (const r of rows) {
      const key = (r.contact_1 || r.customer_name || '').trim().toLowerCase()
      if (key) clientKeys.add(key)
    }
    const totalClients = clientKeys.size
    const totalEntries = rows.length

    let workingSeconds = 0
    let firstEntry: string | null = null
    let lastEntry: string | null = null
    if (rows.length > 0) {
      firstEntry = rows[0].created_at || null
      lastEntry = rows[rows.length - 1].created_at || null
      if (firstEntry && lastEntry) {
        workingSeconds = Math.max(0, (new Date(lastEntry).getTime() - new Date(firstEntry).getTime()) / 1000)
      }
    }
    const workingHours = workingSeconds / 3600
    // Avoid divide-by-zero: if all entries within the same instant, treat as the
    // count itself so the figure is still meaningful rather than Infinity.
    const avgClientsPerHour = workingHours > 0 ? totalClients / workingHours : totalClients

    // ---- Last-30-days client search (ALL clients) ----
    // Only query when the agent has actually typed a search term; nothing is
    // shown before a search, so there's no need to hit the DB otherwise.
    interface DeliveryRow {
      id: string
      customer_name: string | null
      contact_1: string | null
      contact_2: string | null
      locality: string | null
      rte: string | null
      products: string | null
      qty: number | null
      amount: number | null
      status: string | null
      sales_type: string | null
      medium: string | null
      ad_id: string | null
      notes: string | null
      return_product: string | null
      entry_date: string | null
      delivery_date: string | null
      reply_token: string | null
      created_at: string
    }
    let searchRows: DeliveryRow[] = []

    if (q) {
      const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      // Match on name or either contact number
      const safe = q.replace(/[%,]/g, ' ')
      const { data } = await supabase
        .from('deliveries')
        .select('id, customer_name, contact_1, contact_2, locality, rte, products, qty, amount, status, sales_type, medium, ad_id, notes, return_product, entry_date, delivery_date, reply_token, created_at')
        .gte('created_at', thirtyAgo.toISOString())
        .or(`customer_name.ilike.%${safe}%,contact_1.ilike.%${safe}%,contact_2.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(300)
      searchRows = (data as DeliveryRow[]) || []
    }

    // Public base URL for the customer-facing /reply/[token] proforma/invoice page
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin

    // Group into one row per client (keyed by contact, else name). Rows arrive
    // newest-first, so the first row seen per client is their latest order: we
    // keep its full detail (+ proforma/invoice link) and list the rest as
    // order history, plus running totals.
    interface OrderLine {
      products: string | null
      qty: number | null
      amount: number | null
      status: string | null
      sales_type: string | null
      delivery_date: string | null
      created_at: string
      link: string | null
    }
    interface ClientRecord {
      customer_name: string
      contact_1: string | null
      contact_2: string | null
      locality: string | null
      rte: string | null
      medium: string | null
      ad_id: string | null
      last_products: string | null
      last_qty: number | null
      last_amount: number | null
      last_status: string | null
      last_sales_type: string | null
      last_notes: string | null
      last_return_product: string | null
      last_delivery_date: string | null
      last_order_at: string
      proforma_url: string | null
      order_count: number
      total_amount: number
      orders: OrderLine[]
    }
    const clientMap = new Map<string, ClientRecord>()

    for (const r of searchRows) {
      const key = (r.contact_1 || r.customer_name || '').trim().toLowerCase()
      if (!key) continue
      const link = r.reply_token ? `${baseUrl}/reply/${r.reply_token}` : null
      const line: OrderLine = {
        products: r.products,
        qty: r.qty,
        amount: r.amount,
        status: r.status,
        sales_type: r.sales_type,
        delivery_date: r.delivery_date,
        created_at: r.created_at,
        link,
      }
      const existing = clientMap.get(key)
      if (existing) {
        existing.order_count += 1
        existing.total_amount += Number(r.amount) || 0
        if (existing.orders.length < 10) existing.orders.push(line)
      } else {
        clientMap.set(key, {
          customer_name: r.customer_name || 'Unnamed',
          contact_1: r.contact_1,
          contact_2: r.contact_2,
          locality: r.locality,
          rte: r.rte,
          medium: r.medium,
          ad_id: r.ad_id,
          last_products: r.products,
          last_qty: r.qty,
          last_amount: r.amount,
          last_status: r.status,
          last_sales_type: r.sales_type,
          last_notes: r.notes,
          last_return_product: r.return_product,
          last_delivery_date: r.delivery_date,
          last_order_at: r.created_at,
          // The latest order's link doubles as proforma (before delivery) or
          // invoice/receipt (once delivered) on the public /reply page.
          proforma_url: link,
          order_count: 1,
          total_amount: Number(r.amount) || 0,
          orders: [line],
        })
      }
    }

    const clients = Array.from(clientMap.values()).slice(0, 100)

    return NextResponse.json({
      authenticated: true,
      today: {
        totalClients,
        totalEntries,
        firstEntry,
        lastEntry,
        workingSeconds,
        avgClientsPerHour: Math.round(avgClientsPerHour * 10) / 10,
      },
      clients,
      searchTerm: q,
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('Stats GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500, headers: corsHeaders })
  }
}
