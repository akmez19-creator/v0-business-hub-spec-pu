'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { settle, CONVERTIBLE_KINDS, KIND_LABEL, type FollowUpKind } from '@/lib/orders/follow-up'
import { incomingQty, stripReturnCount } from '@/lib/stock-direction'
import { settlementReasons, joinReasons } from '@/lib/delivery-status-rules'
import { canonicalMethod, splitForMethod } from '@/lib/payment-method'

/**
 * Convert a follow-up order between refund / exchange / trade-in.
 *
 * Three things move together, and getting any one of them wrong leaves the
 * books disagreeing with the warehouse:
 *
 *  1. MONEY. A refund stores a NEGATIVE amount (the live rows are -575, -475,
 *     -475, -575) while an exchange stores 0. Changing only the label would
 *     leave lifetime spend showing a payout that never happened. The figure is
 *     recomputed with settle(), the same function the rider flow uses, never
 *     typed or copied.
 *
 *  2. STOCK OUT. A refund sends nothing out (qty 0); an exchange/trade-in sends
 *     a replacement. But if the storekeeper has ALREADY validated the day's
 *     load, that replacement comes off stock the rider is carrying - the load
 *     sheet is fixed and must not gain a unit. `replacement_from_van` records
 *     that, and outgoingQty() returns 0 for it.
 *
 *  3. STOCK IN. All three kinds take an item back, so `return_product` is
 *     preserved across the conversion rather than rebuilt.
 */
export async function convertFollowUpKind(
  deliveryId: string,
  toKind: FollowUpKind,
): Promise<{ success: true; note: string } | { error: string }> {
  if (!CONVERTIBLE_KINDS.includes(toKind)) {
    return { error: `Cannot convert to ${toKind}` }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const db = createAdminClient()
  const { data: profile } = await db
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Only admins can convert a follow-up order' }
  }

  const { data: fetched, error: fetchErr } = await db
    .from('deliveries')
    .select(
      'id, sales_type, status, products, return_product, qty, amount, rider_id, ' +
      'delivery_date, source_delivery_id, contractor_cash_counted_at, ' +
      'contractor_juice_counted_at, juice_transferred_at, cash_collected, ' +
      'juice_collected, payment_method',
    )
    .eq('id', deliveryId)
    .single()

  if (fetchErr || !fetched) return { error: fetchErr?.message ?? 'Order not found' }

  // The select list is built by concatenation, which defeats supabase-js's
  // literal-string column inference and leaves `data` as an error shape.
  const row = fetched as unknown as {
    id: string
    sales_type: string | null
    status: string | null
    products: string | null
    return_product: string | null
    qty: number | null
    amount: number | null
    rider_id: string | null
    delivery_date: string | null
    source_delivery_id: string | null
    contractor_cash_counted_at: string | null
    contractor_juice_counted_at: string | null
    juice_transferred_at: string | null
    cash_collected: boolean | null
    juice_collected: boolean | null
    payment_method: string | null
  }

  const fromKind = String(row.sales_type || '').trim().toLowerCase()
  if (!CONVERTIBLE_KINDS.includes(fromKind as FollowUpKind)) {
    return { error: `This is a ${fromKind || 'normal'} order, not a follow-up` }
  }
  if (fromKind === toKind) return { error: 'Already that type' }

  // Money already settled? Converting would rewrite an amount the contractor
  // has physically handed over and counted, so the counted total would stop
  // matching its rows - the same rule applied to payment method and CMS.
  const reasons = settlementReasons(row)
  if (reasons.length > 0) {
    return {
      error:
        `Cannot convert this order because ${joinReasons(reasons)}. The money has ` +
        `already been accounted for, so changing the settlement now would leave that ` +
        `total disagreeing with the orders behind it. Undo the count or transfer first.`,
    }
  }

  // ── The money, recomputed from the ORIGINAL order ────────────────────────
  //
  // The credit for goods coming back is what the client PAID for them, read
  // off the source order - never a typed figure. Without a source link there
  // is nothing to read, so the existing amount is kept rather than invented.
  let orderAmount: number | null = null
  let orderQty: number | null = null
  if (row.source_delivery_id) {
    const { data: src } = await db
      .from('deliveries').select('amount, qty').eq('id', row.source_delivery_id).single()
    if (src) { orderAmount = Number(src.amount); orderQty = Number(src.qty) }
  }

  const returnQty = Math.max(1, incomingQty(row) || 1)
  const update: Record<string, unknown> = {
    sales_type: toKind,
    updated_at: new Date().toISOString(),
  }
  let moneyNote: string

  if (orderAmount === null) {
    // 19 of 21 legacy rows have no source link. Rewriting their money from a
    // guess is exactly the mistake that produced the wrong trade-in credits, so
    // the amount is left exactly as it is and the gap is stated plainly.
    moneyNote = 'the amount was left unchanged (this order has no link to the sale it came from)'
  } else {
    // Converting TO a refund: default to giving back everything the client
    // paid for the returned units. settle() clamps `allowance` to that figure
    // anyway, so a previously-partial amount is carried over when there is one
    // and a full refund is assumed otherwise. 2 of 9 refunds were partial, so
    // the admin can still edit the amount afterwards.
    const previousPayout = Math.abs(Number(row.amount ?? 0))
    const s = settle({
      kind: toKind,
      orderAmount,
      orderQty,
      returnQty,
      // Ignored for refund and exchange. For a trade-in the replacement's value
      // is not known here, so it stays 0 and the row is settled at the credit -
      // the admin sets the real figure on the order if they trade up.
      outValue: 0,
      allowance: previousPayout > 0 ? previousPayout : Number.MAX_SAFE_INTEGER,
    })
    update.amount = s.amount
    moneyNote =
      s.amount === 0
        ? 'nothing is owed either way'
        : s.amount < 0
          ? `Rs ${Math.abs(s.amount).toLocaleString()} is paid back to the client`
          : `Rs ${s.amount.toLocaleString()} is collected from the client`
  }

  // ── The stock ────────────────────────────────────────────────────────────
  let stockNote = ''
  if (toKind === 'refund') {
    // Nothing goes out on a refund. qty 0 is deliberate - see stock-direction.
    update.qty = 0
    update.replacement_from_van = false
    update.needs_stock_issue = false
    stockNote = 'nothing goes out to the client'
  } else {
    update.qty = Math.max(1, Number(row.qty ?? 0) || 1)

    // Was the day's load already counted out? If so the replacement leaves the
    // van, not the warehouse, and the fixed load sheet must not gain a unit.
    const validated = await dayWasValidated(db, row.rider_id, row.delivery_date)
    if (!validated) {
      update.replacement_from_van = false
      update.needs_stock_issue = false
      stockNote = 'the replacement will be added to the load sheet as normal'
    } else {
      // The replacement is the SAME product the client is returning on an
      // exchange. A trade-in usually swaps for something else, which the rider
      // may not be carrying at all.
      const wanted = stripReturnCount(row.return_product) || String(row.products || '').trim()
      const onVan = await productOnValidatedLoad(db, row.rider_id, row.delivery_date, wanted)
      if (onVan) {
        update.replacement_from_van = true
        update.needs_stock_issue = false
        stockNote =
          'the replacement comes off the stock already on the van, so the load sheet is unchanged'
      } else {
        update.replacement_from_van = false
        update.needs_stock_issue = true
        stockNote =
          `"${wanted}" is not on the rider's counted load, so it is flagged for the storekeeper to issue`
      }
    }
  }

  // Move the payment split WITH the new amount. Writing `amount` alone leaves
  // payment_cash/juice/bank holding the pre-conversion figure, so the
  // contractor's cash count and the juice transfer totals - both summed from
  // those columns - keep counting money this order no longer involves. This is
  // the same defect that put four live rows out of tally via the price editor.
  // A method that does not canonicalise (every undelivered order stores NULL)
  // is skipped deliberately - there is no collected money to keep in step, and
  // guessing a column would move it into the wrong one.
  const payMethod = canonicalMethod(row.payment_method)
  if (payMethod && typeof update.amount === 'number') {
    Object.assign(update, splitForMethod(payMethod, update.amount))
  }

  const { error } = await db.from('deliveries').update(update).eq('id', deliveryId)
  if (error) return { error: error.message }

  for (const p of [
    '/dashboard/deliveries', '/dashboard/deliveries/all', '/dashboard/orders',
    '/dashboard/contractors/stock', '/dashboard/contractors/returns',
    '/dashboard/riders/stock', '/dashboard/storekeeper',
  ]) revalidatePath(p)

  return {
    success: true,
    note: `Changed to ${KIND_LABEL[toKind]} - ${moneyNote}, and ${stockNote}.`,
  }
}

