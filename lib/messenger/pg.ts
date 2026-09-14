import 'server-only'
import type { Client } from 'pg'

/** Uses the existing Vercel database integration; no new credentials or schema. */
export async function connectInboxDatabase(): Promise<Client> {
  const connectionString = process.env.DB_POSTGRES_URL || process.env.POSTGRES_URL ||
    process.env.DB_POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING
  if (!connectionString) throw new Error('Inbox database connection is not configured')
  // Import lazily: an optional native pg dependency must not break cached reads.
  const { Client: PgClient } = await import('pg')
  const url = new URL(connectionString)
  url.searchParams.delete('sslmode')
  const client = new PgClient({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
  })
  try {
    await client.connect()
    return client
  } catch (cause) {
    await client.end().catch(() => {})
    // Connection errors can include the URL; expose only the safe diagnosis.
    throw new Error('Inbox database connection could not be opened', { cause })
  }
}
