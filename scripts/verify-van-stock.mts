/**
 * Proves the "still on the van" logic against LIVE data.
 *
 * NWD goods stay on the rider's van (owner-confirmed), so the two claims that
 * matter are: nothing physically absent is counted as on-van, and nothing
 * actually on the van is hidden by a date filter.
 */
import { createClient } from '@supabase/supabase-js'
import { buildVanPiles, isOnVan, vanTotal, carriedOverTotal } from '../lib/van-stock'
import { incomingToStore } from '../lib/stock-direction'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`) }
}

const { data: all, error } = await db
  .from('deliveries')
  .select('id, products, qty, status, delivery_date, customer_name, rider_id, stock_verified')
  .order('delivery_date', { ascending: false })
if (error) throw error

const rows = (all || []).map(r => ({
  id: r.id, product: r.products, qty: r.qty, status: r.status,
  deliveryDate: r.delivery_date, customerName: r.customer_name,
  riderId: r.rider_id, stockVerified: r.stock_verified,
}))

const ACTIVE = '2026-08-26' // "today" in the live data
console.log(`\n${rows.length} delivery rows loaded. Active date ${ACTIVE}.\n`)

// ---------------------------------------------------------------- status rule
console.log('STATUS RULE')
const nwd = rows.filter(r => r.status === 'nwd')
const cancelled = rows.filter(r => r.status === 'cancelled')

check('nwd counts as on-van', nwd.every(r => isOnVan(r.status)))
check(
  'cancelled NEVER counts as on-van (it never left the building)',
  cancelled.length > 0 && cancelled.every(r => !isOnVan(r.status)),
  `${cancelled.length} cancelled rows`,
)
check('delivered never on-van', rows.filter(r => r.status === 'delivered').every(r => !isOnVan(r.status)))
check('cms never on-van (that came back to store)', rows.filter(r => r.status === 'cms').every(r => !isOnVan(r.status)))
check('pending/assigned never on-van', rows.filter(r => r.status === 'pending' || r.status === 'assigned').every(r => !isOnVan(r.status)))

// ------------------------------------------------- store vs van are exclusive
console.log('\nSTORE / VAN EXCLUSIVITY')
const bothPlaces = rows.filter(r => isOnVan(r.status) && incomingToStore(r as any))
check(
  'nothing is counted as BOTH on-van and arrived-at-store',
  bothPlaces.length === 0,
  `${bothPlaces.length} rows double-counted`,
)

// -------------------------------------------------------------- the real bug
console.log('\nTHE DATE-FILTER BUG')
const unreconciled = nwd.filter(r => r.stockVerified !== true)
const sameDayOnly = unreconciled.filter(r => r.deliveryDate === ACTIVE)
const unitsOf = (rs: typeof rows) => rs.reduce((s, r) => s + Math.max(1, Number(r.qty) || 0), 0)

console.log(`  unreconciled NWD: ${unreconciled.length} rows / ${unitsOf(unreconciled)} units`)
console.log(`  ...of which dated ${ACTIVE}: ${sameDayOnly.length} rows`)
check(
  'a same-date-only filter WOULD have hidden real van stock (the bug)',
  unreconciled.length > 0 && sameDayOnly.length < unreconciled.length,
  'if this fails the carry-over query is no longer needed',
)

const piles = buildVanPiles(unreconciled, ACTIVE)
check(
  'the un-filtered query surfaces every unreconciled unit',
  vanTotal(piles) === unitsOf(unreconciled),
  `${vanTotal(piles)} vs ${unitsOf(unreconciled)}`,
)
check(
  'carried-over total is reported and non-zero',
  carriedOverTotal(piles, ACTIVE) > 0,
  `${carriedOverTotal(piles, ACTIVE)} units`,
)

// -------------------------------------------------------------------- merging
console.log('\nMERGING')
check('no pile is empty', piles.every(p => p.qty > 0 && p.orderCount > 0))
check(
  'no order lost or duplicated across piles',
  piles.reduce((s, p) => s + p.orderCount, 0) === unreconciled.length,
)
const ids = piles.flatMap(p => p.rows.map(r => r.id))
check('every id appears exactly once', new Set(ids).size === ids.length)
check(
  'every label exists verbatim in the data',
  piles.every(p => unreconciled.some(r => (r.product || '').trim() === p.label)),
)
check('qty always >= order count (floored at 1)', piles.every(p => p.qty >= p.orderCount))
check(
  'oldest-stuck pile sorts first',
  piles.length < 2 || (piles[0].dates[piles[0].dates.length - 1] || '') <=
    (piles[1].dates[piles[1].dates.length - 1] || ''),
)
check(
  'carriedOver flag agrees with the dates it holds',
  piles.every(p => p.carriedOver === p.dates.some(d => d < ACTIVE)),
)

const merged = piles.filter(p => p.orderCount > 1)
console.log(`\n  ${unreconciled.length} refused orders -> ${piles.length} product piles`)
console.log(`  ${merged.length} piles merged >1 order`)
for (const p of piles.slice(0, 8)) {
  console.log(`    ${p.qty.toString().padStart(3)}x ${p.label}  (${p.orderCount} orders, ${p.dates.join(',')}${p.carriedOver ? ', CARRIED OVER' : ''})`)
}

// --------------------------------------------------------------- per-rider
console.log('\nPER-RIDER SPLIT')
const byRider = new Map<string, typeof rows>()
for (const r of unreconciled) {
  const k = r.riderId || 'none'
  if (!byRider.has(k)) byRider.set(k, [])
  byRider.get(k)!.push(r)
}
let riderSum = 0
for (const [, rs] of byRider) riderSum += vanTotal(buildVanPiles(rs, ACTIVE))
check('per-rider piles sum to the fleet total', riderSum === vanTotal(piles), `${riderSum} vs ${vanTotal(piles)}`)
console.log(`  ${byRider.size} riders carrying refused stock`)

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail > 0) process.exit(1)
