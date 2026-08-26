// One-off Postgres connections for the product routes.
//
// The import is lazy and inside the function for the reason recorded in
// merge-tx.ts: `pg` sits next to the optional `pg-native` binary, and a
// top-level import that fails at module load takes down every route in the
// file - which once showed up as a 174ms "AI failure" that had nothing to do
// with the model.
import type { Client } from 'pg'

export async function connect(): Promise<Client> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) throw new Error('No database connection string configured')

  const { Client: PgClient } = await import('pg')
  const client = new PgClient({
    // Supabase's pooled URL carries an sslmode the driver rejects; the other
    // product transactions strip it the same way.
    connectionString: connectionString.replace(/[?&]sslmode=\w+/, ''),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}
