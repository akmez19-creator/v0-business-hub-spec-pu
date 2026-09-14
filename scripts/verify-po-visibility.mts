/**
 * Every purchase order reaches the dashboard.
 *
 * Owner: "pest repellent got bought 3000 the first time - have not this
 * record? got many orders as such still not yet display even my agent did
 * enter that". The agent had entered it. `.limit(500)` on a newest-first list
 * of 690 orders cut the 190 oldest, and the stats card beside the list said
 * 690. This pins the fix with the page's OWN query builder, and forces small
 * pages so the boundary logic is exercised rather than trusted.
 */
import { readFile } from 'node:fs/promises'
import { createAdminClient } from '../lib/supabase/server'
import { fetchAll } from '../lib/supabase/fetch-all'

let passed = 0
let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  ok ? passed++ : failed++
}

const db = createAdminClient()
const { count: total } = await db.from('purchase_orders').select('*', { count: 'exact', head: true })

// The dashboard page's query, verbatim.
const pageQuery = (from: number, to: number) =>
  db
    .from('purchase_orders')
    .select('*, products:product_id (id, name, image_url)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to)

const orders = await fetchAll<{ id: string; qty: number | null; product_name: string | null; products: { name: string } | null }>(pageQuery)
check('the page receives every order', orders.length === total, `${orders.length} of ${total}`)

// Force 7+ pages over the same data: the id tiebreaker must give no repeats and no gaps.
const paged = await fetchAll<{ id: string }>(pageQuery, 100)
const unique = new Set(paged.map((o) => o.id))
check('small pages produce no duplicates', unique.size === paged.length, `${unique.size} unique of ${paged.length}`)
check('small pages produce no gaps', paged.length === total, `${paged.length} of ${total}`)
check(
  'small pages and one page are the same set',
  unique.size === orders.length && orders.every((o) => unique.has(o.id)),
)

// Batch imports share created_at to the microsecond - is the tiebreaker doing real work?
const stamps = new Map<string, number>()
for (const o of await fetchAll<{ created_at: string }>((f, t) => db.from('purchase_orders').select('created_at').order('id').range(f, t))) {
  stamps.set(o.created_at, (stamps.get(o.created_at) ?? 0) + 1)
}
const biggestBatch = Math.max(...stamps.values())
check('created_at alone is NOT a total order (so the id tiebreaker is load-bearing)', biggestBatch > 1, `${biggestBatch} rows share one timestamp`)

// The order the owner asked about.
const pest3000 = orders.find((o) => Number(o.qty) === 3000 && /pest/i.test(`${o.product_name} ${o.products?.name}`))
check('the first Pest Repellent PO (3000 units) is in what the page receives', !!pest3000, pest3000 ? pest3000.product_name ?? '' : 'MISSING')

// SOURCE GUARDS: the cut must not come back.
const page = await readFile(new URL('../app/dashboard/purchasing/page.tsx', import.meta.url), 'utf8')
// Code only - the comment above the query rightly records the old `.limit(500)`.
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
check('dashboard page has no .limit() on purchase orders', !/\.limit\(/.test(pageCode))
check('dashboard page uses fetchAll', /fetchAll</.test(page))
check(
  'stats and supplier filter derive from the same array as the list',
  /totalOrders: orders\.length/.test(page) && /orders\.map\(\(o\) => o\.supplier_name\)/.test(page),
  'one source, so the card and the list cannot disagree',
)
const suppliers = await readFile(new URL('../app/dashboard/purchasing/suppliers/page.tsx', import.meta.url), 'utf8')
check('suppliers page uses fetchAll', /fetchAll</.test(suppliers))
const suggest = await readFile(new URL('../lib/local-purchasing/suggest.ts', import.meta.url), 'utf8')
check('suggest.ts import counts use fetchAll (decoy check sees every order)', (suggest.match(/fetchAll</g) ?? []).length >= 3)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
