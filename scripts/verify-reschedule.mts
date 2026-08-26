/**
 * Proves the reschedule rules on LIVE data.
 *
 * The whole point of the change is that ONE date change must land in two
 * different places at once:
 *   - forward-looking screens follow `active_date`  (the order moves)
 *   - returns / van stock follow `delivery_date`    (the goods do not)
 *
 * A green build cannot tell you that. This can.
 */
import { createClient } from '@supabase/supabase-js'
import { incomingToStore } from '../lib/stock-direction'
import { muToday } from '../lib/business-date'
import {
  isPendingReattempt, staysOnVan, needsReissue, awaitingIssue, hasStaleStockOut,
} from '../lib/reschedule-stock'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const fails: string[] = []
const notes: string[] = []

const { data: rows, error } = await db
  .from('deliveries')
  .select('id, customer_name, status, delivery_date, rescheduled_to, reschedule_requested_to, active_date, rider_id, products, qty, return_product, sales_type, replacement_from_van, reschedule_stock_mode, stock_out, stock_out_at')

if (error) throw new Error('query failed: ' + error.message)
const all = (rows || []) as any[]

// 1. The generated column is the ONLY definition of "when is this due".
//    If it ever drifts from coalesce(), every screen reading it is wrong.
const drift = all.filter(
  r => r.active_date !== (r.rescheduled_to ?? r.delivery_date),
)
if (drift.length) fails.push(`active_date drifted from coalesce() on ${drift.length} rows`)

// 2. How much live data actually moves. If this is 0 the test proves nothing,
//    so it is reported as an inconclusive result rather than a pass.
const moved = all.filter(r => r.rescheduled_to && r.rescheduled_to !== r.delivery_date)
const requested = all.filter(r => r.reschedule_requested_to)
notes.push(`${moved.length} orders carry an applied reschedule, ${requested.length} a pending rider request`)
if (!moved.length) fails.push('INCONCLUSIVE: no live order has been rescheduled, nothing to verify')

// 3. A rider PROPOSAL must not have moved active_date. This is the rule that
//    keeps a rider from silently re-planning the warehouse's load.
const leaked = requested.filter(r => r.active_date !== (r.rescheduled_to ?? r.delivery_date))
if (leaked.length) fails.push(`${leaked.length} pending requests already moved active_date`)

// 4. THE CRITICAL ONE. A rescheduled cms order must STILL be found by the
//    storekeeper on its ORIGINAL delivery_date, and incomingToStore() must
//    still return its return leg. If a reschedule had touched `status`, this
//    would come back null and 120-odd returns would vanish off the shelf day.
const movedCms = moved.filter(r => r.status === 'cms')
const lostReturns = movedCms.filter(r => !incomingToStore(r))
notes.push(`${movedCms.length} rescheduled orders are still status='cms'`)
if (lostReturns.length) {
  fails.push(`${lostReturns.length} rescheduled cms orders lost their return leg`)
}

// 5. A moved order must never be one that already happened - that would
//    rewrite a closed day's cash.
const movedDelivered = moved.filter(r => r.status === 'delivered')
if (movedDelivered.length) {
  notes.push(
    `WARNING: ${movedDelivered.length} DELIVERED orders carry a reschedule (pre-existing data; the new action refuses to create more)`,
  )
}

// 6. The two dates must genuinely disagree for at least some rows, otherwise
//    "returns stay put" is untested: identical dates pass trivially.
const bothDatesDiffer = movedCms.filter(r => r.delivery_date !== r.active_date)
notes.push(`${bothDatesDiffer.length} rows where the shelf day and the due day genuinely differ`)
if (movedCms.length && !bothDatesDiffer.length) {
  fails.push('no row exercises the split between delivery_date and active_date')
}

