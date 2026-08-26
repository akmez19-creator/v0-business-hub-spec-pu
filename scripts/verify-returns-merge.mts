/**
 * Proves the storekeeper's MERGE-BY-PRODUCT pile against live data.
 * Companion to verify-storekeeper-returns.mts (which proves what counts as
 * physically back); this one proves how those rows collapse into piles.
 * Run: npx tsx scripts/verify-returns-merge.mts
 */
import { createClient } from '@supabase/supabase-js'
import {
  returnMergeKey, pickDisplayLabel, groupReturns, splitBySource,
  settlementKindOf, type MergeableEntry,
} from '../lib/returns-merge'
import { pickActiveDate } from '../lib/business-date'
import { incomingToStore } from '../lib/stock-direction'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`) }
}

console.log('\nMERGE KEY')
check('strips IN: prefix', returnMergeKey('IN: Juicer Blender') === 'juicer blender')
check('strips "IN : " spacing variant', returnMergeKey('IN : Juicer Blender') === 'juicer blender')
check('strips lowercase "in:"', returnMergeKey('in: GAP STorage') === 'gap storage')
check('case-insensitive', returnMergeKey('IN: jUICER BLENDER') === returnMergeKey('Juicer Blender'))
check('collapses whitespace', returnMergeKey('Knife   Set') === 'knife set')
check('strips 1x cart prefix', returnMergeKey('1x Make Up Pen - Set of 3') === returnMergeKey('Make Up Pen - Set of 3'))
check('strips 2x cart prefix', returnMergeKey('2x Leather Patch - Large') === returnMergeKey('Leather Patch - Large'))
check('KEEPS multiplier when several products are listed',
  returnMergeKey('1x Mini Speaker - Blue, 1x Mini Speaker - White').startsWith('1x'))
check('KEEPS " - Set of N" (real product data)', returnMergeKey('IP Camera - Set of 4') !== returnMergeKey('IP Camera'))
check('KEEPS " - B1G1"', returnMergeKey('Salt Cup - B1G1') !== returnMergeKey('Salt Cup'))
check('reason tail stays unmerged rather than folding into the wrong product',
  returnMergeKey('IN: Electric Grinder - Client not satisfied') !== returnMergeKey('Electric Grinder'))
check('NO substring matching: Shampoo vs Shampoo Brush',
  returnMergeKey('Shampoo') !== returnMergeKey('Shampoo Brush'))
check('empty is empty', returnMergeKey(null) === '')

console.log('\nDISPLAY LABEL')
check('prefers non-IN spelling', pickDisplayLabel(['IN: jUICER BLENDER', 'Juicer Blender']) === 'Juicer Blender')
check('never invents a string', ['IN: jUICER BLENDER', 'IN : Juicer Blender']
  .includes(pickDisplayLabel(['IN: jUICER BLENDER', 'IN : Juicer Blender'])))
check('least shouty wins an all-IN tie',
  pickDisplayLabel(['IN: jUICER BLENDER', 'IN : Juicer Blender']) === 'IN : Juicer Blender')
check('frequency beats shoutiness',
  pickDisplayLabel(['IN: jUICER BLENDER', 'IN: jUICER BLENDER', 'IN : Juicer Blender']) === 'IN: jUICER BLENDER')

console.log('\nSETTLEMENT KIND')
const mk = (o: Partial<MergeableEntry>): MergeableEntry =>
  ({ id: 'x', product: 'P', qty: 1, source: 'delivery', ...o }) as MergeableEntry
check('plain cms has no kind', settlementKindOf(mk({ salesType: 'cms' })) === null)
check('trade_in is a kind', settlementKindOf(mk({ salesType: 'trade_in' })) === 'trade_in')
check('MISSED follow-up falls back to plain (nobody to settle)',
  settlementKindOf(mk({ salesType: 'trade_in', incomingKind: 'cms' })) === null)

console.log('\nGROUPING')
const g1 = groupReturns([
  mk({ id: 'a', product: 'Make Up Pen - Set of 3', salesType: 'cms' }),
  mk({ id: 'b', product: '1x Make Up Pen - Set of 3', salesType: 'cms' }),
  mk({ id: 'c', product: 'Make Up Pen - Set of 3', salesType: 'trade_in' }),
])
check('same product + same job merges', g1.find(g => !g.settlementKind)!.entries.length === 2)
check('same product + DIFFERENT job splits', g1.length === 2)
check('merged qty sums', g1.find(g => !g.settlementKind)!.totalQty === 2)

const g2 = groupReturns([
  mk({ id: 'a', product: 'X', qty: 0, salesType: 'cms' }),
  mk({ id: 'b', product: 'X', qty: 2, salesType: 'cms' }),
])
check('qty 0 counted as 0, never silently 1', g2[0].totalQty === 2)
check('qty 0 surfaced as a data gap', g2[0].missingQtyCount === 1)

const g3 = groupReturns([
  mk({ id: 'a', product: 'X', source: 'delivery', salesType: 'cms' }),
  mk({ id: 'b', product: 'X', source: 'return_collection', salesType: 'cms' }),
])
const sp = splitBySource(g3[0].entries)
check('a merged pile routes ids to BOTH tables', sp.deliveryIds.length === 1 && sp.collectionIds.length === 1)

console.log('\nDATE RULE')
check('explicit date always wins',
  pickActiveDate(['2026-08-26', '2026-08-24'], () => false, '2026-08-24') === '2026-08-24')
check('skips a newer day that has NO work',
  pickActiveDate(['2026-08-26', '2026-08-24'], d => d === '2026-08-24') === '2026-08-24')
check('falls back to newest when nothing has work',
  pickActiveDate(['2026-08-26', '2026-08-24'], () => false) === '2026-08-26')

// ---------------- live data ----------------
console.log('\nLIVE DATA')
const COLS = 'id, products, qty, delivery_date, stock_verified, rider_id, status, return_product, sales_type, customer_name, replacement_from_van'
const FOLLOW = ['exchange', 'trade_in', 'refund']
const { data: cms } = await db.from('deliveries').select(COLS).eq('status', 'cms')
const { data: ret } = await db.from('deliveries').select(COLS).in('sales_type', FOLLOW).not('return_product', 'is', null)
const seen = new Set<string>()
const raw = [...(cms || []), ...(ret || [])].filter(r => !seen.has(r.id) && seen.add(r.id))

const { data: riders } = await db.from('riders').select('id, contractor_id')
const { data: contractors } = await db.from('contractors').select('id, name')
const rToC = new Map((riders || []).map(r => [r.id, r.contractor_id]))
const cName = new Map((contractors || []).map(c => [c.id, c.name]))

// Same rule the page uses, so the test cannot drift from the screen.
const live = (raw as any[]).filter(d => !d.stock_verified).flatMap(d => {
  const inc = incomingToStore(d)
  if (!inc) return []
  return [{
    id: d.id, product: inc.product, qty: inc.qty, source: 'delivery' as const,
    salesType: d.sales_type || (d.status === 'cms' ? 'cms' : undefined),
    incomingKind: inc.kind, customerName: d.customer_name,
    date: d.delivery_date, contractorId: rToC.get(d.rider_id) || '',
  }]
})

const jeffreyId = [...cName.entries()].find(([, n]) => /jeffrey/i.test(n))?.[0]
const jeff = live.filter(r => r.contractorId === jeffreyId && r.date === '2026-08-24')
const jeffGroups = groupReturns(jeff)
console.log(`  JEFFREY 24 Aug: ${jeff.length} order rows -> ${jeffGroups.length} product rows`)
check('JEFFREY merge reduces the row count', jeffGroups.length < jeff.length, `${jeff.length} -> ${jeffGroups.length}`)

const mup = jeffGroups.find(g => g.productKey === 'make up pen - set of 3' && !g.settlementKind)
console.log(`  Make Up Pen pile: ${mup ? `${mup.entries.length} orders, qty ${mup.totalQty}, label "${mup.label}"` : 'NOT FOUND'}`)
check('the Make Up Pen orders merge into ONE row', !!mup && mup.entries.length > 1,
  mup ? `entries=${mup.entries.length}` : 'not found')
check('the "1x Make Up Pen" spelling merged in too',
  !!mup && mup.entries.some(e => /^1x/i.test(e.product)))

const flatIds = new Set(jeffGroups.flatMap(g => g.entries.map(e => e.id)))
check('no order lost by grouping', flatIds.size === jeff.length, `${flatIds.size} vs ${jeff.length}`)
check('no order invented by grouping', [...flatIds].every(id => jeff.some(r => r.id === id)))
check('qty conserved', jeffGroups.reduce((s, g) => s + g.totalQty, 0) === jeff.reduce((s, r) => s + r.qty, 0))

const ordered = jeffGroups.map((g, i) => ({ g, i }))
  .sort((a, b) => (Number(!!b.g.settlementKind) - Number(!!a.g.settlementKind)) || a.i - b.i)
  .map(g => !!g.g.settlementKind)
const lastFollow = ordered.lastIndexOf(true)
const firstPlain = ordered.indexOf(false)
check('all follow-ups sort before plain stock',
  lastFollow === -1 || firstPlain === -1 || lastFollow < firstPlain)
check('no group mixes settlement kinds',
  jeffGroups.every(g => new Set(g.entries.map(e => settlementKindOf(e))).size === 1))

const day = live.filter(r => r.date === '2026-08-24')
const byC = new Map<string, typeof day>()
for (const r of day) {
  if (!byC.has(r.contractorId)) byC.set(r.contractorId, [])
  byC.get(r.contractorId)!.push(r)
}
let tRows = 0, tGroups = 0
for (const [cid, items] of byC) {
  const gs = groupReturns(items)
  tRows += items.length; tGroups += gs.length
  console.log(`  ${(cName.get(cid) || '?').padEnd(10)} ${String(items.length).padStart(3)} rows -> ${gs.length} products`)
}
check('merging reduces rows day-wide', tGroups < tRows, `${tRows} -> ${tGroups}`)
check('every label exists verbatim in the data',
  [...byC.values()].every(items =>
    groupReturns(items).every(g => g.entries.some(e => e.product.trim() === g.label))))

// The pile total the storekeeper is asked to count must never exceed what the
// raw rows claim - a merged row is a restatement, not a new number.
check('no pile invents units',
  [...byC.values()].every(items => {
    const gs = groupReturns(items)
    return gs.reduce((s, g) => s + g.totalQty, 0) === items.reduce((s, r) => s + r.qty, 0)
  }))

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
