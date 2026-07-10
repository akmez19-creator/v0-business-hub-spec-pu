import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 300

// Normalize a Mauritian phone to digits only (8 digits, strip leading 230)
function normalizePhone(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  let digits = String(raw).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('230')) digits = digits.slice(3)
  if (digits.length < 7 || digits.length > 8) return ''
  return digits
}

function toDateStr(v: unknown): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  if (y < 2000 || y > 2100) return null
  return d.toISOString().slice(0, 10)
}

// Normalize the SalesType column (SALES, EXCHANGE, TRADE IN, REFUND, DROP OFF, ...)
function normalizeSalesType(raw: unknown): 'sale' | 'exchange' | 'trade_in' | 'refund' | 'drop_off' {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (s.includes('exchange')) return 'exchange'
  if (s.includes('trade')) return 'trade_in'
  if (s.includes('refund') || s.includes('return')) return 'refund'
  if (s.includes('drop')) return 'drop_off'
  return 'sale'
}

interface IncomingRow {
  index?: unknown
  phone?: unknown
  name?: unknown
  region?: unknown
  status?: unknown
  salesType?: unknown
  amt?: unknown
  qty?: unknown
  date?: unknown
}

interface ClientDelta {
  phone: string
  name: string | null
  region: string | null
  orders: number
  delivered: number
  cms: number
  sales: number
  qty: number
  first_date: string | null
  last_date: string | null
}

// Receives a JSON chunk of pre-parsed sheet rows (the browser parses the
// Excel file locally, so huge files never hit the request body size limit).
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: { rows?: IncomingRow[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with rows' }, { status: 400 })
  }
  const incoming = Array.isArray(body.rows) ? body.rows : []
  if (incoming.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  }
  if (incoming.length > 10000) {
    return NextResponse.json({ error: 'Chunk too large: max 10000 rows per request' }, { status: 400 })
  }

  // ---- Validate + normalize (server is the source of truth) ----
  interface OrderRow {
    key: string
    phone: string
    name: string | null
    region: string | null
    status: 'delivered' | 'cms' | 'other'
    salesType: ReturnType<typeof normalizeSalesType>
    amt: number
    qty: number
    date: string | null
  }

  const orderRows: OrderRow[] = []
  let skippedNoPhone = 0
  for (const r of incoming) {
    const phone = normalizePhone(r.phone)
    if (!phone) { skippedNoPhone++; continue }
    const date = toDateStr(r.date)
    const rawStatus = String(r.status ?? '').trim().toLowerCase()
    const status = rawStatus === 'delivered' ? 'delivered' : rawStatus === 'cms' ? 'cms' : 'other'
    const salesType = normalizeSalesType(r.salesType)
    const amt = parseFloat(String(r.amt ?? '0').replace(/[^0-9.-]/g, '')) || 0
    const qty = parseInt(String(r.qty ?? '0'), 10) || 0
    const rawIndex = r.index ? String(r.index).trim() : ''
    const key = rawIndex || `${phone}|${date || 'nodate'}|${amt}|${qty}`
    orderRows.push({
      key,
      phone,
      name: r.name ? String(r.name).trim() : null,
      region: r.region ? String(r.region).trim() : null,
      status,
      salesType,
      amt,
      qty,
      date,
    })
  }

  // In-chunk dedupe (same INDEX appearing twice)
  const seen = new Set<string>()
  const uniqueRows = orderRows.filter(r => {
    if (seen.has(r.key)) return false
    seen.add(r.key)
    return true
  })

  // ---- Cross-file/chunk dedupe via imported_order_keys ----
  const newKeys = new Set<string>()
  const KEY_CHUNK = 5000
  for (let i = 0; i < uniqueRows.length; i += KEY_CHUNK) {
    const chunk = uniqueRows.slice(i, i + KEY_CHUNK)
    const { data, error } = await adminDb
      .from('imported_order_keys')
      .upsert(chunk.map(r => ({ index_key: r.key })), {
        onConflict: 'index_key',
        ignoreDuplicates: true,
      })
      .select('index_key')
    if (error) {
      return NextResponse.json({ error: `Dedupe registry error: ${error.message}` }, { status: 500 })
    }
    for (const d of data || []) newKeys.add(d.index_key)
  }

  const freshRows = uniqueRows.filter(r => newKeys.has(r.key))

  // ---- Aggregate per client (sales-type aware) ----
  // Sale / Exchange / Trade In / Drop Off: delivered revenue counts as sales.
  // Refund: the client got cash back, so the amount is SUBTRACTED from sales
  // (it still counts as a delivered order for reliability rating purposes).
  const byPhone = new Map<string, ClientDelta>()
  for (const r of freshRows) {
    let c = byPhone.get(r.phone)
    if (!c) {
      c = { phone: r.phone, name: null, region: null, orders: 0, delivered: 0, cms: 0, sales: 0, qty: 0, first_date: null, last_date: null }
      byPhone.set(r.phone, c)
    }
    c.orders++
    if (r.status === 'delivered') {
      c.delivered++
      if (r.salesType === 'refund') {
        c.sales -= Math.abs(r.amt)
      } else {
        c.sales += r.amt
        c.qty += r.qty
      }
    } else if (r.status === 'cms') {
      c.cms++
    }
    if (r.name) c.name = r.name
    if (r.region) c.region = r.region
    if (r.date) {
      if (!c.first_date || r.date < c.first_date) c.first_date = r.date
      if (!c.last_date || r.date > c.last_date) c.last_date = r.date
    }
  }

  // ---- Apply deltas via the batched Postgres function ----
  const deltas = Array.from(byPhone.values())
  let clientsUpserted = 0
  const RPC_CHUNK = 2000
  for (let i = 0; i < deltas.length; i += RPC_CHUNK) {
    const chunk = deltas.slice(i, i + RPC_CHUNK)
    const { data, error } = await adminDb.rpc('apply_client_import', { rows: chunk })
    if (error) {
      return NextResponse.json({ error: `Client upsert error: ${error.message}` }, { status: 500 })
    }
    clientsUpserted += (data as { clientsUpserted?: number })?.clientsUpserted || 0
  }

  return NextResponse.json({
    receivedRows: incoming.length,
    validRows: orderRows.length,
    skippedNoPhone,
    duplicatesSkipped: incoming.length - skippedNoPhone - freshRows.length,
    newOrders: freshRows.length,
    clientsUpserted,
  })
}