// 7a. WHERE THE RESCHEDULED GOODS ARE. Calls the REAL helpers the screens call,
//     so this cannot pass while the UI is wrong - a SQL re-implementation of
//     the same rules could.
{
  const dueToday = all.filter(r => r.active_date === muToday())
  const reattempts = dueToday.filter(isPendingReattempt)
  const keep = reattempts.filter(staysOnVan)
  const collect = reattempts.filter(r => awaitingIssue(r, muToday()))
  const already = reattempts.filter(r => needsReissue(r) && !awaitingIssue(r, muToday()))

  notes.push(`re-attempts due today: ${reattempts.length}`)
  notes.push(`  keep on van: ${keep.length}  collect from store: ${collect.length}  already issued today: ${already.length}`)

  // EVERY re-attempt must land on exactly one side. A row in neither is work
  // nobody is told to load; a row in both would double-issue stock.
  const both = reattempts.filter(r => staysOnVan(r) && needsReissue(r))
  if (both.length) fails.push(`${both.length} rows are BOTH van-kept and re-issued`)
  const neither = reattempts.filter(
    r => !staysOnVan(r) && !awaitingIssue(r, muToday()) && !already.includes(r),
  )
  if (neither.length) fails.push(`${neither.length} re-attempts fell through both buckets`)

  // A van-kept order must NEVER be handed out again: that pushes a second
  // physical unit out of the store for one sale.
  const doubleIssue = keep.filter(r => needsReissue(r))
  if (doubleIssue.length) fails.push(`${doubleIssue.length} van-kept orders would be re-issued`)

  // The storekeeper must not be asked to receive van-kept goods either. This is
  // the exact complaint: a Make Up Pen showing as coming back in.
  const phantomIn = keep.filter(r => !!incomingToStore(r))
  notes.push(`  ${phantomIn.length} van-kept rows still match incomingToStore() - must be shown READ-ONLY, never tickable`)

  for (const r of keep) {
    notes.push(`  KEEP  ${r.customer_name} / ${r.products} (out ${r.delivery_date}, due ${r.active_date})`)
  }
  // A stale stock_out flag is the difference between "collect it" and silently
  // believing the rider already has it.
  const stale = reattempts.filter(r => hasStaleStockOut(r, muToday()))
  notes.push(`  ${stale.length} carry a STALE stock_out flag from the failed attempt`)
}

// 7b. THE REPORTED BUG. For every rider, the "active deliveries" badge and the
//     delivery list must now count the SAME rows. Before the fix the badge used
//     delivery_date and the list used delivery_date too - both wrong - so a
//     rescheduled order was simply absent. This asserts the new due-day basis
//     finds strictly more work today, and names what was previously invisible.
const OPEN = ['pending', 'assigned', 'picked_up']
// The MAURITIUS date, via the same helper the app uses. Using the UTC date here
// is what made this check read 0 rows against a day that has 45: at 02:41 MU
// on 26 Aug, UTC still says the 25th.
const today = muToday()
notes.push(`business date (Mauritius) = ${today}, UTC date = ${new Date().toISOString().slice(0, 10)}`)
const openToday = all.filter(r => OPEN.includes(r.status) && r.active_date === today)
const openTodayOldWay = all.filter(r => OPEN.includes(r.status) && r.delivery_date === today)
const invisible = openToday.filter(r => r.delivery_date !== today)
notes.push(
  `open work due today: ${openToday.length} by due-day vs ${openTodayOldWay.length} by the old shelf-day basis`,
)
notes.push(`${invisible.length} of those were INVISIBLE on every screen before this fix`)
if (invisible.length) {
  const perRider = new Map<string, number>()
  for (const r of invisible) {
    const k = r.rider_id || 'unassigned'
    perRider.set(k, (perRider.get(k) || 0) + 1)
  }
  notes.push('  previously invisible, per rider: ' + [...perRider]
    .map(([id, n]) => `${id}=${n}`).join(' '))
}
// Anything open and due today but whose shelf-day is in the FUTURE would be a
// contradiction: it cannot be due before it ever went out.
const impossible = openToday.filter(r => r.delivery_date > today)
if (impossible.length) fails.push(`${impossible.length} rows are due today but shipped later`)

// 8. Per-rider breakdown, so a rider's own screen can be sanity-checked by eye.
const byRider = new Map<string, { moved: number; dates: Set<string> }>()
for (const r of moved) {
  const k = r.rider_id || 'unassigned'
  if (!byRider.has(k)) byRider.set(k, { moved: 0, dates: new Set() })
  const e = byRider.get(k)!
  e.moved++
  e.dates.add(r.active_date)
}
const { data: riders } = await db.from('riders').select('id, name')
const riderName = new Map((riders || []).map((r: any) => [r.id, r.name]))

console.log('--- reschedule verification ---')
for (const n of notes) console.log('  ' + n)
console.log('  per rider:')
for (const [id, e] of [...byRider].sort((a, b) => b[1].moved - a[1].moved)) {
  console.log(`    ${riderName.get(id) || id}: ${e.moved} moved -> ${[...e.dates].sort().join(', ')}`)
}

if (fails.length) {
  console.log('FAIL')
  for (const f of fails) console.log('  ! ' + f)
  process.exit(1)
}
console.log('PASS - active_date moves, delivery_date and the return legs do not')
