/**
 * Products that never made it onto the van, and therefore cannot come back.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 *
 * `incomingToStore()` reads a CMS row as "this went out and came straight
 * back". That is right almost always, and wrong exactly when the rider was
 * never given the goods in the first place. The shortage is recorded on
 * `contractor_daily_stock` (per contractor, per day, per product) and nothing
 * on the delivery row mentions it, so both returns screens went on asking for
 * units that had never left the store.
 *
 * Live on 24 Aug: AZHAR was down 2 LED Faucets and 2 IP Cameras, Thierry 1 LED
 * Faucet, and all of those orders came back CMS. Seven units were on the
 * storekeeper's counting screen that physically did not exist.
 *
 * WHY IT IS SHARED
 *
 * Three screens ask the same question and must agree to the unit:
 *   - the storekeeper's Stock In      ("what am I counting?")
 *   - the contractor/rider Returns    ("what do I owe back?")
 *   - the admin's Stock Validation    ("what did nobody ever count?")
 * The admin screen exists to be believed when it says a unit is missing, so a
 * phantom unit there is worse than useless.
 *
 * WHAT THIS IS NOT
 *
 * This does not restock anything and does not forgive anything. The units are
 * still missing from the warehouse - that is the shortage report's job, on the
 * admin availability screen. This only stops the RIDER being asked to hand
 * back something he was never handed.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { returnableAfterShortfall } from './stock-direction'
import { returnMergeKey } from './returns-merge'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** contractorId | date | normalised product -> units that can still come back. */
export type ShortfallCaps = Map<string, number>

/** A shortage the rider has reported but no admin has ruled on yet. */
export interface PendingShortfall {
  /** Units the rider says he never received. */
  units: number
  product: string
}

/**
 * The two halves of the picture, deliberately kept apart.
 *
 * `caps` only ever contains CONFIRMED shortages, because a cap HIDES stock
 * from the storekeeper's count. `pending` contains reported-but-unreviewed
 * ones, which are shown with a warning instead - the storekeeper still counts
 * them, but he is told not to tear the shelf apart looking.
 *
 * Nothing is ever removed from a storekeeper's list on a rider's word alone.
 */
export interface ShortfallInfo {
  caps: ShortfallCaps
  pending: Map<string, PendingShortfall>
}

export function shortfallKey(
  contractorId: string | null | undefined,
  date: string | null | undefined,
  product: string | null | undefined,
): string {
  return `${contractorId || ''}|${date || ''}|${returnMergeKey(product || '')}`
}

/**
 * Builds the per-van, per-day, per-product cap on what can physically return.
 *
 * A shortage only reaches `caps` once an ADMIN has confirmed it, because a cap
 * hides stock from the storekeeper's count. Reported-but-unreviewed rows go to
 * `pending` and are merely flagged.
 *
 * Absent from the map = nothing confirmed = behave exactly as before. Only
 * genuinely short rows are ever inserted, so this cannot change a normal day.
 */
