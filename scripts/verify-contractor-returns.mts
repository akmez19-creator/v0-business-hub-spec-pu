/**
 * Proves the contractor returns rule against LIVE data.
 * Run: npx tsx scripts/verify-contractor-returns.mts
 */
import { createClient } from '@supabase/supabase-js'
import { incomingToStore, isFollowUp } from '../lib/stock-direction'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

const { data: rows } = await db
  .from('deliveries')
  .select('id, customer_name, delivery_date, products, return_product, qty, sales_type, status, replacement_from_van')
  .or('status.eq.cms,sales_type.in.(exchange,trade_in,refund)')
  .eq('stock_verified', false)
  .gte('delivery_date', '2026-08-01')

console.log(`\n${rows?.length ?? 0} pending rows off live data\n`)

// 1. Nothing that has not gone out yet may be listed.
const notOut = (rows || []).filter(r => !['cms', 'delivered'].includes((r.status || '').toLowerCase()))
check(`${notOut.length} not-yet-out rows are all dropped`,
  notOut.every(r => incomingToStore(r) === null),
  JSON.stringify(notOut.filter(r => incomingToStore(r)).map(r => r.customer_name)))

// 2. A refund with the client missed brings nothing back.
const refundCms = (rows || []).filter(r => r.sales_type === 'refund' && r.status === 'cms')
check(`${refundCms.length} refund+cms rows return null (phantom)`,
  refundCms.every(r => incomingToStore(r) === null))

// 3. trade_in/exchange + cms must name the REPLACEMENT, not the old item.
const swapCms = (rows || []).filter(r => ['trade_in', 'exchange'].includes(r.sales_type || '') && r.status === 'cms')
check(`${swapCms.length} missed swaps name the replacement`,
  swapCms.every(r => {
    const i = incomingToStore(r)
    return i && i.product === (r.products || '').trim() && i.kind === 'cms'
  }),
  JSON.stringify(swapCms.map(r => ({ c: r.customer_name, got: incomingToStore(r)?.product, old: r.return_product }))))

// 4. A completed follow-up names the client's own item, IN: stripped.
const done = (rows || []).filter(r => isFollowUp(r.sales_type) && r.status === 'delivered')
check(`${done.length} completed follow-ups name the collected item`,
  done.every(r => {
    const i = incomingToStore(r)
    return i && i.kind === 'collected' && !/^\s*in\s*:/i.test(i.product)
  }),
  JSON.stringify(done.map(r => ({ c: r.customer_name, got: incomingToStore(r)?.product }))))

// 5. Plain cms rows still work - the common case must not regress.
const plain = (rows || []).filter(r => r.status === 'cms' && !isFollowUp(r.sales_type))
check(`${plain.length} plain cms rows unchanged`,
  plain.every(r => {
    const i = incomingToStore(r)
    return i && i.product === (r.products || '').trim() && i.kind === 'unsold'
  }))

// 6. Nothing is invented: every named product came off the row.
check('no product is invented',
  (rows || []).every(r => {
    const i = incomingToStore(r)
    if (!i) return true
    const src = `${r.products || ''} ${r.return_product || ''}`.toLowerCase()
    return src.includes(i.product.toLowerCase())
  }))

// 7. The pinned set excludes missed clients.
const pinned = (rows || []).filter(r => {
  const i = incomingToStore(r)
  return i && isFollowUp(r.sales_type) && i.kind !== 'cms'
})
check(`${pinned.length} pinned rows are all real settlements`,
  pinned.every(r => r.status === 'delivered'))

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
