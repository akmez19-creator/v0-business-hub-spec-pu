import 'server-only'

/**
 * Link two products as the same thing WITHOUT deleting either row.
 *
 * The soft counterpart to mergeProducts(). Merge is right when one row is
 * simply a mistyped ghost; linking is right when both rows have real history a
 * reviewer is not willing to destroy, or when they are unsure. Everything here
 * is reversible by flipping is_active back.
 *
 * What it does:
 *   - the retired row's NAME becomes a product_aliases entry pointing at the
 *     survivor, so that spelling resolves from then on;
 *   - the retired row is set is_active = false, which is what actually removes
 *     it from the extension picker (that query filters is_active);
 *   - optionally moves the retired row's counted stock onto the survivor.
 *
 * WHY RETIRING IS REQUIRED, not cosmetic: createProductMatcher() checks exact
 * product names BEFORE aliases, so an alias is dead while any product still
 * carries that text. Measured on live data, all 8 pre-existing aliases in that
 * situation were being ignored. Retiring plus the is_active filter added to
 * the catalogue loader is what lets the alias win.
 */

export class LinkBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkBlockedError'
  }
}

export type LinkResult = {
  /** The survivor's name AFTER any rename. */
  survivorName: string
  /** Its previous name when it was renamed, kept as an alias. Null otherwise. */
  renamedFrom: string | null
  retiredName: string
  /** Aliases now pointing at the survivor: the retired name plus any it owned. */
  aliasesRepointed: number
  aliasAdded: boolean
  /** Units moved off the retired row, or 0 when the reviewer declined. */
  stockMoved: number
  /** Stock left sitting on the retired row - reported so it is never silent. */
  stockStranded: number
}

