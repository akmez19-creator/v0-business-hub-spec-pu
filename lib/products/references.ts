import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tables that reference products with ON DELETE NO ACTION.
 *
 * They split into two genuinely different kinds, and conflating them is what
 * made deletion impossible for products whose only "history" was a guess:
 *
 * - 'history' - things that HAPPENED in this business: purchase orders,
 *   deliveries, stock movements, stock counts. The product is part of the
 *   record's meaning. Never detachable; deleting or unlinking loses a fact
 *   nothing can recover.
 *
 * - 'link'    - Facebook-owned rows (ads, comments, conversations) that the
 *   sync ANNOTATES with a best-guess product_id via createProductMatcher()
 *   in lib/facebook/post-ads.ts. The row belongs to the ad, not the product:
 *   product_id is nullable and most rows legitimately have none (402 of 2132
 *   ad rows, 1364 of 1554 comments). Clearing it loses only the guess - the
 *   ad, its campaign and its metrics are untouched, and a re-sync recomputes
 *   the match for every product that still exists.
 *
 * Verified against the live schema. The remaining referencing tables are
 * ON DELETE CASCADE (product_images, product_variants, product_aliases,
 * product_links, product_posts, product_image_scores) or ON DELETE SET NULL
 * (ad_tests, campaign_product_links, post_ad_sync, stock_count_captures);
 * those clean themselves up and must NOT be listed here.
 */
export type ReferenceKind = 'history' | 'link'

/**
 * What a FORCED delete does to this reference. Chosen per table by what
 * survives afterwards, not by convenience:
 *
 * - 'unlink' - the row stays and stays READABLE without the product, because
 *   it carries its own copy of what mattered (purchase_orders.product_name;
 *   ads/comments own all their content). Only the pointer is cleared.
 * - 'delete' - the row CANNOT survive: stock_count_items has no name of its
 *   own (the review screen joins products.name), so an unlinked count line
 *   renders as "Unknown product". Destructive, and only ever on explicit
 *   per-product confirmation that names what is being erased.
 * - 'block'  - never forced. Deliveries and stock movements were not part of
 *   any decision to relax, so they still refuse the delete outright.
 */
export type RemovalPolicy = 'unlink' | 'delete' | 'block'

export const PRODUCT_BLOCKING_TABLES: Array<{
  table: string
  column: string
  /** Singular label, shown to the user. */
  label: string
  plural: string
  kind: ReferenceKind
  removal: RemovalPolicy
  /**
   * Only rows matching this count as a reference. Used where the FK alone
   * doesn't decide it - see stock_count_captures below.
   */
  filter?: { column: string; value: string }
}> = [
  // Keeps product_name, so the order stays readable with no product behind it.
  { table: 'purchase_orders', column: 'product_id', label: 'purchase order', plural: 'purchase orders', kind: 'history', removal: 'unlink' },
  { table: 'deliveries', column: 'product_id', label: 'delivery', plural: 'deliveries', kind: 'history', removal: 'block' },
  { table: 'stock_movements', column: 'product_id', label: 'stock movement', plural: 'stock movements', kind: 'history', removal: 'block' },
  // No name column - unlinking would leave "Unknown product" lines inside
  // already-APPROVED count sessions, so a forced delete removes them instead.
  { table: 'stock_count_items', column: 'product_id', label: 'stock count entry', plural: 'stock count entries', kind: 'history', removal: 'delete' },
  // The photo behind a count. The FK is ON DELETE SET NULL, so this looks
  // self-cleaning - but CHECK resolved_has_product forbids a RESOLVED capture
  // from losing its product, so Postgres rejects the delete with a raw
  // constraint error the pre-flight check never predicted. Only resolved rows
  // are affected; the rest genuinely do clean themselves up.
  {
    table: 'stock_count_captures',
    column: 'matched_product_id',
    label: 'stock count photo',
    plural: 'stock count photos',
    kind: 'history',
    removal: 'delete',
    filter: { column: 'status', value: 'resolved' },
  },
  { table: 'page_post_ads', column: 'product_id', label: 'linked ad', plural: 'linked ads', kind: 'link', removal: 'unlink' },
  { table: 'page_comments', column: 'product_id', label: 'linked comment', plural: 'linked comments', kind: 'link', removal: 'unlink' },
  {
    table: 'messenger_conversations',
    column: 'product_id',
    label: 'linked conversation',
    plural: 'linked conversations',
    kind: 'link',
    removal: 'unlink',
  },
]

export type ProductReference = {
  table: string
  label: string
  plural: string
  count: number
  kind: ReferenceKind
  removal: RemovalPolicy
}

/**
 * Count the history rows that would block deleting these products.
 *
 * Returns only non-zero entries. A table that errors (missing/permission) is
 * treated as BLOCKING with an unknown count rather than skipped: assuming
 * "no rows" from a failed read is how history gets deleted by accident.
 */
export async function findProductReferences(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<{ references: ProductReference[]; unreadable: string[] }> {
  const references: ProductReference[] = []
  const unreadable: string[] = []
  if (!productIds.length) return { references, unreadable }

  await Promise.all(
    PRODUCT_BLOCKING_TABLES.map(async ref => {
      // Count on the FK column, never on 'id': page_comments and page_post_ads
      // have no 'id' column, and selecting it errors - which this function
      // (correctly) treats as "unreadable", blocking every delete.
      let query = supabase.from(ref.table).select(ref.column, { count: 'exact', head: true }).in(ref.column, productIds)
      if (ref.filter) query = query.eq(ref.filter.column, ref.filter.value)
      const { count, error } = await query

      if (error) {
        unreadable.push(ref.table)
        return
      }
      if (count && count > 0) {
        references.push({
          table: ref.table,
          label: ref.label,
          plural: ref.plural,
          count,
          kind: ref.kind,
          removal: ref.removal,
        })
      }
    }),
  )

  references.sort((a, b) => b.count - a.count)
  return { references, unreadable }
}

// Detaching + deleting lives in lib/products/delete-tx.ts, which does both in
// ONE transaction. A step-by-step version was removed deliberately: it could
// commit the erasing and then have the delete refused, destroying records for
// nothing. Do not reintroduce a non-transactional detach here.

/** "1 purchase order and 6 ad posts" */
export function describeReferences(references: ProductReference[]): string {
  const parts = references.map(r => `${r.count} ${r.count === 1 ? r.label : r.plural}`)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
