/**
 * Change an order that already exists, from the inbox, as the reply goes out.
 *
 * This is NOT the extension's PATCH. Two rules there are wrong for this case:
 *
 * 1. PATCH allows edits only by `created_by = the signed-in user`. Open orders
 *    are spread over several agents (measured 18 Sep: 179 open future orders,
 *    5 distinct creators), and the agent answering the customer is usually not
 *    the one who typed the order. Authorisation here is the CUSTOMER instead:
 *    the row must carry the phone number of the thread being answered.
 * 2. PATCH writes `locality` and `delivery_date` as plain text. Both of those
 *    drive the rider: the route code and contractor come from the locality, and
 *    a validated day plan can override the rider for a given day. Writing them
 *    raw leaves the order routed to the OLD address's rider. This route
 *    re-resolves routing exactly the way order creation does.
 *
 * Add-ons ride with their root order (`parent_delivery_id`): they are the same
 * drop, so a date or locality change moves them too.
 */

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { priceFor, type QuickOrderProduct } from '@/lib/orders/quick-order'

const ORDER_ROLES = ['admin', 'manager', 'marketing_agent', 'marketing_back_office', 'marketing_front_office']

/** Mauritian mobile reduced to its comparable digits (drops a +230 prefix). */
const localDigits = (value: unknown) => String(value || '').replace(/\D/g, '').replace(/^230(?=\d{8}$)/, '')

