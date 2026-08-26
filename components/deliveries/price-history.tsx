'use client'

import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

/**
 * The price log for one product, shown inside the Edit Product dialog.
 *
 * The dialog holds a single copy of each price, so typing a new figure over the
 * old one used to erase any trace that the old one existed. Rows here are
 * written by a database trigger (see the product_price_history migration), so
 * they cover every writer - this dialog, the Product Master promo field, a CSV
 * import, a manual SQL fix.
 *
 * Existing rows cannot be edited or deleted from the app: the table has only a
 * SELECT policy. The one way to add a line by hand is log_backfilled_price(),
 * a SECURITY DEFINER function that can only ever APPEND, and every row it
 * writes is flagged backfilled and shown as "entered by hand".
 */

interface PriceHistoryRow {
  id: string
  changed_at: string
  changed_by: string | null
  old_price: number | string | null
  new_price: number | string | null
  old_bundle_prices: Record<string, number | string> | null
  new_bundle_prices: Record<string, number | string> | null
  old_is_b1g1: boolean | null
  new_is_b1g1: boolean | null
  old_promo_price: number | string | null
  new_promo_price: number | string | null
  /**
   * Typed in from memory rather than observed by the trigger. Shown as such:
   * a remembered figure and a recorded one must not read the same, or a number
   * nobody can verify starts carrying the authority of one the system watched.
   */
  backfilled: boolean | null
  /** Roughly when it changed, if known. Null is normal - see occurred_on. */
  occurred_on: string | null
}

const money = (v: number | string | null | undefined) =>
  `Rs ${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

const num = (v: number | string | null | undefined) => Number(v || 0)

/**
 * Turn one logged row into the specific things that changed.
 *
 * A single save can move several prices at once, so this returns a list rather
 * than one sentence - collapsing them would hide a tier change that happened
 * alongside a unit-price change.
 */
function describe(row: PriceHistoryRow): string[] {
  const out: string[] = []

  if (num(row.old_price) !== num(row.new_price)) {
    // A product moving to set-only pricing has its unit price zeroed, which is
    // a real event but reads as nonsense phrased as "Rs 675 -> Rs 0".
    if (num(row.new_price) === 0) out.push(`Unit price ${money(row.old_price)} removed (now sold in sets)`)
    else if (num(row.old_price) === 0) out.push(`Unit price set to ${money(row.new_price)}`)
    else out.push(`Unit price ${money(row.old_price)} → ${money(row.new_price)}`)
  }

  const oldB = row.old_bundle_prices || {}
  const newB = row.new_bundle_prices || {}
  const sizes = [...new Set([...Object.keys(oldB), ...Object.keys(newB)])].sort(
    (a, b) => Number(a) - Number(b),
  )
  for (const size of sizes) {
    const before = oldB[size]
    const after = newB[size]
    const label = `Set of ${size}`
    if (before == null && after != null) out.push(`${label} added at ${money(after)}`)
    else if (before != null && after == null) out.push(`${label} removed (was ${money(before)})`)
    else if (num(before) !== num(after)) out.push(`${label} ${money(before)} → ${money(after)}`)
  }

  if (num(row.old_promo_price) !== num(row.new_promo_price)) {
    if (num(row.new_promo_price) === 0) out.push(`Promo price ${money(row.old_promo_price)} cleared`)
    else out.push(`Promo price ${money(row.old_promo_price)} → ${money(row.new_promo_price)}`)
  }

  // Same money, different offer - the structure change is the point, which is
  // why the trigger records it at all.
  if (!!row.old_is_b1g1 !== !!row.new_is_b1g1) {
    out.push(row.new_is_b1g1 ? 'B1G1 offer turned on' : 'B1G1 offer turned off')
  }

  return out
}

const when = (iso: string) => {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function PriceHistory({ productId }: { productId: string }) {
  const [rows, setRows] = useState<PriceHistoryRow[] | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('product_price_history')
        .select(
          'id, changed_at, changed_by, old_price, new_price, old_bundle_prices, new_bundle_prices, old_is_b1g1, new_is_b1g1, old_promo_price, new_promo_price, backfilled, occurred_on',
        )
        .eq('product_id', productId)
        .order('changed_at', { ascending: false })
        .limit(20)
      // Re-sorted by WHEN THE CHANGE HAPPENED, not when the row was written.
      // A backfilled 2024 price is typed today, so ordering by changed_at
      // would park a years-old price at the top of the timeline. Undated
      // backfills keep changed_at and land wherever they were entered.
      const ordered = (data ?? []).slice().sort((a, b) => {
        const at = new Date(a.occurred_on || a.changed_at).getTime()
        const bt = new Date(b.occurred_on || b.changed_at).getTime()
        return bt - at
      })
      if (alive) setRows(ordered)
    })()
    return () => {
      alive = false
    }
  }, [productId])

  // Nothing to say yet. Deliberately renders NOTHING rather than "no history":
  // an empty log is the normal state for a product whose price never moved, and
  // a permanent empty panel in the dialog would just be noise.
  if (!rows || rows.length === 0) return null

  const entries = rows
    .map((r) => ({ row: r, changes: describe(r) }))
    .filter((e) => e.changes.length > 0)
  if (entries.length === 0) return null

  const shown = expanded ? entries : entries.slice(0, 3)

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium text-muted-foreground">Price history</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {shown.map(({ row, changes }) => (
          <li key={row.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-pretty text-foreground">
              {changes.join(' · ')}
              {row.backfilled && (
                <span
                  className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                  title="Typed in from memory, not observed by the system"
                >
                  entered by hand
                </span>
              )}
            </span>
            {/* A backfilled row is dated when it HAPPENED if the person knew,
                falling back to "undated" - never to changed_at, which is the
                moment it was typed and would date a years-old price to today. */}
            {row.backfilled && !row.occurred_on ? (
              <span className="shrink-0 text-muted-foreground">undated</span>
            ) : (
              <time
                dateTime={row.occurred_on || row.changed_at}
                className="shrink-0 tabular-nums text-muted-foreground"
                title={
                  row.occurred_on
                    ? `Recorded on ${new Date(row.changed_at).toLocaleString('en-GB')}`
                    : new Date(row.changed_at).toLocaleString('en-GB')
                }
              >
                {when(row.occurred_on || row.changed_at)}
                {row.occurred_on ? ' (approx)' : ''}
              </time>
            )}
          </li>
        ))}
      </ul>
      {entries.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded ? 'Show less' : `Show ${entries.length - 3} older`}
        </button>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Past orders keep the price they were sold at - changing a price here only affects new orders.
      </p>
    </div>
  )
}
