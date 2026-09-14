/**
 * Pins the paperwork-linked duplicate finder against LIVE data.
 *
 * Pure unit assertions were never enough here: "9 passed, 0 failed" once
 * shipped a wrong number because every assertion tested guard rails and none
 * pinned a real value. So this asserts the actual pair the owner pointed at.
 *
 *   npx tsx --env-file=.env.development.local scripts/verify-linked-duplicates.mts
 */
import { createClient } from '@supabase/supabase-js'
import { findAllDuplicatePairs, findDuplicatePairs, findLinkedPairs, type DuplicateProduct, type ProductLabel } from '../lib/products/duplicates'
import { fetchAll } from '../lib/supabase/fetch-all'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
let failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
  if (!ok) failed++
}

const { data: prodRows, error } = await db
  .from('products')
  .select('id, name, quantity, zone, shelf_code, last_counted_at')
  .neq('is_active', false)
if (error) throw error
const products: DuplicateProduct[] = (prodRows ?? []).map(p => ({ ...p, po_count: 0, image_count: 0 }))

const poRows = await fetchAll<{ product_id: string | null; product_name: string | null }>((from, to) =>
  db.from('purchase_orders').select('product_id, product_name').not('product_id', 'is', null).order('id').range(from, to),
)
const aliasRows = await fetchAll<{ product_id: string | null; alias_name: string | null }>((from, to) =>
  db.from('product_aliases').select('product_id, alias_name').order('id').range(from, to),
)
const labels: ProductLabel[] = [
  ...poRows.flatMap(r => (r.product_id && r.product_name ? [{ productId: r.product_id, label: r.product_name, via: 'purchase order' as const }] : [])),
  ...aliasRows.flatMap(r => (r.product_id && r.alias_name ? [{ productId: r.product_id, label: r.alias_name, via: 'alias' as const }] : [])),
]
console.log(`${products.length} active products, ${poRows.length} PO rows, ${aliasRows.length} aliases`)

const byName = findDuplicatePairs(products)
const linked = findLinkedPairs(products, labels)
const all = findAllDuplicatePairs(products, labels)
console.log(`name pairs=${byName.length}  linked pairs=${linked.length}  combined=${all.length}\n`)

// --- the owner's case ------------------------------------------------------
const wm = linked.find(p => [p.a.name, p.b.name].includes('Machine Tablets') && [p.a.name, p.b.name].includes('Washing Machine Cleaner'))
check('Machine Tablets <-> Washing Machine Cleaner is found', !!wm)
if (wm) {
  check('  reason is linked', wm.reason === 'linked')
  check('  link label is the PO text', wm.link?.label.toLowerCase() === 'washing machine cleaner', wm.link?.label)
  check('  link owner is Machine Tablets (the row the PO was filed under)', products.find(p => p.id === wm.link?.ownerId)?.name === 'Machine Tablets')
  check('  winner is the shelved row (Washing Machine Cleaner, Zone D)', wm.winner?.name === 'Washing Machine Cleaner', `winner=${wm.winner?.name} zone=${wm.winner?.zone}`)
  check('  loser is Machine Tablets', wm.loser?.name === 'Machine Tablets')
  check('  not undecided', wm.undecided === null)
}

// --- combined list has no couple twice --------------------------------------
const keys = all.map(p => [p.a.id, p.b.id].sort().join(':'))
check('no pair listed twice in combined output', new Set(keys).size === keys.length)

// --- the name scanner alone could NOT see it ---------------------------------
check('name scanner alone does not pair them (proves the new path is load-bearing)', !byName.some(p => [p.a.name, p.b.name].includes('Machine Tablets') && [p.a.name, p.b.name].includes('Washing Machine Cleaner')))

// --- model-mark guard still applies to linked pairs -------------------------
const badMark = linked.filter(p => {
  const marks = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => /\d/.test(t)))
  const A = marks(p.a.name), B = marks(p.b.name)
  return A.size !== B.size || [...A].some(t => !B.has(t))
})
check('no linked pair joins products with different model marks', badMark.length === 0, badMark.map(p => `${p.a.name} / ${p.b.name}`).join('; '))

console.log('\nAll linked pairs:')
for (const p of linked) {
  const owner = p.link!.ownerId === p.a.id ? p.a : p.b
  const other = owner.id === p.a.id ? p.b : p.a
  console.log(`  "${owner.name}" [zone ${owner.zone ?? '-'} qty ${owner.quantity ?? 0}] --${p.link!.via} "${p.link!.label}"--> "${other.name}" [zone ${other.zone ?? '-'} qty ${other.quantity ?? 0}]  => ${p.undecided ? 'UNDECIDED ' + p.undecided : 'keep ' + p.winner!.name}`)
}

console.log(`\n${failed === 0 ? 'ALL PASSED' : failed + ' FAILED'}`)
process.exit(failed ? 1 : 0)
