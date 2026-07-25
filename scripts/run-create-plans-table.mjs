// One-off setup: creates the rider_placement_plans table.
// Run with: node scripts/run-create-plans-table.mjs
import fs from 'node:fs'
import { Client } from 'pg'

const env = {}
for (const line of fs.readFileSync('.env.development.local', 'utf8').split('\n')) {
  const idx = line.indexOf('=')
  if (idx > 0 && /^[A-Z0-9_]+$/.test(line.slice(0, idx))) {
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    env[line.slice(0, idx)] = val
  }
}

let url = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL
// Strip sslmode from the URL so our ssl config (accepting Supabase's cert) applies
if (url) url = url.replace(/[?&]sslmode=[^&]*/, '')
if (!url) {
  console.error('No POSTGRES_URL found')
  process.exit(1)
}
console.log('[v0] Using connection host:', new URL(url).hostname)

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
await client.query(fs.readFileSync('scripts/create-rider-placement-plans.sql', 'utf8'))
const r = await client.query("SELECT to_regclass('public.rider_placement_plans') AS t")
console.log('[v0] table created:', r.rows[0].t)
await client.end()
