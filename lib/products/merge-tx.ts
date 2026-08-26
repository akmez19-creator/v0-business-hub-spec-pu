// Merging a duplicate product into the one that is physically on a shelf.
//
// ONE transaction, always. The delete path learned this the hard way: a
// step-by-step detach over Supabase had already erased a stock count entry when
// the final delete was refused, leaving the worst of both outcomes. A merge
// touches seventeen tables, so a partial one would be far worse - orders moved,
// photos stranded, and the loser still sitting in the catalogue.
import { PRODUCTS_FK_TABLES, type FkTable } from './fk-tables'

/**
 * A refusal the reviewer can act on, as opposed to a database fault. Carries a
 * sentence written for the person merging, and always means nothing changed.
 */
export class MergeBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MergeBlockedError'
  }
}

export type MergeResult = {
  moved: Record<string, number>
  /** Rows left behind because the winner already had an equivalent row. */
  skipped: Record<string, number>
  backfilled: string[]
  winnerName: string
  loserName: string
  /** Set when the surviving product was renamed to the other spelling. */
  finalName: string | null
}

/**
 * Move every reference from loser to winner, backfill the winner's empty
 * metadata, then delete the loser - or roll the whole thing back.
 *
 * The winner's own identity is never overwritten: quantity, zone, shelf_code,
 * last_counted_at and sold_out are what a person established at the shelf, and
 * the loser's figures are exactly the uncounted book numbers this feature
 * exists to retire.
 */
