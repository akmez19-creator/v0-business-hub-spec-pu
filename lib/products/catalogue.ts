import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { createProductMatcher, type ProductMatcher } from './match'

// The catalogue is ~276 products and ~104 aliases and changes rarely, but the
// matcher tokenises every product name when it is built. Rebuilding that per
// request would be wasted work on a list view that resolves hundreds of
// labels, so it is memoised for a few minutes.
const TTL_MS = 5 * 60 * 1000

let cached: { matcher: ProductMatcher; at: number } | null = null
let loading: Promise<ProductMatcher> | null = null

async function load(): Promise<ProductMatcher> {
  const db = createAdminClient()
  const [{ data: products }, { data: aliases }] = await Promise.all([
    db.from('products').select('id, name, category'),
    db.from('product_aliases').select('alias_name, product_id'),
  ])
  const matcher = createProductMatcher(products ?? [], aliases ?? [])
  cached = { matcher, at: Date.now() }
  return matcher
}

/**
 * Shared product matcher. Never throws: on failure it returns a matcher that
 * resolves nothing, so attribution degrades to the raw label rather than
 * taking the whole inbox down.
 */
export async function getProductMatcher(): Promise<ProductMatcher> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.matcher
  if (!loading) {
    loading = load()
      .catch((error) => {
        console.log('[v0] catalogue: load failed', error)
        return (() => null) as ProductMatcher
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}