/** Has the storekeeper counted this rider's load out for the day? */
async function dayWasValidated(
  db: ReturnType<typeof createAdminClient>,
  riderId: string | null,
  date: string | null,
): Promise<boolean> {
  if (!riderId || !date) return false
  const { data: rider } = await db
    .from('riders').select('contractor_id').eq('id', riderId).single()
  if (!rider?.contractor_id) return false
  const { data } = await db
    .from('contractor_daily_stock')
    .select('id')
    .eq('contractor_id', rider.contractor_id)
    .eq('stock_date', date)
    .eq('is_validated', true)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/**
 * Is this exact product on the counted load?
 *
 * Matched EXACTLY, never by substring: "Shampoo" appears inside "Shampoo
 * Brush", and substring matching over-flags 53 of the 843 products.
 */
async function productOnValidatedLoad(
  db: ReturnType<typeof createAdminClient>,
  riderId: string | null,
  date: string | null,
  product: string,
): Promise<boolean> {
  const wanted = product.trim().toLowerCase()
  if (!riderId || !date || !wanted) return false
  const { data: rider } = await db
    .from('riders').select('contractor_id').eq('id', riderId).single()
  if (!rider?.contractor_id) return false
  const { data } = await db
    .from('contractor_daily_stock')
    .select('product, received_qty')
    .eq('contractor_id', rider.contractor_id)
    .eq('stock_date', date)
  return (data || []).some(
    r => String(r.product || '').trim().toLowerCase() === wanted && Number(r.received_qty ?? 0) > 0,
  )
}
