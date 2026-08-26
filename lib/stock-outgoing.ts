// The OPENING STOCK side of validation: what the storekeeper should have
// counted ONTO each van before the round started.
//
// This is the mirror of lib/returns-inbound.ts. That file answers "what came
// back and was never counted in"; this one answers "what went out and was
// never counted out". The outgoing check is the one that matters first,
// because it happens while the rider is still standing in the warehouse - once
// he has driven off, an uncounted load can no longer be verified against
// anything.
//
// Units come from outgoingQty() rather than the raw `qty` column so this
// screen cannot disagree with the storekeeper's own dispatch screen:
//   - a refund carries qty 0 (nothing leaves), and
//   - a `replacement_from_van` row was already counted in an earlier load.
// Both correctly contribute nothing to count.

import { outgoingQty } from './stock-direction'

/** Statuses a row can hold that still mean "this was part of the day's load".
 *
 * Deliberately includes the end states. An admin reviewing a past day sees
 * rows that have already moved to delivered/cms/nwd, but every one of them was
 * physically on the van that morning and should have been counted then.
 * Filtering to pending/assigned would make yesterday look empty. */
export const LOADED_STATUSES = ['pending', 'assigned', 'delivered', 'nwd', 'cms'] as const

export interface OutgoingItem {
  id: string
  product: string
  qty: number
  date: string
  customer: string | null
  status: string
  validated: boolean
  validatedAt: string | null
  validatedBy: string | null
}

export interface OutgoingProduct {
  key: string
  product: string
  /** Units of this product across every row for this contractor that day. */
  qty: number
  /** Units still not counted out. */
  pendingQty: number
  items: OutgoingItem[]
}

export interface OutgoingContractor {
  id: string
  name: string
  date: string
  /** Every unit that should have been loaded. */
  totalQty: number
  /** Units never counted out - the exception the page exists to show. */
  pendingQty: number
  products: OutgoingProduct[]
}

type Row = Record<string, any>

/** Loads the raw rows plus the contractor names, in one place. */
export async function fetchOutgoingLoads(db: any) {
  const { data: deliveries } = await db
    .from('deliveries')
    .select('id, delivery_date, contractor_id, products, qty, status, sales_type, ' +
            'replacement_from_van, customer_name, stock_out, stock_out_at, stock_out_by')
    .in('status', LOADED_STATUSES as unknown as string[])

  const { data: contractors } = await db.from('contractors').select('id, name')

  const nameById = new Map<string, string>(
    (contractors || []).map((c: Row) => [c.id, c.name]),
  )

  const rows: Row[] = deliveries || []
  const dates = [...new Set(rows.map(r => r.delivery_date).filter(Boolean))].sort()

  return { rows, nameById, dates }
}

/**
 * Groups rows into per-contractor, per-product loads for one or more days.
 *
 * Products merge within a contractor because the storekeeper counts a pile of
 * one product onto the van, not individual order lines - the same reasoning as
 * the returns screen. Unlike returns there is no settlement kind to keep
 * apart: an outgoing unit is just a unit, whoever it is destined for.
 */
export function buildOutgoingData(rows: Row[], nameById: Map<string, string>): OutgoingContractor[] {
  const byContractorDay = new Map<string, OutgoingContractor>()

  for (const row of rows) {
    const qty = outgoingQty(row)
    // Nothing physically leaves on this row, so there is nothing to count.
    if (qty <= 0) continue

    const contractorId = row.contractor_id
    if (!contractorId) continue

    const product = String(row.products || '').trim()
    if (!product) continue

    const dayKey = `${contractorId}::${row.delivery_date}`
    let contractor = byContractorDay.get(dayKey)
    if (!contractor) {
      contractor = {
        id: contractorId,
        name: nameById.get(contractorId) || 'Unknown',
        date: row.delivery_date,
        totalQty: 0,
        pendingQty: 0,
        products: [],
      }
      byContractorDay.set(dayKey, contractor)
    }

    const validated = row.stock_out === true
    const productKey = product.toLowerCase()
    let bucket = contractor.products.find(p => p.key === productKey)
    if (!bucket) {
      bucket = { key: productKey, product, qty: 0, pendingQty: 0, items: [] }
      contractor.products.push(bucket)
    }

    bucket.qty += qty
    contractor.totalQty += qty
    if (!validated) {
      bucket.pendingQty += qty
      contractor.pendingQty += qty
    }

    bucket.items.push({
      id: row.id,
      product,
      qty,
      date: row.delivery_date,
      customer: row.customer_name || null,
      status: String(row.status || ''),
      validated,
      validatedAt: row.stock_out_at || null,
      validatedBy: row.stock_out_by || null,
    })
  }

  // Biggest uncounted load first - that is the one worth chasing.
  const list = [...byContractorDay.values()]
  for (const c of list) {
    c.products.sort((a, b) => b.pendingQty - a.pendingQty || a.product.localeCompare(b.product))
  }
  return list.sort((a, b) => b.pendingQty - a.pendingQty || a.name.localeCompare(b.name))
}
