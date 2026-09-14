/**
 * SERVER-ONLY. Reads China import history and stock so a local quotation can be
 * cross-checked against what we already pay and already hold.
 *
 * Pure maths lives in `./vat.ts` - import that from client components, never
 * this file (it pulls in the admin Supabase client).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { chooseChinaReference } from './vat'
import type { ChinaCostRef, ChinaCostRow } from './vat'

/** Stock + naming for a product, for display beside a quotation line. */
export interface ProductRef {
  id: string
  name: string
  stockOnHand: number | null
  imageUrl: string | null
  hasVariants?: boolean
}

/**
 * The China landed cost to compare against, per product.
 *
 * Gathers EVERY import for the product and hands the choice to the pure
 * `chooseChinaReference`, which takes the newest costed row after discarding
 * price outliers. That outlier step is not theoretical - "Sweeping Robot" has a
 * Rs 3,104/unit PO labelled "Cleaning Cart" sitting alongside its real Rs 131
 * and Rs 133 imports, and it is the newest of the three. See the note on
 * OUTLIER_FACTOR.
 *
 * Rows where `import_cp` is null or 0 are excluded from the reference but still
 * counted in `orderCount` - a PO that was never costed is still evidence we HAVE
 * imported this, so reporting "never imported" would be wrong. If every PO is
 * uncosted, `landedUnitCost` stays 0 and `compareLine` reports no usable
 * reference rather than inventing one.
 */
export async function fetchChinaCostRefs(productIds: string[]): Promise<Map<string, ChinaCostRef>> {
  const out = new Map<string, ChinaCostRef>()
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return out

  const db = createAdminClient()
  const gathered = new Map<string, { rows: ChinaCostRow[]; total: number }>()

  // Chunked: a very long `in` list is rejected by the query planner / URL limit.
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const data = await fetchAll<{ product_id: string | null; product_name: string | null; import_cp: number | null; qty: number | null; supplier_name: string | null; imported_at: string | null; created_at: string | null }>((from, to) => db
      .from('purchase_orders')
      .select('id,product_id,product_name,import_cp,qty,supplier_name,imported_at,created_at')
      .in('product_id', slice).order('id').range(from, to))

    for (const row of data ?? []) {
      const pid = row.product_id as string
      if (!pid) continue
      const slot = gathered.get(pid) ?? { rows: [], total: 0 }
      slot.total += 1
      const cp = Number(row.import_cp) || 0
      if (cp > 0) {
        slot.rows.push({
          landedUnitCost: cp,
          // Normalised to YYYY-MM-DD so string comparison sorts correctly
          // regardless of whether the driver returns a Date or a timestamp.
          importedAt: toDay((row.imported_at as string) ?? (row.created_at as string) ?? null),
          qty: Number(row.qty) || null,
          supplierName: (row.supplier_name as string) ?? null,
          label: (row.product_name as string) ?? null,
        })
      }
      gathered.set(pid, slot)
    }
  }

  for (const [pid, slot] of gathered) {
    out.set(pid, chooseChinaReference(slot.rows, slot.total))
  }
  return out
}

/** Timestamps arrive as Date or string depending on the driver; normalise both. */
function toDay(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/**
 * Stock and display fields for products.
 *
 * `quantity` is the stock column on `products`. NOTE: `cost_price` is NOT used -
 * MEASURED, it is 0 on all 851 products, so the product master cannot answer
 * "what did this cost us" and `purchase_orders.import_cp` is the only real
 * source of a cost.
 */
export async function fetchProductRefs(productIds: string[]): Promise<Map<string, ProductRef>> {
  const out = new Map<string, ProductRef>()
  const ids = [...new Set(productIds.filter(Boolean))]
  if (!ids.length) return out

  const db = createAdminClient()
  for (let index = 0; index < ids.length; index += 200) {
    const data = await fetchAll<{ id: string; name: string; quantity: number | null; image_url: string | null; has_variants: boolean | null }>((from, to) =>
      db.from('products').select('id,name,quantity,image_url,has_variants').in('id', ids.slice(index, index + 200)).order('id').range(from, to))
    for (const row of data) {
      out.set(row.id, { id: row.id, name: row.name ?? '', stockOnHand: row.quantity == null ? null : Number(row.quantity),
        imageUrl: row.image_url ?? null, hasVariants: row.has_variants === true })
    }
  }
  return out
}

/** Every China PO for one product, newest first - the "why" behind a verdict. */
export async function fetchChinaHistory(productId: string, limit = 12) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('purchase_orders')
    .select('id,qty,unit_price,discounted_unit_price,import_cp,total_cp_import,supplier_name,imported_at,created_at')
    .eq('product_id', productId)
    .order('imported_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`China history failed: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: r.id as string,
    qty: Number(r.qty) || 0,
    yuanUnit: Number(r.discounted_unit_price) || Number(r.unit_price) || 0,
    landedUnitCost: Number(r.import_cp) || 0,
    totalLanded: Number(r.total_cp_import) || 0,
    supplierName: (r.supplier_name as string) ?? null,
    importedAt: ((r.imported_at as string) ?? (r.created_at as string) ?? null)?.slice(0, 10) ?? null,
  }))
}
