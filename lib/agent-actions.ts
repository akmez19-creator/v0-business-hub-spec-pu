'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface AgentClientResult {
  id: string
  name: string | null
  phone: string
  region: string | null
  client_status: string | null
  total_orders: number
  delivered_rate: number | null
  last_order_date: string | null
  /** Orders still pending/assigned. Deliberately separate from total_orders,
   *  which counts delivered + CMS only and therefore reads 0 for a client who
   *  already has live orders. */
  open_orders: number
}

export interface AgentEntry {
  id: string
  customer_name: string | null
  contact_1: string | null
  products: string | null
  qty: number | null
  amount: number | null
  locality: string | null
  rte: string | null
  status: string
  delivery_date: string | null
  created_at: string
}

/**
 * Client lookup for the marketing agent home screen.
 *
 * Any signed-in staff member may look a client up - that is the core of the
 * job. The gate here is only that the caller is authenticated at all; the
 * bulk browse/import/export surface is what stays restricted.
 */
export async function searchClientsForAgent(query: string): Promise<AgentClientResult[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const q = (query || '').trim()
  // Two characters is the point where results stop being the whole table.
  if (q.length < 2) return []

  // User-scoped client, not the service role: RLS already grants
  // marketing_agent SELECT on clients and deliveries, so there is nothing to
  // bypass, and going through the caller's own permissions means this screen
  // automatically respects any future tightening of those policies.
  const { data, error } = await supabase.rpc('search_clients_for_agent', {
    p_query: q,
    p_limit: 20,
  })

  if (error) {
    console.log('[v0] searchClientsForAgent failed:', error.message)
    return []
  }
  return (data || []) as AgentClientResult[]
}

/**
 * The signed-in agent's own entries for one day.
 *
 * The agent id comes from the session, never from an argument, so this cannot
 * be pointed at a colleague's numbers.
 */
export async function getMyEntriesForDay(date?: string): Promise<AgentEntry[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase.rpc('get_agent_entries_for_day', {
    p_agent: user.id,
    p_date: date ?? null,
  })

  if (error) {
    console.log('[v0] getMyEntriesForDay failed:', error.message)
    return []
  }
  return (data || []) as AgentEntry[]
}

export interface ClientOrder {
  id: string
  products: string | null
  qty: number | null
  amount: number | null
  locality: string | null
  delivery_date: string | null
  status: string
  created_at: string
  rider_name: string | null
  agent_name: string | null
  cancel_reason: string | null
  is_editable: boolean
  /** Every amendment, newest first. Empty when the order is untouched. */
  edits?: OrderEdit[]
}

export interface OrderEdit {
  field: string
  old_value: string | null
  new_value: string | null
  reason: string | null
  changed_by_name: string | null
  created_at: string
}

/** Every order belonging to one client, newest and still-live first. */
export async function getClientOrders(phone: string): Promise<ClientOrder[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase.rpc('get_client_orders_for_agent', {
    p_phone: phone,
    p_limit: 20,
  })

  if (error) {
    console.log('[v0] getClientOrders failed:', error.message)
    return []
  }
  const orders = (data || []) as ClientOrder[]
  if (!orders.length) return orders

  // The RPC only knows who CREATED the order, so an amended order still reads
  // "by Hanna" after Munsah changed it - the person who actually last touched
  // it is invisible, which is exactly what you cannot afford when two agents
  // are working the same client. The log is already written on every edit; it
  // was simply never read back. Fetched separately rather than by rewriting
  // the RPC, which is the riskier change.
  const { data: log } = await supabase
    .from('delivery_change_log')
    .select('delivery_id, field, old_value, new_value, reason, changed_by, created_at')
    .in('delivery_id', orders.map((o) => o.id))
    .order('created_at', { ascending: false })

  if (!log?.length) return orders

  // Resolved in one lookup - a join through the log would repeat the profile
  // for every field changed in the same save.
  const actorIds = [...new Set(log.map((r) => r.changed_by).filter(Boolean))]
  const { data: people } = await supabase
    .from('profiles')
    .select('id, name')
    .in('id', actorIds)
  const nameById = new Map((people || []).map((p) => [p.id, p.name as string]))

  const byOrder = new Map<string, OrderEdit[]>()
  for (const r of log) {
    const list = byOrder.get(r.delivery_id) ?? []
    list.push({
      field: r.field,
      old_value: r.old_value,
      new_value: r.new_value,
      reason: r.reason,
      changed_by_name: nameById.get(r.changed_by) ?? null,
      created_at: r.created_at,
    })
    byOrder.set(r.delivery_id, list)
  }
  return orders.map((o) => ({ ...o, edits: byOrder.get(o.id) ?? [] }))
}

/** Roles allowed to amend an order from this screen. */
const CAN_EDIT_ORDERS = ['marketing_agent', 'admin', 'manager']

async function requireOrderEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' as const }

  const { data: profile } = await supabase
    .from('profiles').select('role, name').eq('id', user.id).single()

  if (!profile || !CAN_EDIT_ORDERS.includes(profile.role)) {
    return { error: 'Not allowed to change orders' as const }
  }
  return { userId: user.id, role: profile.role }
}