export async function mergeProducts(
  winnerId: string,
  loserId: string,
  /**
   * Which of the two spellings the surviving product should carry.
   *
   * Deliberately separate from which ROW survives. The zoned row wins because
   * someone physically shelved it, but that row is often the one with the typo
   * - "Airfryer Backet" beats "Air Fryer Basket" on zone alone. Forcing the
   * surviving record to also keep its spelling would write the misspelling
   * into the catalogue permanently.
   */
  finalName?: string,
): Promise<MergeResult> {
  if (winnerId === loserId) throw new MergeBlockedError('A product cannot be merged into itself.')

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('No database connection string configured')

  // Lazy, mirroring the delete path: pg ships beside the optional pg-native
  // binary and a failed top-level import would take down every route in here.
  const { Client } = await import('pg')

  const client = new Client({
    connectionString: connectionString.replace(/[?&]sslmode=\w+/, ''),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    await client.query('BEGIN')

    const names = await client.query<{ id: string; name: string }>(
      'select id, name from products where id = any($1::uuid[]) for update',
      [[winnerId, loserId]],
    )
    if (names.rows.length !== 2) throw new MergeBlockedError('One of the products no longer exists.')
    const winnerName = names.rows.find(r => r.id === winnerId)?.name ?? ''
    const loserName = names.rows.find(r => r.id === loserId)?.name ?? ''

    // A shared count session means one person counted these as two separate
    // things on the same day. That contradicts the merge, and the unique index
    // on (count_id, product_id) would reject it anyway - so say so plainly
    // instead of letting Postgres surface a constraint name.
    const clash = await client.query<{ n: string }>(
      `select count(*)::int n from stock_count_items a
       join stock_count_items b on a.count_id = b.count_id
       where a.product_id = $1 and b.product_id = $2`,
      [winnerId, loserId],
    )
    if (Number(clash.rows[0].n) > 0) {
      throw new MergeBlockedError(
        `"${winnerName}" and "${loserName}" were both counted in the same stock count, so they were treated as separate items on the shelf. Check the count before merging them.`,
      )
    }

    const moved: Record<string, number> = {}
    const skipped: Record<string, number> = {}

    for (const t of PRODUCTS_FK_TABLES) {
      const { movedCount, skippedCount } = await moveTable(client, t, winnerId, loserId, winnerName)
      if (movedCount) moved[t.table] = movedCount
      if (skippedCount) skipped[t.table] = skippedCount
    }

    // Only ever fills a gap - the winner's own values always win.
    const backfillable = [
      'image_url',
      'sku',
      'price',
      'category',
      'description',
      'remarks',
      'price_spx2',
      'price_spx3',
      'price_b1g1',
      'promo_price',
      'bundle_prices',
    ]
    // Work out what will actually be filled BEFORE writing, so the report
    // reflects the gaps that were closed rather than values that merely happen
    // to match afterwards.
    const state = await client.query<Record<string, unknown>>(
      `select ${backfillable.map(c => `w.${c} as "w_${c}", l.${c} as "l_${c}"`).join(', ')}
       from products w, products l where w.id = $1 and l.id = $2`,
      [winnerId, loserId],
    )
    const backfilled = backfillable.filter(
      c => state.rows[0]?.[`w_${c}`] == null && state.rows[0]?.[`l_${c}`] != null,
    )

    if (backfilled.length) {
      const sets = backfilled.map(c => `${c} = coalesce(w.${c}, l.${c})`).join(', ')
      await client.query(
        `update products w set ${sets} from products l where w.id = $1 and l.id = $2`,
        [winnerId, loserId],
      )
    }

    // Variants that arrived from the loser have to be reflected on the flag, or
    // the merged product renders as a plain single-quantity item and hides them.
    if (moved['product_variants']) {
      await client.query('update products set has_variants = true where id = $1', [winnerId])
    }

    const del = await client.query('delete from products where id = $1', [loserId])
    if (del.rowCount !== 1) throw new MergeBlockedError('The duplicate could not be removed.')

    // Renaming happens AFTER the loser is gone: the two spellings can differ
    // only by case or spacing, and taking the loser's name while its row still
    // exists risks tripping a name uniqueness rule inside the transaction.
    let finalNameApplied: string | null = null
    if (finalName && finalName !== winnerName) {
      if (finalName !== loserName) {
        throw new MergeBlockedError(
          'The surviving name has to be one of the two names being merged.',
        )
      }
      await client.query('update products set name = $2 where id = $1', [winnerId, finalName])
      // The display copies carried on the moved rows have to follow the rename
      // too, or they keep captioning the product with the spelling just dropped.
      for (const t of PRODUCTS_FK_TABLES.filter(x => x.syncsName)) {
        await client.query(`update ${t.table} set product_name = $2 where ${t.column} = $1`, [
          winnerId,
          finalName,
        ])
      }
      finalNameApplied = finalName
    }

    await client.query('COMMIT')
    return { moved, skipped, backfilled, winnerName, loserName, finalName: finalNameApplied }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Move one table's rows. Where a unique constraint spans the product plus some
 * other column, the loser's row is left behind rather than forced - a winner
 * that already has the same image URL or variant does not need a second copy,
 * and those tables all cascade, so the leftovers disappear with the loser.
 */
async function moveTable(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> },
  t: FkTable,
  winnerId: string,
  loserId: string,
  winnerName: string,
): Promise<{ movedCount: number; skippedCount: number }> {
  // Only one image per product may be flagged primary. This has to be cleared
  // on the incoming rows BEFORE they move: the unique index is evaluated during
  // the UPDATE itself, so tidying up afterwards is too late and the whole
  // transaction is rejected.
  if (t.table === 'product_images') {
    const winnerHasPrimary = await client.query(
      'select 1 from product_images where product_id = $1 and is_primary limit 1',
      [winnerId],
    )
    if ((winnerHasPrimary.rowCount ?? 0) > 0) {
      await client.query(
        'update product_images set is_primary = false where product_id = $1 and is_primary',
        [loserId],
      )
    }
  }

  const dupeGuard = t.uniqueWith
    ? `and not exists (select 1 from ${t.table} w where w.${t.column} = $1 and ${t.uniqueWith
        .map(c => `w.${c} is not distinct from ${t.table}.${c}`)
        .join(' and ')})`
    : ''

  const res = await client.query(
    `update ${t.table} set ${t.column} = $1${t.syncsName ? ', product_name = $3' : ''}
     where ${t.column} = $2 ${dupeGuard}`,
    t.syncsName ? [winnerId, loserId, winnerName] : [winnerId, loserId],
  )
  const movedCount = res.rowCount ?? 0

  let skippedCount = 0
  if (t.uniqueWith) {
    const left = await client.query(`select 1 from ${t.table} where ${t.column} = $1`, [loserId])
    skippedCount = left.rowCount ?? 0
  }

  return { movedCount, skippedCount }
}
