/**
 * Runs the prompt shortlist against the LIVE catalogue for the thread shapes
 * that matter, and prints the size so the token saving is visible.
 *   pnpm exec tsx scripts/check-prompt-catalogue.ts
 */
import { Client } from 'pg'
import { shortlistForPrompt } from '@/lib/inbox/prompt-catalogue'

async function main() {
  const c = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query<{ name: string }>('select name from products where is_active order by name')
  await c.end()
  const catalogue = rows
  console.log('catalogue', catalogue.length)

  const cases = [
    { label: 'ad only, "more info"', productHint: 'EMS Foot Massager', adName: 'MBM - EMS Foot Massager - 3', transcript: 'Customer: Hello! Can I get more info on this?' },
    { label: 'no ad, typo', productHint: null, adName: null, transcript: 'Customer: how much the foot masager' },
    { label: 'no ad, kreol', productHint: null, adName: null, transcript: 'Customer: pri toilet stool la?' },
    { label: 'ad + add-on', productHint: 'Magnetic Window Cleaner', adName: null, transcript: 'Customer: 2 pou moi. Will need one floor cleaner too', orders: ['Magnetic Window Cleaner'] },
    { label: 'greeting only', productHint: null, adName: null, transcript: 'Customer: bonjour' },
  ]
  for (const t of cases) {
    const list = shortlistForPrompt({ catalogue, productHint: t.productHint, adName: t.adName, transcript: t.transcript, orderProductNames: t.orders })
    console.log(`\n${t.label}: ${list.length} products`)
    console.log('  ' + list.slice(0, 8).map((p) => p.name).join(' | '))
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