type Body = {
  id?: string
  /** The phone of the thread being answered - proves the order is this customer's. */
  contact1?: string
  deliveryDate?: string
  qty?: number
  region?: string
  products?: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !ORDER_ROLES.includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Not authorized to change orders' }, { status: 403 })
    }

    const body = (await request.json()) as Body
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : ''
    if (!id) return NextResponse.json({ success: false, error: 'Missing order id' }, { status: 400 })

    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: order } = await admin
      .from('deliveries')
      .select('id, status, contact_1, contact_2, delivery_date, locality, products, qty, amount, sales_type, parent_delivery_id')
      .eq('id', id)
      .maybeSingle()
    if (!order) return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })

    // The customer, not the author, is what makes this edit allowed.
    const thread = localDigits(body.contact1)
    if (!thread || ![order.contact_1, order.contact_2].some((c) => c && localDigits(c) === thread)) {
      return NextResponse.json(
        { success: false, error: 'That order is not on this customer\'s number, so it cannot be changed from this chat.' },
        { status: 403 },
      )
    }
    if (!['pending', 'assigned'].includes(order.status || 'pending')) {
      return NextResponse.json(
        { success: false, error: `This order is already ${order.status || 'processed'} and can no longer be changed. Tell the customer before promising anything.` },
        { status: 409 },
      )
    }

    const updates: Record<string, unknown> = {}
    /** Date and locality belong to the whole drop, so add-ons follow. */
    const dropUpdates: Record<string, unknown> = {}
    const changed: string[] = []

    // --- Delivery date -----------------------------------------------------
    let deliveryDate = order.delivery_date as string | null
    if (typeof body.deliveryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.deliveryDate) && body.deliveryDate !== (order.delivery_date || '').slice(0, 10)) {
      const { data: settings } = await admin.from('extension_settings').select('holidays').eq('id', 1).single()
      const holidays: Array<{ start: string; end: string; label?: string }> = Array.isArray(settings?.holidays) ? settings.holidays : []
      const day = new Date(body.deliveryDate + 'T00:00:00Z')
      const holiday = holidays.find((h) => h.start && body.deliveryDate! >= h.start && body.deliveryDate! <= (h.end || h.start))
      if (day.getUTCDay() === 0 || holiday) {
        // Same rule as creation: a day the agent chose is refused with the
        // reason, never moved behind their back after it was promised.
        const reason = day.getUTCDay() === 0 ? 'a Sunday' : holiday?.label ? `a holiday (${holiday.label})` : 'a closed day'
        return NextResponse.json(
          { success: false, error: `${body.deliveryDate} is ${reason} - no deliveries that day. Pick another date before promising it.` },
          { status: 409 },
        )
      }
      deliveryDate = body.deliveryDate
      dropUpdates.delivery_date = body.deliveryDate
      changed.push(`delivery date to ${body.deliveryDate}`)
    }

    // --- Locality ----------------------------------------------------------
    let locality = (order.locality || '').trim()
    if (typeof body.region === 'string' && body.region.trim() && body.region.trim().toLowerCase() !== locality.toLowerCase()) {
      locality = body.region.trim().split('/')[0].trim()
      dropUpdates.locality = locality
      changed.push(`locality to ${locality}`)
    }

    // Routing follows the address AND the day, so re-resolve whenever either
    // moved - otherwise the order keeps the old address's rider.
    if (dropUpdates.locality !== undefined || dropUpdates.delivery_date !== undefined) {
      const { data: loc } = await admin
        .from('localities')
        .select('route_code, contractor_id, default_rider_id')
        .ilike('name', locality)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      let riderId = loc?.default_rider_id ?? null
      if (deliveryDate) {
        const { data: dayPlan } = await admin
          .from('day_placements')
          .select('id')
          .eq('place_date', deliveryDate)
          .eq('status', 'validated')
          .maybeSingle()
        if (dayPlan) {
          const { data: entry } = await admin
            .from('day_placement_entries')
            .select('rider_id')
            .eq('day_placement_id', dayPlan.id)
            .eq('locality', locality.toLowerCase())
            .maybeSingle()
          // No entry means that day did not override this locality; the
          // standing map above is still the answer.
          if (entry?.rider_id) riderId = entry.rider_id
        }
      }
      dropUpdates.rte = loc?.route_code ?? null
      dropUpdates.contractor_id = loc?.contractor_id ?? null
      dropUpdates.rider_id = riderId
      dropUpdates.assigned_at = loc?.contractor_id ? new Date().toISOString() : null
    }

    // --- Product and quantity (this row only) ------------------------------
    let products = (order.products || '').trim()
    let qty = Number(order.qty ?? 1) || 1
    let repriced = false
    if (typeof body.products === 'string' && body.products.trim() && body.products.trim().toLowerCase() !== products.toLowerCase()) {
      products = body.products.trim().slice(0, 500)
      updates.products = products
      repriced = true
      changed.push(`product to ${products}`)
    }
    if (Number.isInteger(body.qty) && (body.qty as number) > 0 && body.qty !== qty) {
      qty = body.qty as number
      updates.qty = qty
      repriced = true
      changed.push(`quantity to ${qty}`)
    }

    // The money is never the browser's to decide: a changed item or count is
    // repriced from the catalogue, with the same tiers the panel quotes.
    // An exchange stays free and a trade-in's settlement is not recomputed here.
    if (repriced && (order.sales_type || 'sale') === 'sale') {
      const { data: catalogue } = await admin
        .from('products')
        .select('id, name, price, bundle_prices, is_b1g1, has_variants')
        .ilike('name', products)
        .limit(1)
        .maybeSingle()
      if (!catalogue) {
        return NextResponse.json(
          { success: false, error: `"${products}" is not in the catalogue, so the order cannot be repriced. Change it in Deliveries instead.` },
          { status: 409 },
        )
      }
      updates.amount = priceFor(catalogue as QuickOrderProduct, qty)
    }

    if (!changed.length) return NextResponse.json({ success: true, changed: [], amount: Number(order.amount ?? 0) })

    const stamp = { updated_at: new Date().toISOString() }
    const { error } = await admin.from('deliveries').update({ ...updates, ...dropUpdates, ...stamp }).eq('id', id)
    if (error) {
      console.log('[v0] order amendment failed:', error.message)
      return NextResponse.json({ success: false, error: 'The order could not be changed, so nothing was sent.' }, { status: 500 })
    }

    // Items added to this drop share its day and address.
    let movedAddOns = 0
    if (Object.keys(dropUpdates).length) {
      const root = order.parent_delivery_id || order.id
      const { data: siblings } = await admin
        .from('deliveries')
        .select('id')
        .or(`id.eq.${root},parent_delivery_id.eq.${root}`)
        .in('status', ['pending', 'assigned'])
        .neq('id', id)
      if (siblings?.length) {
        const ids = siblings.map((s) => s.id)
        const { error: sibError } = await admin.from('deliveries').update({ ...dropUpdates, ...stamp }).in('id', ids)
        // The order itself is already correct; a failure here is reported, not fatal.
        if (sibError) console.log('[v0] add-ons not moved with the order:', sibError.message)
        else movedAddOns = ids.length
      }
    }

    return NextResponse.json({ success: true, changed, movedAddOns, amount: Number(updates.amount ?? order.amount ?? 0) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The order could not be changed'
    console.log('[v0] order amendment error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