/** Only these may be changed here. Anything else - rider, payment, status -
 *  stays with the roles that own it. */
type EditableField = 'products' | 'qty' | 'amount' | 'locality' | 'delivery_date'
const EDITABLE: EditableField[] = ['products', 'qty', 'amount', 'locality', 'delivery_date']

export async function updateOrderAsAgent(
  orderId: string,
  patch: Partial<Record<EditableField, string | number | null>>,
  reason: string,
) {
  const auth = await requireOrderEditor()
  if ('error' in auth) return { error: auth.error }
  if (!reason?.trim()) return { error: 'Please say why you are changing this' }

  // The service role is used deliberately. marketing_agent is absent from the
  // deliveries UPDATE policy, and an RLS UPDATE that matches no row reports
  // success while changing nothing - the agent would think the order was
  // amended when it was not. Broadening that policy instead would let an agent
  // write ANY column straight from the browser (rider, status, payment), since
  // RLS grants rows, not columns. So permission is enforced here and the
  // whitelist below is what actually limits the blast radius.
  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()

  const { data: before, error: readErr } = await db
    .from('deliveries')
    .select('id, products, qty, amount, locality, delivery_date, status, rider_id')
    .eq('id', orderId)
    .single()

  if (readErr || !before) return { error: 'Order not found' }
  if (before.status === 'cancelled') return { error: 'This order is already cancelled' }

  // Build the update from the whitelist only, and keep just the fields that
  // genuinely differ so the log does not fill with no-op rows.
  const updates: Record<string, unknown> = {}
  const logRows: {
    delivery_id: string; changed_by: string; field: string
    old_value: string | null; new_value: string | null; reason: string
  }[] = []

  for (const field of EDITABLE) {
    if (!(field in patch)) continue
    let next = patch[field]

    if (field === 'qty') next = Number(next)
    if (field === 'amount') next = Number(next)
    if ((field === 'qty' || field === 'amount') && !Number.isFinite(next as number)) {
      return { error: `${field} must be a number` }
    }
    if (field === 'qty' && (next as number) < 1) return { error: 'Quantity must be at least 1' }
    if (field === 'amount' && (next as number) < 0) return { error: 'Amount cannot be negative' }

    const prev = (before as Record<string, unknown>)[field]
    const same = String(prev ?? '') === String(next ?? '')
    if (same) continue

    updates[field] = next
    logRows.push({
      delivery_id: orderId,
      changed_by: auth.userId,
      field,
      old_value: prev === null || prev === undefined ? null : String(prev),
      new_value: next === null || next === undefined ? null : String(next),
      reason: reason.trim(),
    })
  }

  if (logRows.length === 0) return { ok: true, changed: 0 }

  updates.updated_at = new Date().toISOString()

  const { error: updErr } = await db.from('deliveries').update(updates).eq('id', orderId)
  if (updErr) return { error: updErr.message }

  const { error: logErr } = await db.from('delivery_change_log').insert(logRows)
  if (logErr) console.log('[v0] change log insert failed:', logErr.message)

  // Moving an order to a different locality can invalidate the rider it was
  // routed to. Surfaced to the agent rather than silently reassigning, which
  // is a dispatch decision.
  const riderNeedsReview = 'locality' in updates && !!before.rider_id

  revalidatePath('/dashboard')
  return { ok: true, changed: logRows.length, riderNeedsReview }
}

/**
 * Choose (or clear) the free model on a B1G1 order.
 *
 * The gift is a SECOND unit of the same product, so the only open question is
 * which model. It cannot live on the paid row - one row names one model - so it
 * becomes its own delivery row at Rs 0, linked back through `source_delivery_id`
 * and marked `sales_type = 'free_item'`.
 *
 * That marker is what keeps the books straight, and all three halves matter:
 *  - stock DOES deduct it, which is the point: the free unit ships and until
 *    now was never taken off the shelf.
 *  - `delivery_contribution()` scores it 0 orders / 0 delivered / Rs 0, so a
 *    B1G1 sale stays ONE order, Delivered % is untouched, and an Rs 0 row does
 *    not drag the average order value down.
 *  - `get_client_open_orders()` skips it, so the duplicate-order badge does not
 *    read one order as two and warn the next agent off a genuine sale.
 */
