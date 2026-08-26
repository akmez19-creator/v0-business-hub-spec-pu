/**
 * NWD = "not wanted on delivery". The goods WENT OUT and were refused.
 *
 * Owner confirmed (26 Aug 2026): they STAY ON THE RIDER'S VAN, they do not come
 * back to the store that evening. Two consequences drive this whole file:
 *
 *  1. NWD must NEVER be counted as store stock. `incomingToStore()` in
 *     lib/stock-direction.ts already excludes it, and the storekeeper screen
 *     shows it as read-only "nothing moved yet". Do not make it tickable there.
 *
 *  2. NWD CARRIES OVER. Because nothing collects it, the units are still on the
 *     van tomorrow and the day after. A single-date query therefore CANNOT show
 *     a rider what he is carrying - which is exactly the bug this fixes: all 58
 *     live NWD rows sit on 24 Aug, so on 26 Aug both stock screens showed the
 *     rider ZERO while 63 units rode around with him.
 */
import { returnMergeKey, pickDisplayLabel } from '@/lib/returns-merge'

/**
 * ONLY `nwd`. Deliberately NOT `cancelled`.
 *
 * The rider screen used to test `status === 'nwd' || status === 'cancelled'`
 * and add both to one `nwdQty`. Cancelled work NEVER LEFT THE BUILDING (see
 * day-closure notes: moving cancelled rows resurrects dead work), so counting
 * it told the rider he was carrying stock he had never been given. Small today
 * - 2 live rows - but it is a false statement about physical goods, and it
 * would grow every time an order is cancelled.
 */
export function isOnVan(status?: string | null): boolean {
  return status === 'nwd'
}

export interface VanRow {
  id: string
  product?: string | null
  qty?: number | null
  status?: string | null
  deliveryDate: string
  customerName?: string | null
}

export interface VanPile {
  key: string
  /** A spelling that exists verbatim in the data - never invented. */
  label: string
  /** Units sitting on the van for this product. */
  qty: number
  /** How many separate refused orders make up the pile. */
  orderCount: number
  /** Distinct dates involved, newest first. Drives the "carried over" note. */
  dates: string[]
  /** True when any unit has been on the van since before the active date. */
  carriedOver: boolean
  rows: VanRow[]
}

/**
 * Merge refused units into ONE ROW PER PRODUCT.
 *
 * Uses the SAME `returnMergeKey` as the storekeeper's pile view, so "1x Make Up
 * Pen" and "Make Up Pen" collapse identically on every screen. Keeping a second
 * private copy of that rule is how the storekeeper and contractor views drifted
 * apart before.
 *
 * `activeDate` only classifies a pile as carried-over; it never filters. Pass
 * the date the screen is showing.
 */
export function buildVanPiles(rows: VanRow[], activeDate: string): VanPile[] {
  const piles = new Map<string, { labels: string[]; rows: VanRow[]; qty: number }>()

  for (const r of rows) {
    if (!isOnVan(r.status)) continue
    const key = returnMergeKey(r.product)
    if (!key) continue

    if (!piles.has(key)) piles.set(key, { labels: [], rows: [], qty: 0 })
    const p = piles.get(key)!
    p.labels.push((r.product || '').trim())
    p.rows.push(r)
    // Floor at 1, matching `incomingToStore()` and the outbound sheets: a row
    // that exists represents at least one physical item.
    p.qty += Math.max(1, Number(r.qty) || 0)
  }

  return [...piles.entries()]
    .map(([key, p]) => {
      const dates = [...new Set(p.rows.map(r => r.deliveryDate).filter(Boolean))].sort().reverse()
      return {
        key,
        label: pickDisplayLabel(p.labels),
        qty: p.qty,
        orderCount: p.rows.length,
        dates,
        carriedOver: dates.some(d => d < activeDate),
        rows: p.rows,
      }
    })
    // Oldest first: stock that has been stuck on the van longest is the most
    // urgent to clear, so it must not be buried under today's refusals.
    .sort((a, b) => {
      const ao = a.dates[a.dates.length - 1] || ''
      const bo = b.dates[b.dates.length - 1] || ''
      if (ao !== bo) return ao.localeCompare(bo)
      if (b.qty !== a.qty) return b.qty - a.qty
      return a.label.localeCompare(b.label)
    })
}

/** Total units on the van. */
export function vanTotal(piles: VanPile[]): number {
  return piles.reduce((s, p) => s + p.qty, 0)
}

/** Units that have been on the van since before the active date. */
export function carriedOverTotal(piles: VanPile[], activeDate: string): number {
  return piles.reduce(
    (s, p) => s + p.rows
      .filter(r => r.deliveryDate < activeDate)
      .reduce((n, r) => n + Math.max(1, Number(r.qty) || 0), 0),
    0,
  )
}

/** `2026-08-24` -> `24 Aug`. Empty string in, empty string out. */
export function shortDate(d?: string | null): string {
  if (!d) return ''
  const dt = new Date(`${d}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
