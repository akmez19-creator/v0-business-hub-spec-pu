import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { SourcingGuard, SourcingPreference } from './1688-sourcing-types'
import type { ReorderLine, ImportReference } from './workflow'
import { offerIdFrom } from './1688-comparison'

export const PREFERENCE_COLUMNS = 'product_id,link_id,offer_id,supplier_id,supplier_name,listing_url,revision,selected_by,selected_at'
export async function loadSourcingPreferences(db: SupabaseClient) {
  return fetchAll<SourcingPreference>((from, to) => db.from('product_1688_preferences').select(PREFERENCE_COLUMNS).order('product_id').range(from, to))
}
export async function sourcingGuard(db: SupabaseClient, itemId: string): Promise<SourcingGuard> {
  const { data, error } = await db.rpc('import_1688_guard', { p_item: itemId })
  if (error || !data) throw new Error('The saved product or its Inventory evidence is unavailable. Reload before continuing.')
  return data as SourcingGuard
}
export function purchasingSource(line: ReorderLine, reference: ImportReference | null, preference?: SourcingPreference | null) {
  const chosen = offerIdFrom(line.listingUrl)
  const copied = offerIdFrom(line.sourceSnapshot?.link ?? reference?.link ?? null)
  if (chosen && chosen !== copied) return { url: line.listingUrl, supplier: line.sourceSnapshot?.supplier_name ?? '', preference: null }
  if (preference) return { url: preference.listing_url, supplier: preference.supplier_name, preference }
  return { url: reference?.link || line.sourceSnapshot?.link || line.listingUrl || null, supplier: reference?.supplier_name || '', preference: null }
}
