/**
 * Proves the storekeeper stock-in returns rule on LIVE data.
 * Mirrors app/dashboard/storekeeper/stock-in/page.tsx exactly.
 */
import { createClient } from '@supabase/supabase-js'
import { incomingToStore } from '../lib/stock-direction'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const COLS =
  'id, products, qty, delivery_date, stock_verified, rider_id, contractor_id, status, return_product, sales_type, customer_name, replacement_from_van'

const FOLLOW = ['exchange', 'trade_in', 'refund']

const { data: cms } = await db.from('deliveries').select(COLS).eq('status', 'cms')
const { data: ret } = await db.from('deliveries').select(COLS)
  .in('sales_type', FOLLOW).not('return_product', 'is', null)

const seen = new Set<string>()
const rows = [...(cms || []), ...(ret || [])].filter(r => !seen.has(r.id) && seen.add(r.id))

let counted = 0, awaiting = 0, followFirst = 0, missedLabelled = 0
const fails: string[] = []

for (const r of rows as any[]) {
  const inc = incomingToStore(r)
  if (!inc) {
    awaiting++
    // Must be a genuine "nothing moved" case.
    const notOut = r.status !== 'cms' && r.status !== 'delivered'
    const refundCms = r.sales_type === 'refund' && r.status === 'cms'
    if (!notOut && !refundCms && !(r.status === 'delivered' && !FOLLOW.includes(r.sales_type)))
      fails.push(`dropped for no reason: ${r.id} ${r.status}/${r.sales_type}`)
    continue
  }
  counted++
  // The named product must exist on the row - never invented.
  const onRow = [r.products, r.return_product].filter(Boolean).map((s: string) =>
    s.replace(/^\s*in\s*:\s*/i, '').trim())
  if (!onRow.includes(inc.product)) fails.push(`invented product: ${r.id} -> ${inc.product}`)
  // Nothing still on the van may be counted.
  if (r.status !== 'cms' && r.status !== 'delivered') fails.push(`counted but not out: ${r.id}`)

  const isFollow = FOLLOW.includes(r.sales_type)
  if (isFollow && inc.kind !== 'cms') followFirst++
  if (isFollow && inc.kind === 'cms') {
    missedLabelled++
    // A missed swap must name the REPLACEMENT (what went out), not the
    // client's old item which is still in their house.
    if (inc.product !== (r.products || '').trim()) fails.push(`missed swap names wrong item: ${r.id}`)
  }
}

console.log(`rows seen                    ${rows.length}`)
console.log(`counted as physically back   ${counted}`)
console.log(`shown as "nothing moved yet" ${awaiting}`)
console.log(`follow-ups pinned FIRST      ${followFirst}`)
console.log(`missed swaps (labelled)      ${missedLabelled}`)
console.log(fails.length ? `\nFAIL:\n${fails.join('\n')}` : `\nALL CHECKS PASS`)