export async function setFreeItemAsAgent(
  orderId: string,
  variantId: string | null,
  reason: string,
) {
  const auth = await requireOrderEditor()
  if ('error' in auth) return { error: auth.error }
  if (!reason?.trim()) return { error: 'Please say why you are changing this' }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()

  const { data: parent, error: readErr } = await db
    .from('deliveries')
    // `qty` is read because the gift is one free unit PER PAID UNIT, so the
    // free row has to match the paid row's quantity.
    .select('id, customer_name, contact_1, contact_2, locality, rte, contractor_id, rider_id, product_id, products, status, entry_date, delivery_date, medium, ad_id, qty')
    .eq('id', orderId)
    .single<{
      id: string
      qty: number | null
      customer_name: string | null
      contact_1: string | null
      contact_2: string | null
      locality: string | null
      rte: string | null
      contractor_id: string | null
      rider_id: string | null
      product_id: string | null
      products: string | null
      status: string | null
      entry_date: string | null
      delivery_date: string | null
      medium: string | null
      ad_id: string | null
    }>()

  if (readErr || !parent) return { error: 'Order not found' }
  if (parent.status === 'cancelled') return { error: 'This order is cancelled' }
  if (parent.status === 'delivered') {
    // The box has already gone out. Adding a unit now would take stock off the
    // shelf for something nobody is going to pack.
    return { error: 'This order was already delivered - the free unit cannot be changed' }
  }

  const { data: existing } = await db
    .from('deliveries')
    .select('id, products')
    .eq('source_delivery_id', orderId)
    .eq('sales_type', 'free_item')
    .maybeSingle()

  // Clearing the choice removes the gift row entirely rather than leaving an
  // Rs 0 row naming no model.
  if (!variantId) {
    if (!existing) return { ok: true, changed: 0 }
    const { error } = await db.from('deliveries').delete().eq('id', existing.id)
    if (error) return { error: error.message }
    await db.from('delivery_change_log').insert([{
      delivery_id: orderId, changed_by: auth.userId, field: 'free_item',
      old_value: existing.products, new_value: null, reason: reason.trim(),
    }])
    revalidatePath('/dashboard')
    return { ok: true, changed: 1 }
  }

  // The gift is a second unit of the SAME product, so the only choice is which
  // model of it. Enforce that here too: the dropdown already limits the options,
  // but this action is reachable with any id and a mismatched model would ship
  // a gift off a different product's shelf.
  const { data: variant } = await db
    .from('product_variants')
    .select('id, attribute_value, product_id, products(name)')
    .eq('id', variantId)
    .maybeSingle<{
      id: string
      attribute_value: string
      product_id: string
      products: { name?: string } | null
    }>()

  if (!variant) return { error: 'That model no longer exists' }
  if (parent.product_id && variant.product_id !== parent.product_id) {
    return { error: 'The free unit must be a model of the product on this order' }
  }

  const productName = variant.products?.name ?? (parent.products ?? '').split(' - ')[0]
  const label = `${productName} - ${variant.attribute_value} - B1G1 FREE`

  if (existing) {
    if (existing.products === label) return { ok: true, changed: 0 }
    const { error } = await db
      .from('deliveries')
      .update({ products: label, product_id: variant.product_id, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) return { error: error.message }
    await db.from('delivery_change_log').insert([{
      delivery_id: orderId, changed_by: auth.userId, field: 'free_item',
      old_value: existing.products, new_value: label, reason: reason.trim(),
    }])
    revalidatePath('/dashboard')
    return { ok: true, changed: 1 }
  }

  const { error } = await db.from('deliveries').insert([{
    customer_name: parent.customer_name,
    contact_1: parent.contact_1,
    contact_2: parent.contact_2,
    locality: parent.locality,
    rte: parent.rte,
    contractor_id: parent.contractor_id,
    rider_id: parent.rider_id,
    ad_id: parent.ad_id,
    medium: parent.medium,
    products: label,
    product_id: variant.product_id,
    // One free unit per paid unit - mirrors the extension. A parent of qty 2
    // gives 2 free, not 1.
    qty: Math.max(1, Number(parent.qty) || 1),
    amount: 0,
    status: parent.status,
    sales_type: 'free_item',
    source_delivery_id: orderId,
    entry_date: parent.entry_date,
    delivery_date: parent.delivery_date,
    created_by: auth.userId,
  }])
  if (error) return { error: error.message }

  await db.from('delivery_change_log').insert([{
    delivery_id: orderId, changed_by: auth.userId, field: 'free_item',
    old_value: null, new_value: label, reason: reason.trim(),
  }])
  revalidatePath('/dashboard')
  return { ok: true, changed: 1 }
}

export async function cancelOrderAsAgent(orderId: string, reason: string) {
  const auth = await requireOrderEditor()
  if ('error' in auth) return { error: auth.error }
  if (!reason?.trim()) return { error: 'Please give a reason for cancelling' }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const db = createAdminClient()

  const { data: before, error: readErr } = await db
    .from('deliveries')
    .select('id, status')
    .eq('id', orderId)
    .single()

  if (readErr || !before) return { error: 'Order not found' }
  if (before.status === 'cancelled') return { error: 'Already cancelled' }
  if (before.status === 'delivered') {
    return { error: 'This order was already delivered - it cannot be cancelled' }
  }

  const { error: updErr } = await db
    .from('deliveries')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: auth.userId,
      cancel_reason: reason.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  if (updErr) return { error: updErr.message }

  await db.from('delivery_change_log').insert({
    delivery_id: orderId,
    changed_by: auth.userId,
    field: 'status',
    old_value: before.status,
    new_value: 'cancelled',
    reason: reason.trim(),
  })

  revalidatePath('/dashboard')
  return { ok: true }
}
