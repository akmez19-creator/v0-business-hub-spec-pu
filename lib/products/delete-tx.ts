import { PRODUCT_BLOCKING_TABLES } from './references'

/**
 * Delete products and detach their references in ONE transaction.
 *
 * Why this exists rather than a sequence of Supabase calls: detaching and
 * deleting are separate round-trips there, so a delete rejected at the last
 * step leaves the detaching already committed. Observed for real - a forced
 * delete failed on a CHECK constraint and the product survived with its stock
 * count entry already erased. That is the worst possible outcome: the record
 * the user was warned about is gone, and the thing they asked for did not
 * happen. Wrapping it means a refusal costs nothing.
 *
 * Runs as the database owner, so RLS does not hide rows. Server-only.
 */

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/

function ident(name: string): string {
  if (!SAFE_IDENT.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return name
}

export type AtomicDeleteResult = {
  deleted: number
  unlinked: number
  detachedRows: number
}

export async function deleteProductsAtomically(
  productIds: string[],
  productNames: Record<string, string>,
): Promise<AtomicDeleteResult> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('No database connection string configured')

  // Imported lazily and inside the try: pg ships alongside the optional
  // pg-native binary, and a top-level import that fails to resolve takes down
  // every route in this module rather than just this one call.
  const { Client } = await import('pg')

  const client = new Client({
    connectionString: connectionString.replace(/[?&]sslmode=\w+/, ''),
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()
  let unlinked = 0
  let detachedRows = 0

  try {
    await client.query('BEGIN')

    // Preserve identity on orders that never captured a name, BEFORE the
    // pointer is cleared - otherwise those rows become anonymous forever.
    for (const [id, name] of Object.entries(productNames)) {
      await client.query(
        `UPDATE purchase_orders SET product_name = $1 WHERE product_id = $2 AND product_name IS NULL`,
        [name, id],
      )
    }

    for (const ref of PRODUCT_BLOCKING_TABLES) {
      if (ref.removal === 'block') continue

      const table = ident(ref.table)
      const column = ident(ref.column)
      const where = [`${column} = ANY($1::uuid[])`]
      const params: unknown[] = [productIds]

      if (ref.filter) {
        where.push(`${ident(ref.filter.column)} = $2`)
        params.push(ref.filter.value)
      }

      const sql =
        ref.removal === 'delete'
          ? `DELETE FROM ${table} WHERE ${where.join(' AND ')}`
          : `UPDATE ${table} SET ${column} = NULL WHERE ${where.join(' AND ')}`

      const res = await client.query(sql, params)
      if (ref.removal === 'delete') detachedRows += res.rowCount ?? 0
      else unlinked += res.rowCount ?? 0
    }

    const del = await client.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [productIds])

    await client.query('COMMIT')
    return { deleted: del.rowCount ?? 0, unlinked, detachedRows }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end().catch(() => {})
  }
}
