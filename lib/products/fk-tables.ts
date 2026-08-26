// Every table that points at products, read off the live schema rather than
// remembered. The delete path only models the seven that BLOCK a delete; a
// merge has to move all seventeen, including the cascade-only ones - those hold
// the photos, and letting them cascade away with the loser would strip the
// merged product of the images the photo stock-count matches against.

export type FkTable = {
  table: string
  column: string
  /**
   * The other columns in a unique index alongside the product column. A row
   * whose twin already exists on the winner is left behind instead of forced.
   */
  uniqueWith?: string[]
  /**
   * Table has its own copy of the product name for display. It must follow the
   * product to the winner or the row keeps captioning itself with the merged-
   * away name.
   *
   * purchase_orders is deliberately excluded: its product_name is a historical
   * record of what was actually ordered on that invoice, not a display cache.
   */
  syncsName?: boolean
}

export const PRODUCTS_FK_TABLES: FkTable[] = [
  // History and orders - the reason the duplicate matters at all.
  { table: 'purchase_orders', column: 'product_id' },
  { table: 'deliveries', column: 'product_id' },
  { table: 'stock_movements', column: 'product_id' },
  // Guarded by an explicit pre-check in mergeProducts; listed here so the
  // unique index can never be violated even if that check is ever loosened.
  { table: 'stock_count_items', column: 'product_id', uniqueWith: ['count_id'] },
  { table: 'stock_count_captures', column: 'matched_product_id' },

  // Facebook-owned rows carrying a guessed product match.
  { table: 'page_post_ads', column: 'product_id' },
  { table: 'page_comments', column: 'product_id' },
  { table: 'messenger_conversations', column: 'product_id' },
  { table: 'ad_tests', column: 'product_id' },
  { table: 'campaign_product_links', column: 'product_id' },
  { table: 'post_ad_sync', column: 'product_id' },

  // Cascade-only tables. These would be destroyed with the loser, so moving
  // them is the entire reason a merge is not just a delete.
  { table: 'product_images', column: 'product_id', uniqueWith: ['image_url'], syncsName: true },
  { table: 'product_image_scores', column: 'product_id', uniqueWith: ['image_url'] },
  { table: 'product_links', column: 'product_id', uniqueWith: ['url'], syncsName: true },
  { table: 'product_variants', column: 'product_id', uniqueWith: ['attribute_name', 'attribute_value'] },
  { table: 'product_posts', column: 'product_id', syncsName: true },
  // alias_name is unique globally rather than per product, so re-pointing the
  // product can never collide.
  { table: 'product_aliases', column: 'product_id' },
]
