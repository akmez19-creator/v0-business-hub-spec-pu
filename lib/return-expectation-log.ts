import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { incomingToStore, isFollowUp, type IncomingRow } from '@/lib/stock-direction'

/**
 * Records WHICH PRODUCT EACH CLIENT OWES BACK, and flags it when the answer
 * differs from what the old rule would have said.
 *
 * Why this exists: the naming rule became status-aware, which silently changes
 * the product named on 9 live rows - 2 of them to a completely different item.
 * Without a log the storekeeper just sees a different product than yesterday
 * with no explanation, on someone else's order.
 *
 * Deliberately NOT in stock-direction.ts, which stays pure so the client
 * bundle and the tests can import it.
 */

export interface LoggableRow extends IncomingRow {
  id: string
  customer_name?: string | null
}

/** What the OLD rule said: return_product for a follow-up, else products. */
function legacyProduct(row: LoggableRow): string | null {
  return (isFollowUp(row.sales_type) ? row.return_product || row.products : row.products) || null
}

/**
 * Writes one row per delivery. Best-effort and never throws: a failed audit
 * write must not stop a storekeeper from counting his stock.
 *
 * Only logs rows whose expectation CHANGED, so the table stays a record of
 * differences rather than a copy of every delivery on every page load.
 */
export async function logReturnExpectations(rows: LoggableRow[]): Promise<void> {
  if (!rows.length) return

  try {
    const admin = createAdminClient()

    const entries = rows.map(row => {
      const incoming = incomingToStore(row)
      const previous = legacyProduct(row)
      const expected = incoming?.product ?? null

      // Compared case-insensitively: a spelling difference is not a change of
      // expectation, and `IN: x` vs `x` is the same physical item.
      const same = (expected || '').toLowerCase().trim() === (previous || '').toLowerCase().trim()

      let reason: string | null = null
      if (!incoming) {
        const status = (row.status || '').toLowerCase()
        if (status !== 'cms' && status !== 'delivered') reason = 'Not out yet - nothing can have come back'
        else if ((row.sales_type || '').toLowerCase() === 'refund') reason = 'Refund with the client missed - nothing was handed over'
        else reason = 'Nothing comes back on this row'
      } else if (incoming.kind === 'cms' && isFollowUp(row.sales_type)) {
        reason = 'Client missed, so they kept their old item - the replacement came back instead'
      } else if (incoming.kind === 'collected') {
        reason = "Follow-up completed - the client's own item was handed over"
      }

      return {
        delivery_id: row.id,
        customer_name: row.customer_name ?? null,
        sales_type: row.sales_type ?? null,
        delivery_status: row.status ?? null,
        products: row.products ?? null,
        return_product: row.return_product ?? null,
        expected_product: expected,
        expected_qty: incoming?.qty ?? null,
        expected_kind: incoming?.kind ?? 'none',
        previous_product: previous,
        changed: !same,
        reason,
      }
    }).filter(e => e.changed)

    if (!entries.length) return

    // Do not re-log an expectation already recorded for this delivery with the
    // same outcome, or every page load appends a duplicate.
    const ids = entries.map(e => e.delivery_id)
    const { data: seen } = await admin
      .from('return_expectation_log')
      .select('delivery_id, expected_product, expected_kind')
      .in('delivery_id', ids)

    const already = new Set(
      (seen || []).map(s => `${s.delivery_id}::${(s.expected_product || '').toLowerCase()}::${s.expected_kind}`),
    )

    const fresh = entries.filter(
      e => !already.has(`${e.delivery_id}::${(e.expected_product || '').toLowerCase()}::${e.expected_kind}`),
    )
    if (!fresh.length) return

    await admin.from('return_expectation_log').insert(fresh)
  } catch (err) {
    console.log('[v0] return expectation log skipped:', err instanceof Error ? err.message : err)
  }
}