export async function linkProducts(
  survivorId: string,
  retiredId: string,
  /**
   * Move the retired row's counted quantity onto the survivor.
   *
   * NOT defaulted here on purpose - the caller must decide, because both
   * answers are wrong in some cases. Retiring a row hides it from the pickers,
   * so leaving stock on it makes those units unsellable (live examples carry
   * 290 and 84 units). But if a counter walked the shelf once and wrote the
   * total under both spellings, moving it would double the on-hand figure.
   * mergeProducts() deliberately never sums for that reason.
   */
  moveStock: boolean,
  /**
   * Rename the surviving row.
   *
   * Separate from the choice of WHICH row survives, deliberately - the row
   * worth keeping is usually the shelved one, but that is often the
   * hand-typed one carrying the typo. mergeProducts() takes finalName for the
   * same reason.
   */
  finalName?: string,
): Promise<LinkResult> {
  if (survivorId === retiredId) throw new LinkBlockedError('A product cannot be linked to itself.')

  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('No database connection string configured')

  // Lazy import, mirroring merge-tx: pg ships beside the optional pg-native
  // binary and a failed top-level import would take down every route here.
  const { Client } = await import('pg')

  const client = new Client({
    connectionString: connectionString.replace(/[?&]sslmode=\w+/, ''),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    await client.query('BEGIN')

    const rows = await client.query<{
      id: string
      name: string
      quantity: number | null
      is_active: boolean | null
    }>(
      'select id, name, quantity, is_active from products where id = any($1::uuid[]) for update',
      [[survivorId, retiredId]],
    )
    if (rows.rows.length !== 2) throw new LinkBlockedError('One of the products no longer exists.')

    const survivor = rows.rows.find(r => r.id === survivorId)!
    const retired = rows.rows.find(r => r.id === retiredId)!

    // Retiring the row the catalogue still treats as live is the whole point;
    // retiring one that is already inactive means the reviewer picked the
    // wrong direction and would leave the visible duplicate in place.
    if (retired.is_active === false) {
      throw new LinkBlockedError(
        `"${retired.name}" is already retired. Pick the other direction if "${survivor.name}" is the row you want to hide.`,
      )
    }

    // The name the surviving row will end up carrying. Resolved before the
    // aliases are written because it decides which of them are needed.
    const newName = finalName?.trim()
    const renaming = !!newName && newName.toLowerCase() !== survivor.name.toLowerCase()

    /** Add alias_name -> survivor unless some row already claims that text. */
    async function aliasToSurvivor(text: string): Promise<boolean> {
      const found = await client.query<{ product_id: string }>(
        'select product_id from product_aliases where lower(alias_name) = lower($1)',
        [text],
      )
      if (found.rows.length === 0) {
        await client.query(
          `insert into product_aliases (alias_name, product_id, source) values ($1, $2, 'link')`,
          [text, survivorId],
        )
        return true
      }
      if (found.rows.some(r => r.product_id !== survivorId)) {
        // An older alias sends this text somewhere else. Re-point it, or the
        // same words would resolve two different ways depending on the caller.
        await client.query(
          'update product_aliases set product_id = $2 where lower(alias_name) = lower($1)',
          [text, survivorId],
        )
      }
      return false
    }

    // products.name is UNIQUE (products_name_key) and BOTH rows survive a
    // link, so the survivor can never take the retired row's exact spelling -
    // that row is still sitting there holding it. mergeProducts() can only do
    // it because it deletes the loser first, then renames.
    //
    // Caught here rather than left to Postgres: the raw 23505 says
    // "Key (name)=(...) already exists", which does not tell the reviewer that
    // Merge is the action that does what they asked for.
    if (renaming && newName!.toLowerCase() === retired.name.toLowerCase()) {
      throw new LinkBlockedError(
        `Linking keeps both rows, and two products cannot share the name "${retired.name}". ` +
          `Either keep the name "${survivor.name}", or use Merge, which deletes the other row and frees the name.`,
      )
    }

    // Same constraint, third-party version: the chosen name may belong to some
    // unrelated product. Reported by name rather than as a constraint code.
    if (renaming) {
      const taken = await client.query<{ name: string }>(
        'select name from products where lower(name) = lower($1) and id <> $2 limit 1',
        [newName, survivorId],
      )
      if (taken.rows.length) {
        throw new LinkBlockedError(
          `Another product is already called "${taken.rows[0].name}", and product names must be unique.`,
        )
      }
    }

    // Renaming ORPHANS the survivor's current name: nothing would carry that
    // text any more, so orders and imports written with it would stop
    // resolving. Keep it as an alias - this is the same failure the retired
    // name is being aliased to avoid.
    if (renaming) {
      await aliasToSurvivor(survivor.name)
      await client.query('update products set name = $2 where id = $1', [survivorId, newName])
    }

    // Point the retired spelling at the survivor. This is the whole mechanism:
    // the row is about to be hidden, and without this its name resolves to
    // nothing (or gets guessed at by the fuzzy pass).
    const aliasAdded = await aliasToSurvivor(retired.name)
    // Aliases the retired product itself owned have to follow it, otherwise
    // they keep resolving to a row nothing can pick any more.
    const repointed = await client.query(
      'update product_aliases set product_id = $1 where product_id = $2',
      [survivorId, retiredId],
    )

    let stockMoved = 0
    let stockStranded = 0
    const retiredQty = Number(retired.quantity ?? 0)
    if (retiredQty > 0) {
      if (moveStock) {
        await client.query(
          'update products set quantity = coalesce(quantity, 0) + $2 where id = $1',
          [survivorId, retiredQty],
        )
        // sold_out, not a bare 0: quantity 0 on its own reads as "never
        // counted" everywhere in this codebase (the To Count badge), and this
        // row's stock is genuinely gone - it moved.
        await client.query(
          'update products set quantity = 0, sold_out = true where id = $1',
          [retiredId],
        )
        stockMoved = retiredQty
      } else {
        stockStranded = retiredQty
      }
    }

    await client.query('update products set is_active = false where id = $1', [retiredId])

    await client.query('COMMIT')
    return {
      survivorName: renaming ? newName! : survivor.name,
      renamedFrom: renaming ? survivor.name : null,
      retiredName: retired.name,
      aliasesRepointed: repointed.rowCount ?? 0,
      aliasAdded,
      stockMoved,
      stockStranded,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Undo a link: bring the retired row back and drop the alias that shadowed it.
 *
 * Stock is NOT moved back - it may have been counted, sold or adjusted since,
 * and silently subtracting it from the survivor would invent a shortage.
 */
export async function unlinkProduct(retiredId: string): Promise<{ name: string; aliasesRemoved: number }> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('No database connection string configured')
  const { Client } = await import('pg')
  const client = new Client({
    connectionString: connectionString.replace(/[?&]sslmode=\w+/, ''),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query('BEGIN')
    const row = await client.query<{ name: string }>(
      'select name from products where id = $1 for update',
      [retiredId],
    )
    if (!row.rows.length) throw new LinkBlockedError('That product no longer exists.')
    const name = row.rows[0].name
    const removed = await client.query(
      `delete from product_aliases where lower(alias_name) = lower($1) and source = 'link'`,
      [name],
    )
    await client.query('update products set is_active = true where id = $1', [retiredId])
    await client.query('COMMIT')
    return { name, aliasesRemoved: removed.rowCount ?? 0 }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}