export async function fetchShortfallCaps(adminDb: any): Promise<ShortfallInfo> {
  const caps: ShortfallCaps = new Map()
  const pending = new Map<string, PendingShortfall>()

  // THE ROW CAP - AND THIS FUNCTION ALREADY FELL INTO IT ONCE.
  //
  // PostgREST silently returns at most 1000 rows and reports no error. This
  // table holds ~2100, so reading it and filtering here dropped ~1100 rows
  // without a word. An admin-CONFIRMED shortage sitting in that tail never
  // reached the map at all: AZHAR's 2 IP Cameras stayed on both returns
  // screens after being confirmed, and the confirm button looked broken.
  //
  // `.range(0, 49_999)` does NOT fix it - measured, still exactly 1000 rows.
  // The comparison is therefore done in SQL by get_stock_shortfalls(), which
  // returns only the ~33 genuinely short rows and cannot be truncated.
  //
  // NOT filtered on `is_validated`, deliberately. The admin shortage screen
  // lists every short row, so filtering here would let an admin confirm a row
  // this function cannot see (2 such rows exist today) - the same silent
  // no-op. An unvalidated row cannot invent a shortage anyway: until the rider
  // validates, `received_qty` is a copy of `expected_qty`, so it is not short.
  const { data, error } = await adminDb.rpc('get_stock_shortfalls')

  if (error || !data) return { caps, pending }

  for (const r of data as any[]) {
    const expected = Number(r.expected_qty ?? 0)
    const received = Number(r.received_qty ?? 0)
    // Not short: nothing to cap. Leaving these out keeps the map tiny and
    // guarantees an ordinary day takes the untouched code path.
    if (!Number.isFinite(received) || received >= expected) continue

    const key = shortfallKey(r.contractor_id, r.stock_date, r.product)

    // REJECTED: an admin ruled the goods really did go out. Treat the row as
    // an ordinary day - the units belong back on the storekeeper's count.
    if (r.shortfall_review === 'rejected') continue

    // AWAITING REVIEW: flag it, but do NOT cap. Hiding stock on an unreviewed
    // report would let a mistaken or dishonest rider erase expected units with
    // nobody signing for it.
    if (r.shortfall_review !== 'confirmed') {
      const units = expected - received
      const prev = pending.get(key)
      pending.set(key, {
        units: Math.max(prev?.units ?? 0, units),
        product: r.product,
      })
      continue
    }

    // CONFIRMED by an admin - this is the only path that hides anything.
    const returnable = returnableAfterShortfall(received, Number(r.delivered_qty ?? 0))
    // Several rows can share a product on one van-day; the tightest cap wins.
    const prev = caps.get(key)
    caps.set(key, prev === undefined ? returnable : Math.min(prev, returnable))
  }

  return { caps, pending }
}

/** Reported-but-unreviewed shortage for a line, or null. Drives the warning. */
export function pendingShortfallFor(
  info: ShortfallInfo | undefined,
  contractorId: string | null | undefined,
  date: string | null | undefined,
  product: string | null | undefined,
): PendingShortfall | null {
  if (!info || info.pending.size === 0) return null
  return info.pending.get(shortfallKey(contractorId, date, product)) ?? null
}

/** A line the screens were told to expect back. */
export interface CappableItem {
  qty: number
  contractorId?: string | null
  date?: string | null
  product?: string | null
  /** Only plain unsold returns are capped - see applyShortfallCaps(). */
  isCms: boolean
}

/**
 * Trims a list of expected returns down to what can physically arrive.
 *
 * Applied per product per van-day, oldest line first, so a partial shortage
 * removes whole lines from one end instead of shaving a fraction off every
 * line and leaving several impossible-to-count part-rows.
 *
 * ONLY plain CMS lines are capped. An item COLLECTED off a client on a
 * completed trade-in or exchange came from the client's house, not from the
 * warehouse shelf, so a shortage on the outbound product says nothing about
 * whether it arrives.
 */
export function applyShortfallCaps<T extends CappableItem>(
  items: T[],
  caps: ShortfallCaps,
): { items: T[]; removed: number } {
  if (caps.size === 0) return { items, removed: 0 }

  const remaining = new Map<string, number>()
  let removed = 0

  const out = items.map(item => {
    if (!item.isCms || item.qty <= 0) return item

    const key = shortfallKey(item.contractorId, item.date, item.product)
    if (!caps.has(key)) return item

    if (!remaining.has(key)) remaining.set(key, caps.get(key) ?? 0)
    const left = remaining.get(key) ?? 0

    const allowed = Math.min(item.qty, left)
    remaining.set(key, left - allowed)
    if (allowed === item.qty) return item

    removed += item.qty - allowed
    return { ...item, qty: allowed }
  })

  // A line capped to zero is not a return at all - drop it rather than show a
  // "0 units" row the storekeeper cannot act on.
  return { items: out.filter(i => i.qty > 0), removed }
}
