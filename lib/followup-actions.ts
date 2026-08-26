'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  composeOutLine,
  composeReturnLine,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_LABELS,
  sendsProductOut,
  settle,
  type FollowUpKind,
} from '@/lib/orders/follow-up'
import { priceFor, type QuickOrderProduct } from '@/lib/orders/quick-order'
import { pricedProductFor } from '@/lib/orders/order-lines'

/**
 * Trade-in / exchange / refund raised against an order that was DELIVERED.
 *
 * None of this is a new concept in the data: sales_type already carries
 * 'trade_in' (21 rows), 'exchange' (42) and 'refund' (22), and the house
 * convention is products = what goes OUT, return_product = what comes BACK,
 * amount = what the client pays. All this does is make that enforceable
 * instead of hand-typed.
 */

/** Same roles that may already amend an order. */
const CAN_RAISE = ['marketing_agent', 'admin', 'manager']

export interface FollowUpInput {
  sourceOrderId: string
  kind: FollowUpKind
  /**
   * Catalogue id of the replacement going OUT. Required except on a refund.
   * An id, not a name: names are re-typed and merged (there is a whole
   * Find Duplicates tool for that), and a variant line reads "Name - Red",
   * which matches no product row at all.
   */
  outProductId?: string | null
  /** Chosen variant of that product, when it has any. */
  outVariantId?: string | null
  /**
   * Units of the NEW item going out. Independent of returnQty - handing back
   * two old blenders does not mean taking two new ones.
   */
  outQty?: number
  /** Units of the original coming back. */
  returnQty: number
  /**
   * Trade-in: agreed value of the returned item.
   * Refund: how much of the paid amount to give back.
   * Ignored for an exchange.
   */
  allowance: number
  deliveryDate: string
  reason: string
}

