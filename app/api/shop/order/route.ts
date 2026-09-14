import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { priceFor, type QuickOrderProduct } from '@/lib/orders/quick-order'

// Public endpoint (see the publicApiPrefixes note in middleware.ts). It is safe
// to be public because it NEVER trusts a price from the browser: the client
// sends product ids and quantities only, and every amount is recomputed here
// from the database via the same priceFor() the internal order tools use.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string
      phone?: string
      phone2?: string
      locality?: string
      address?: string
      notes?: string
      items?: { id?: string; qty?: number }[]
    }

    const name = String(body.name || '').trim()
    const phone = String(body.phone || '').replace(/\s+/g, '')
    const locality = String(body.locality || '').trim()

    if (!name || name.length < 2) {
      return NextResponse.json({ success: false, error: 'Please enter your name' }, { status: 400 })
    }
    // Mauritian mobiles are 8 digits; landlines 7. Accept both, reject the rest
    // so an unreachable order never enters the delivery run.
    if (!/^\d{7,8}$/.test(phone)) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid 8-digit phone number' },
        { status: 400 },
      )
    }

    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) {
      return NextResponse.json({ success: false, error: 'Your basket is empty' }, { status: 400 })
    }
    if (rawItems.length > 40) {
      return NextResponse.json({ success: false, error: 'Too many items in one order' }, { status: 400 })
    }

    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Aggregate by id BEFORE validating, so 10 lines of the same product cannot
    // slip past a per-line stock check.
    const wanted = new Map<string, number>()
    for (const it of rawItems) {
      const id = String(it?.id || '')
      const qty = Math.floor(Number(it?.qty))
      if (!id || !Number.isFinite(qty) || qty <= 0) continue
      if (qty > 500) {
        return NextResponse.json({ success: false, error: 'Quantity too large' }, { status: 400 })
      }
      wanted.set(id, (wanted.get(id) || 0) + qty)
    }
    if (wanted.size === 0) {
      return NextResponse.json({ success: false, error: 'Your basket is empty' }, { status: 400 })
    }

    // Locality decides the route, the contractor and the rider, exactly as the
    // internal order tools do. An unknown locality is rejected rather than
    // silently creating an unroutable order.
    const { data: loc, error: locErr } = await db
      .from('localities')
      .select('name, route_code, contractor_id, default_rider_id')
      .ilike('name', locality)
      .eq('is_active', true)
      .maybeSingle()
    if (locErr) {
      return NextResponse.json({ success: false, error: 'Could not check your locality' }, { status: 500 })
    }
    if (!loc) {
      return NextResponse.json(
        { success: false, error: 'Please choose your locality from the list' },
        { status: 400 },
      )
    }

    const { data: products, error: prodErr } = await db
      .from('products')
      .select('id, name, price, promo_price, bundle_prices, is_b1g1, quantity, sold_out, is_active')
      .in('id', [...wanted.keys()])
    if (prodErr) {
      return NextResponse.json({ success: false, error: 'Could not load your items' }, { status: 500 })
    }

    // Build one row per product, mirroring app/api/extension/route.ts.
    const nowIso = new Date().toISOString()
    const rows: Record<string, unknown>[] = []
    let total = 0

    for (const [id, qty] of wanted) {
      const p = products?.find((x) => x.id === id)
      if (!p || !p.is_active || p.sold_out) {
        return NextResponse.json(
          { success: false, error: `${p?.name ?? 'An item'} is no longer available` },
          { status: 409 },
        )
      }
      // Re-check stock at submit time: the basket may be minutes old.
      if (Number(p.quantity || 0) < qty) {
        return NextResponse.json(
          { success: false, error: `Only ${Number(p.quantity || 0)} x ${p.name} left in stock` },
          { status: 409 },
        )
      }

      // SERVER-SIDE PRICE. priceFor() is the same helper the internal tools use,
      // so bundle tiers and B1G1 resolve identically - and set-only products
      // (price 0 with tiers) cannot be ordered at "Rs 0".
      const amount = priceFor(p as unknown as QuickOrderProduct, qty)
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { success: false, error: `${p.name} needs a quote - please message us for this one` },
          { status: 409 },
        )
      }
      total += amount

      rows.push({
        customer_name: name,
        contact_1: phone,
        contact_2: String(body.phone2 || '').replace(/\s+/g, '') || null,
        locality: loc.name,
        rte: loc.route_code || null,
        contractor_id: loc.contractor_id || null,
        rider_id: loc.default_rider_id || null,
        assigned_at: loc.contractor_id ? nowIso : null,
        sales_type: 'normal',
        status: 'pending',
        entry_date: nowIso.split('T')[0],
        products: p.name,
        qty,
        amount,
        // WEB distinguishes storefront orders from MBM / DBM page orders
        medium: 'WEB',
        notes: [String(body.address || '').trim(), String(body.notes || '').trim()]
          .filter(Boolean)
          .join(' - ')
          .slice(0, 500) || null,
        // No signed-in user: the customer ordered this themselves. Verified
        // against the live table that NULL is accepted here.
        created_by: null,
        // order_code is INTENTIONALLY omitted - a database trigger generates it
        // (AK-1000897 style). Setting it here would fight the trigger.
      })
    }

    const { data: inserted, error } = await db.from('deliveries').insert(rows).select('order_code')
    if (error) {
      console.log('[v0] shop order insert failed:', error.message)
      return NextResponse.json({ success: false, error: 'Could not place your order' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      total,
      lines: rows.length,
      // All rows of one order share a code; show the customer a single reference
      orderCode: inserted?.[0]?.order_code ?? null,
    })
  } catch (err) {
    console.log('[v0] shop order error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 })
  }
}
