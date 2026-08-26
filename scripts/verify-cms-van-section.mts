/**
 * Proves the admin CMS page's new van section against LIVE data.
 *
 * The risk being tested is not layout, it is ARITHMETIC MEANING: the page's
 * existing cards all mean "CMS", and NWD had to be added without any of them
 * changing value or absorbing rows whose goods are on a van.
 */
import { createClient } from '@supabase/supabase-js'
import { buildVanPiles, vanTotal, carriedOverTotal } from '../lib/van-stock'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`) }
}

const today = new Date().toISOString().split('T')[0]

// Mirrors the page's two queries exactly.
const { data: cmsRows } = await db
  .from('deliveries')
  .select('id, status')
  .eq('status', 'cms')

const { data: nwdRows } = await db
  .from('deliveries')
  .select('id, customer_name, products, qty, status, delivery_date, rider_id, delivery_notes, stock_verified')
  .eq('status', 'nwd')
  .not('stock_verified', 'is', true)
  .order('delivery_date', { ascending: false })

const cms = cmsRows || []
const nwd = nwdRows || []

console.log(`\nCMS rows: ${cms.length}   NWD rows on vans: ${nwd.length}   today: ${today}\n`)

console.log('SEPARATION - the two facts must not merge')
// A delivery has one status, so the sets cannot overlap. Asserted rather than
// assumed, because merging them was the tempting one-line implementation.
const cmsIds = new Set(cms.map(r => r.id))
check('no row is both CMS and on-van', nwd.every(r => !cmsIds.has(r.id)))
check('CMS list contains no nwd status', cms.every(r => r.status === 'cms'))
check('van list contains only nwd status', nwd.every(r => r.status === 'nwd'))
check('van list excludes anything already verified in',
  nwd.every(r => r.stock_verified !== true))

console.log('\nRIDER GROUPING - the page groups by van, then merges per product')
const byRider = new Map<string, typeof nwd>()
for (const d of nwd) {
  const k = d.rider_id || 'unassigned'
  if (!byRider.has(k)) byRider.set(k, [])
  byRider.get(k)!.push(d)
}

const groups = [...byRider.entries()].map(([riderId, rows]) => {
  const piles = buildVanPiles(
    rows.map(r => ({
      id: r.id, product: r.products, qty: r.qty,
      status: r.status, deliveryDate: r.delivery_date, customerName: r.customer_name,
    })),
    today,
  )
  return { riderId, rows, piles, units: vanTotal(piles), stuck: carriedOverTotal(piles, today) }
})

const rowsInGroups = groups.reduce((s, g) => s + g.rows.length, 0)
check('every van row lands in exactly one rider group', rowsInGroups === nwd.length,
  `${rowsInGroups} vs ${nwd.length}`)

const rowsInPiles = groups.reduce((s, g) => s + g.piles.reduce((n, p) => n + p.orderCount, 0), 0)
check('no order lost or duplicated by the product merge', rowsInPiles === nwd.length,
  `${rowsInPiles} vs ${nwd.length}`)

// Units must survive merging - the whole point is fewer rows, same total.
const expectedUnits = nwd.reduce((s, r) => s + Math.max(1, Number(r.qty) || 0), 0)
const pageUnits = groups.reduce((s, g) => s + g.units, 0)
check('unit total conserved across all vans', pageUnits === expectedUnits,
  `${pageUnits} vs ${expectedUnits}`)

check('merging actually reduces rows',
  groups.reduce((s, g) => s + g.piles.length, 0) <= nwd.length)

console.log('\nCARRIED OVER - the reason a date filter hid all of this')
const stuck = groups.reduce((s, g) => s + g.stuck, 0)
check('carried-over units never exceed total', stuck <= pageUnits, `${stuck} vs ${pageUnits}`)
const datedToday = nwd.filter(r => r.delivery_date === today).length
check('flags stock from earlier days, which a today-only query would miss',
  datedToday < nwd.length)
console.log(`        ${datedToday} of ${nwd.length} van rows are dated today; ${stuck} units carried over`)

console.log('\nREVIEW STATE - these have never been reviewed here before')
const reviewed = nwd.filter(r => (r.delivery_notes || '').startsWith('[REVIEWED]')).length
check('all van rows carry a rider reason', nwd.every(r => (r.delivery_notes || '').trim() !== ''))
console.log(`        ${reviewed} of ${nwd.length} marked [REVIEWED] (0 expected - page never showed them)`)

console.log('\nPER-VAN BREAKDOWN')
for (const g of groups.sort((a, b) => b.stuck - a.stuck || b.units - a.units)) {
  console.log(`  rider ${g.riderId.slice(0, 8)}  ${String(g.units).padStart(3)} units  ` +
    `${String(g.rows.length).padStart(3)} orders -> ${String(g.piles.length).padStart(3)} piles  ` +
    `${g.stuck} carried over`)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
