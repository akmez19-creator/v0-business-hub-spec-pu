/**
 * "Has this invoice already been saved?"
 *
 * Lives here, outside the 'use server' file, for one reason: so a test can call
 * the REAL function against the real table. My own rule from the document-
 * upload bug: a test that writes its own correct SQL cannot catch the app's SQL
 * being wrong - it stays green while every insert fails. The guard in
 * `savePurchaseAction` and the early warning on the entry screen both call this,
 * so the two can never disagree about what counts as "the same document".
 *
 * SERVER ONLY - creates the admin client. Never import from a client component.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { supplierKey } from './supplier-identity'

export interface ExistingPurchase {
  id: string
  docRef: string
  purchaseDate: string
  lineCount: number
  /** Sum of qty x net unit price, excluding VAT - the same basis every screen uses. */
  total: number
}

/**
 * Case- and whitespace-insensitive: "qn2613500 " is the same reference as
 * "QN2613500". Wildcards in the typed reference are escaped so `ilike` behaves
 * as equality - "QN261350%" must not match anything.
 */
export async function findExistingPurchase(
  supplierId: string | null | undefined,
  docRef: string | null | undefined,
): Promise<ExistingPurchase | null> {
  const ref = (docRef ?? '').trim()
  if (!supplierId || !ref) return null

  const db = createAdminClient()
  const { data: purchases, error } = await db
    .from('local_purchases')
    .select('id, doc_ref, purchase_date,net_total')
    .eq('supplier_id', supplierId)
    .eq('ref_key', supplierKey(ref))
    .order('created_at', { ascending: true }).order('id')
    .limit(1)
  if (error) throw new Error(`Duplicate check failed: ${error.message}`)
  const hit = purchases?.[0]
  if (!hit) return null

  const lines = await fetchAll<{ qty: number; unit_price_net: number }>((from, to) =>
    db.from('local_purchase_lines').select('qty,unit_price_net').eq('purchase_id', hit.id).order('id').range(from, to))
  const total = hit.net_total == null ? lines.reduce((t, l) => t + Number(l.qty) * Number(l.unit_price_net), 0) : Number(hit.net_total)

  return {
    id: hit.id as string,
    docRef: (hit.doc_ref as string) ?? ref,
    purchaseDate: String(hit.purchase_date ?? '').slice(0, 10),
    lineCount: lines?.length ?? 0,
    total: Math.round(total * 100) / 100,
  }
}
