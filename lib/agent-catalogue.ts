'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  PRODUCT_CATEGORIES,
  UNCATEGORISED,
  RESULT_CAP,
  normaliseCategory,
} from '@/lib/products/categories'
import { searchWithFallback, type SearchOutcome } from '@/lib/products/search'

/** Everything an agent needs to answer "can I promise this, and at what price?" */
export interface CatalogueItem {
  id: string
  name: string
  price: number | null
  image_url: string | null
  /** null when the product has never been counted - NOT the same as zero. */
  quantity: number | null
  sold_out: boolean
  /** Units on a purchase order that has not landed yet. */
  incoming: number
  is_b1g1: boolean
  bundle_text: string | null
  variants: { value: string; quantity: number | null; price: number | null }[]
  /** Canonical category, or null when the product has none. */
  category: string | null
}

export type StockState = 'in_stock' | 'low' | 'sold_out' | 'unknown'

/** Roles that may browse the catalogue. Storekeeping stays where it is. */
const CAN_BROWSE = [
  'marketing_agent',
  'marketing_back_office',
  'marketing_front_office',
  'admin',
  'manager',
]

/**
 * Product search for the marketing agent.
 *
 * The service role is used deliberately, exactly as the order editor does.
 * `products` has no SELECT policy for marketing_agent - the table is
 * storekeeper-owned - so a user-scoped query returns zero rows and the agent
 * sees an empty catalogue rather than a permission error. Permission is
 * therefore enforced here, and this function only ever READS and only ever
 * returns the handful of columns below: no cost price, no supplier, no margin.
 */
export async function searchCatalogue(
  query: string,
  category?: string | null,
): Promise<SearchOutcome<CatalogueItem>> {
  const empty = { results: [], fallback: false }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return empty

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !CAN_BROWSE.includes(profile.role)) return empty

  const admin = createAdminClient()
  const q = (query || '').trim()

  // Only the category narrows the query. Name matching happens in JS because
  // ranking cannot be expressed as `ilike`, and the row limit must be applied
  // AFTER ranking - capping alphabetically first would discard the best match
  // before it was ever scored.
  let req = admin
    .from('products')
    .select('id, name, price, image_url, quantity, sold_out, is_b1g1, bundle_prices, category')
    .eq('is_active', true)
    .order('name')
    .limit(2000)

  if (category === UNCATEGORISED) req = req.or('category.is.null,category.eq.')
  else if (category) req = req.eq('category', category)

  const { data: all, error } = await req
  if (error) {
    console.log('[v0] searchCatalogue failed:', error.message)
    return { results: [], fallback: false }
  }
  if (!all?.length) return { results: [], fallback: false }

  const ranked = searchWithFallback(q, all)
  const rows = ranked.results.slice(0, RESULT_CAP)
  if (!rows.length) return { results: [], fallback: false }

  const ids = rows.map((r) => r.id)

  // Incoming stock is not a column - it is the sum of purchase orders that
  // have not landed. Without it a sold-out product looks permanently dead when
  // 5,000 units are actually on the way.
  const [{ data: variants }, { data: pos }] = await Promise.all([
    admin
      .from('product_variants')
      .select('product_id, attribute_value, quantity, price_override')
      .in('product_id', ids)
      .eq('is_active', true),
    // "Everything except Received" rather than a hand-typed transit list:
    // there is no Cancelled status in PO_STATUSES, and live data also holds a
    // lowercase 'pending' that is in no list at all. Excluding the one landed
    // status is the only filter that cannot silently drop a real shipment.
    admin
      .from('purchase_orders')
      .select('product_id, qty, status')
      .in('product_id', ids)
      .neq('status', 'Received'),
  ])

  const incomingBy = new Map<string, number>()
  for (const p of pos ?? []) {
    incomingBy.set(p.product_id, (incomingBy.get(p.product_id) ?? 0) + (p.qty ?? 0))
  }
  const variantsBy = new Map<string, CatalogueItem['variants']>()
  for (const v of variants ?? []) {
    const list = variantsBy.get(v.product_id) ?? []
    list.push({
      value: v.attribute_value,
      quantity: v.quantity ?? null,
      price: v.price_override ? Number(v.price_override) : null,
    })
    variantsBy.set(v.product_id, list)
  }

  const items = rows.map((r) => {
    const price = Number(r.price) || 0
    return {
      id: r.id,
      name: r.name,
      // 622 of 843 active products sit at price 0, which means "not set", not
      // "free". Nulled here so the UI can say so instead of printing Rs 0.
      price: price > 0 ? price : null,
      image_url: r.image_url || null,
      // quantity 0 means NEVER COUNTED, never "none left" - verified live:
      // zero rows have last_counted_at set with a zero quantity. Reporting 0
      // as "none in stock" would refuse a sale of a product sitting on a shelf.
      quantity: r.quantity && r.quantity > 0 ? r.quantity : null,
      sold_out: !!r.sold_out,
      incoming: incomingBy.get(r.id) ?? 0,
      is_b1g1: !!r.is_b1g1,
      bundle_text: bundleText(r.bundle_prices),
      variants: variantsBy.get(r.id) ?? [],
      // Legacy spellings are folded here too, so a row still holding
      // "Automotive" groups under Car & Motorbike instead of forming a
      // near-duplicate heading of its own.
      category: normaliseCategory(r.category),
    }
  })

  return { results: items, fallback: ranked.fallback }
}

/** Category names plus how many products sit in each, for the filter chips. */
export async function getCatalogueCategories(): Promise<{ name: string; count: number }[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !CAN_BROWSE.includes(profile.role)) return []

  const admin = createAdminClient()
  const { data } = await admin.from('products').select('category').eq('is_active', true)
  if (!data) return []

  const counts = new Map<string, number>()
  for (const r of data) {
    const c = normaliseCategory(r.category) ?? UNCATEGORISED
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  // Canonical order, not alphabetical or by size: the list stays put between
  // searches so an agent builds muscle memory for where a category sits.
  const ordered = PRODUCT_CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
    name: c as string,
    count: counts.get(c)!,
  }))
  if (counts.has(UNCATEGORISED)) {
    ordered.push({ name: UNCATEGORISED, count: counts.get(UNCATEGORISED)! })
  }
  return ordered
}

/** Bundle pricing is stored as JSON; agents need the offer, not the shape. */
function bundleText(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([k, v]) => [Number(k), Number(v)] as const)
    .filter(([k, v]) => k > 1 && v > 0)
    .sort((a, b) => a[0] - b[0])
  if (!entries.length) return null
  return entries.map(([k, v]) => `${k} for Rs ${v}`).join(' - ')
}