export async function createFollowUpOrder(input: FollowUpInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, name')
    .eq('id', user.id)
    .single()
  if (!profile || !CAN_RAISE.includes(profile.role)) {
    return { error: 'Not allowed to raise a trade-in, exchange or refund' }
  }

  const kind = input.kind
  if (!FOLLOW_UP_KINDS.includes(kind)) return { error: 'Unknown follow-up type' }

  const outProductId = (input.outProductId || '').trim()
  const reason = (input.reason || '').trim()
  if (!reason) return { error: 'Please say why this is being raised' }
  if (!input.deliveryDate) return { error: 'Pick a date to collect' }
  if (sendsProductOut(kind) && !outProductId) {
    return { error: `A ${FOLLOW_UP_LABELS[kind].toLowerCase()} needs a product going out` }
  }

  const db = createAdminClient()

  const { data: source, error: readErr } = await db
    .from('deliveries')
    .select(
      'id, customer_name, contact_1, contact_2, locality, rte, medium, products, qty, amount, status',
    )
    .eq('id', input.sourceOrderId)
    .single()
  if (readErr || !source) return { error: 'Original order not found' }

  // The condition the whole feature rests on. Against an order the client
  // never received this is not a trade-in - it is an amendment, and Change
  // already does that correctly.
  if (source.status !== 'delivered') {
    return {
      error:
        source.status === 'cancelled'
          ? 'That order was cancelled - there is nothing to trade in or refund.'
          : `That order is still ${source.status}. Change or cancel it instead - this only applies once the client has the goods.`,
    }
  }

  const sourceQty = Math.max(1, Number(source.qty ?? 1))
  const returnQty = Math.floor(Number(input.returnQty) || 1)
  if (returnQty < 1) return { error: 'At least one unit must come back' }
  // Returning more than was delivered is always a mistake, and it would
  // over-credit the client by whatever the extra units are worth.
  if (returnQty > sourceQty) {
    return {
      error: `Only ${sourceQty} unit${sourceQty > 1 ? 's were' : ' was'} delivered - cannot take back ${returnQty}.`,
    }
  }

  // The new item is its own order line with its own count. Reusing returnQty
  // here (the first cut did) sends a client two replacements because they
  // handed two units back.
  const outQty = Math.max(1, Math.floor(Number(input.outQty) || 1))

  // Price the replacement from the catalogue on the SERVER. A price posted by
  // the browser is a price the client can choose for themselves.
  let outValue = 0
  let outLine = ''
  if (sendsProductOut(kind)) {
    const { data: prod } = await db
      .from('products')
      .select('id, name, price, bundle_prices, is_b1g1, has_variants')
      .eq('id', outProductId)
      .maybeSingle()
    if (!prod) return { error: 'That product is no longer in the catalogue' }

    let variant: { attribute_value: string; price_override: string | null } | null = null
    if (input.outVariantId) {
      const { data: v } = await db
        .from('product_variants')
        .select('attribute_value, price_override, product_id')
        .eq('id', input.outVariantId)
        .maybeSingle()
      // A variant from a different product means a stale form; taking it would
      // price one thing and ship another.
      if (!v || v.product_id !== prod.id) return { error: 'Pick the variant again' }
      variant = v
    } else if (prod.has_variants) {
      return { error: `Choose which ${prod.name} is going out` }
    }

    // priceFor() walks the bundle tiers, which every one of the 843 active
    // products carries. Flat price x qty silently overcharges on any of them.
    const priced = pricedProductFor(prod as QuickOrderProduct, variant as never)
    outValue = priceFor(priced, outQty)
    outLine = composeOutLine({
      productName: prod.name,
      variantValue: variant?.attribute_value ?? null,
      isB1g1: priced.is_b1g1,
      qty: outQty,
    })
  }

  const money = settle({
    kind,
    orderAmount: source.amount,
    orderQty: source.qty,
    returnQty,
    outValue,
    allowance: Number(input.allowance) || 0,
  })

  // The credit is derived from the original order now, so a zero here does not
  // mean the agent forgot to type it - it means the source order itself is
  // worth nothing, and crediting nothing for returned goods is the commonest
  // way to hand over a new item at full price while keeping the old one.
  if (kind === 'trade_in' && money.credit <= 0) {
    return {
      error:
        'That order was recorded at Rs 0, so there is nothing to credit for the returned item. Fix the original order first, or use Exchange if it is a straight swap.',
    }
  }
  if (kind === 'refund' && money.credit <= 0) {
    return { error: 'A refund has to give something back.' }
  }

  const returnProduct = composeReturnLine(source.products, returnQty)

  const { data: created, error: insErr } = await db
    .from('deliveries')
    .insert({
      customer_name: source.customer_name,
      contact_1: source.contact_1,
      contact_2: source.contact_2,
      locality: source.locality,
      rte: source.rte,
      medium: source.medium,
      // Refund sends nothing out, so products names what is being collected -
      // otherwise the row is blank on a rider's sheet.
      products: sendsProductOut(kind) ? outLine : `Collect: ${returnProduct}`,
      return_product: returnProduct,
      // qty describes what the rider CARRIES OUT, because that is what the
      // picking list and the stock reservation both read it as. On a refund
      // nothing goes out, so it is the number being collected instead.
      qty: sendsProductOut(kind) ? outQty : returnQty,
      amount: money.amount,
      sales_type: kind,
      status: 'pending',
      source_delivery_id: source.id,
      delivery_date: input.deliveryDate,
      entry_date: new Date().toISOString().slice(0, 10),
      notes: `IN: ${returnProduct} - ${reason}`,
      payment_status: 'unpaid',
      created_by: user.id,
    })
    .select('id')
    .single()
  if (insErr) return { error: insErr.message }

  // Logged against the SOURCE order too, so anyone opening the original sees
  // that a follow-up exists instead of only finding it on the new row.
  await db.from('delivery_change_log').insert({
    delivery_id: source.id,
    changed_by: user.id,
    field: 'follow_up',
    old_value: null,
    new_value: `${FOLLOW_UP_LABELS[kind]}: ${returnProduct} back${
      sendsProductOut(kind) ? ` / ${outLine} out` : ''
    } (Rs ${money.amount})`,
    reason,
  })

  // Warn, do not block: a second trade-in on a multi-unit order is legitimate,
  // but two open follow-ups is also how one item gets collected twice.
  const { data: open } = await db
    .from('deliveries')
    .select('id')
    .eq('source_delivery_id', source.id)
    .in('status', ['pending', 'assigned'])

  revalidatePath('/dashboard')
  return {
    ok: true,
    id: created.id,
    amount: money.amount,
    direction: money.direction,
    duplicateWarning:
      open && open.length > 1
        ? `Careful - this order now has ${open.length} follow-ups still open.`
        : null,
  }
}
