import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { read, utils } from 'xlsx'

// Large files: allow up to 5 minutes per file
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

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // ---- Parse workbook ----
  let rows: Record<string, unknown>[]
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = read(buf, { cellDates: true })
    // Prefer the MAIN_DEL sheet, fall back to the first sheet
    const sheetName = wb.SheetNames.includes('MAIN_DEL') ? 'MAIN_DEL' : wb.SheetNames[0]
    rows = utils.sheet_to_json(wb.Sheets[sheetName], { defval: null })
  } catch {
    return NextResponse.json({ error: 'Could not parse the Excel file' }, { status: 400 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'The sheet has no data rows' }, { status: 400 })
  }

  // Headers in these sheets have whitespace quirks ("Qty ", " Amt ") — trim keys.
  const normalized = rows.map(r => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) out[k.trim()] = v
    return out
  })

  // ---- Extract order rows ----
  interface OrderRow {
    key: string
    phone: string
    name: string | null
    region: string | null
    status: 'delivered' | 'cms' | 'other'
    amt: number
    qty: number
    date: string | null
  }

  const orderRows: OrderRow[] = []
  let skippedNoPhone = 0
  for (const r of normalized) {
    const phone = normalizePhone(r['Contact #1'])
    if (!phone) { skippedNoPhone++; continue }
    const date = toDateStr(r['Delivery Date']) || toDateStr(r['Entry Date'])
    const rawStatus = String(r['Status'] ?? '').trim().toLowerCase()
    const status = rawStatus === 'delivered' ? 'delivered' : rawStatus === 'cms' ? 'cms' : 'other'
    const amt = parseFloat(String(r['Amt'] ?? '0').replace(/[^0-9.-]/g, '')) || 0
    const qty = parseInt(String(r['Qty'] ?? '0'), 10) || 0
    // INDEX is the natural unique order key; synthesize one when missing
    const rawIndex = r['INDEX'] ? String(r['INDEX']).trim() : ''
    const key = rawIndex || `${phone}|${date || 'nodate'}|${amt}|${qty}`
    orderRows.push({
      key,
      phone,
      name: r['Customer Name'] ? String(r['Customer Name']).trim() : null,
      region: r['Region'] ? String(r['Region']).trim() : null,
      status,
      amt,
      qty,
      date,
    })
  }

  // In-file dedupe (same INDEX appearing twice inside one file)
  const seen = new Set<string>()
  const uniqueRows = orderRows.filter(r => {
    if (seen.has(r.key)) return false
    seen.add(r.key)
    return true
  })

  // ---- Cross-file dedupe via imported_order_keys ----
  // Insert keys with ignoreDuplicates; only rows whose key is NEW get counted.
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

  // ---- Aggregate per client ----
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
      c.sales += r.amt
      c.qty += r.qty
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
    fileName: file.name,
    totalRows: rows.length,
    validRows: orderRows.length,
    skippedNoPhone,
    duplicatesSkipped: uniqueRows.length - freshRows.length + (orderRows.length - uniqueRows.length),
    newOrders: freshRows.length,
    clientsUpserted,
  })
}
