/**
 * Repeated descriptions in one document, and the same-invoice guard.
 *
 * Pinned to the SHAPE of the owner's real PO imports (measured, not invented):
 *   po_1787167921665  179 rows, 173 distinct names, 6 repeat over 12 rows
 *   po_1786975311459  152 rows, 138 distinct names, 14 repeat over 28 rows
 *   one batch had the same product+qty+price on 4 rows (3 "extra")
 * The pure part runs with no database. The live part checks the guard's
 * matching against the real column, in a rolled-back transaction.
 */
import { summariseRepeats, sameDescriptionKeys, repeatKey } from '../lib/local-purchasing/repeats'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
  ok ? passed++ : failed++
}

const L = (key: string, supplierLabel: string, qty: number | string, unitPriceGross: number | string) => ({
  key,
  supplierLabel,
  qty,
  unitPriceGross,
})

console.log('\n--- decisions, not rows ---\n')

// The 152-row shape in miniature: 6 rows, 3 descriptions, 2 of which repeat.
// (I first wrote "4 decisions" here and the code said 3. The code was right -
// Pest x3, Sweeping x2, Bamboo x1 IS three descriptions. Pin real counts.)
const doc = [
  L('l1', 'Pest Repelling Aid DT5854', 4, 210),
  L('l2', 'Sweeping Robot DT6077 - 8088', 2, 145),
  L('l3', 'pest repelling aid  dt5854', 6, 210), // same item, messier spelling, different qty
  L('l4', 'Bamboo Corner Whatnot', 3, 450),
  L('l5', 'Sweeping Robot DT6077 - 8088', 2, 145), // IDENTICAL to l2 - copy-paste smell
  L('l6', 'Pest Repelling Aid DT5854', 4, 210), // identical to l1
]
const s = summariseRepeats(doc)

check('6 rows are 3 decisions', s.decisions === 3, `decisions = ${s.decisions}`)
check(
  '2 descriptions repeat, covering 5 rows',
  s.repeatedDescriptions === 2 && s.rowsInRepeats === 5,
  `repeated = ${s.repeatedDescriptions}, rows in repeats = ${s.rowsInRepeats}`,
)
check(
  'case and double spaces do not split a group',
  repeatKey('pest repelling aid  dt5854') === repeatKey('Pest Repelling Aid DT5854'),
  'the PO import compares on a normalised key for the same reason',
)
check(
  'exactly 2 rows are identical repeats (l5 of l2, l6 of l1) - l3 is NOT, its qty differs',
  s.identicalRows === 2,
  `identicalRows = ${s.identicalRows} (a different qty at the same price is a second order line, not a duplicate)`,
)

console.log('\n--- one answer links every row with that description ---\n')

const linked = sameDescriptionKeys(doc, 'l3')
check(
  'confirming l3 also links l1 and l6',
  linked.length === 3 && ['l1', 'l3', 'l6'].every((k) => linked.includes(k)),
  `keys = ${linked.join(', ')}`,
)
check(
  'and never touches a different description',
  !linked.includes('l2') && !linked.includes('l4') && !linked.includes('l5'),
  'the Sweeping Robot and Bamboo rows are untouched',
)
check(
  'a lone description links only itself',
  sameDescriptionKeys(doc, 'l4').join() === 'l4',
  `keys = ${sameDescriptionKeys(doc, 'l4').join(', ')}`,
)
check(
  'an unknown key falls back to itself rather than throwing',
  sameDescriptionKeys(doc, 'nope').join() === 'nope',
  'a stale key from a removed line must not crash the confirm',
)

console.log('\n--- the measured PO shapes, reproduced ---\n')

// 179 rows / 173 names / 6 names on 12 rows: 167 singles + 6 doubles.
const po179 = [
  ...Array.from({ length: 167 }, (_, i) => L(`s${i}`, `Single product ${i}`, 1, 10)),
  ...Array.from({ length: 6 }, (_, i) => [L(`d${i}a`, `Double product ${i}`, 1, 10), L(`d${i}b`, `Double product ${i}`, 2, 10)]).flat(),
]
const s179 = summariseRepeats(po179)
check(
  '179 rows -> 173 decisions, 6 repeats over 12 rows (po_1787167921665)',
  po179.length === 179 && s179.decisions === 173 && s179.repeatedDescriptions === 6 && s179.rowsInRepeats === 12,
  `${po179.length} rows, ${s179.decisions} decisions, ${s179.repeatedDescriptions} repeats, ${s179.rowsInRepeats} rows`,
)
check(
  'those repeats have different quantities, so none is flagged identical',
  s179.identicalRows === 0,
  `identicalRows = ${s179.identicalRows} - a repeat is not a duplicate`,
)

// The genuine 4-row identical case from the PO data.
const four = Array.from({ length: 4 }, (_, i) => L(`q${i}`, 'Same thing four times', 5, 99))
const s4 = summariseRepeats(four)
check(
  '4 identical rows are 1 decision with 3 extra rows flagged - and all 4 KEPT',
  s4.decisions === 1 && s4.identicalRows === 3 && s4.groups[0].keys.length === 4,
  `decisions = ${s4.decisions}, identical = ${s4.identicalRows}, keys kept = ${s4.groups[0].keys.length}`,
)

console.log('\n--- 470 lines is not a performance problem ---\n')
const big = Array.from({ length: 470 }, (_, i) => L(`b${i}`, `Product ${i % 400}`, 1 + (i % 3), 100 + (i % 7)))
const t0 = performance.now()
const sBig = summariseRepeats(big)
const ms = performance.now() - t0
check(
  '470 rows summarised in well under a frame',
  ms < 16 && sBig.decisions === 400,
  `${ms.toFixed(2)} ms, ${sBig.decisions} decisions for ${big.length} rows (runs on every keystroke, so this matters)`,
)

if (process.argv.includes('--live')) {
if (process.env.LOCAL_PURCHASING_TEST_APPROVED !== '1') throw new Error('Live fixture writes require explicit approval and LOCAL_PURCHASING_TEST_APPROVED=1.')
console.log('\n--- same-invoice guard, against the real table ---\n')

const { connect } = await import('../lib/products/pg')
const c = await connect()
try {
  await c.query('begin')

  const { rows: sup } = await c.query<{ id: string }>(
    `insert into local_suppliers (name) values ('V0TEST Guard Supplier') returning id`,
  )
  const supplierId = sup[0].id
  await c.query(
    `insert into local_purchases (supplier_id, doc_ref, purchase_date) values ($1, 'QN2613500', '2026-08-31')`,
    [supplierId],
  )

  // Mirror of the action's ilike-with-escaped-wildcards test.
  const hit = async (ref: string) => {
    const escaped = ref.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)
    const { rows } = await c.query(
      `select id from local_purchases where supplier_id = $1 and doc_ref ilike $2`,
      [supplierId, escaped],
    )
    return rows.length
  }

  check('exact reference is found', (await hit('QN2613500')) === 1, 'QN2613500')
  check('lower case + trailing space is the same document', (await hit('qn2613500 ')) === 1, '"qn2613500 "')
  check('a different reference is NOT found', (await hit('QN2613501')) === 0, 'QN2613501 - off by one digit')
  check(
    'wildcards in the typed reference are literal, not patterns',
    (await hit('QN261350%')) === 0,
    '"QN261350%" must not match - ilike would treat % as any-suffix without the escape',
  )
  check(
    'the suggested "-2" suffix makes it a new document',
    (await hit('QN2613500-2')) === 0,
    'QN2613500-2 - the way out when a supplier genuinely reissues a number',
  )
} finally {
  await c.query('rollback')
  await c.end()
}

console.log('\n--- the APP\'s own guard, not a mirror of it ---\n')

/*
 * Everything above re-wrote the query by hand, which cannot catch the app's
 * copy being wrong. This calls the real `findExistingPurchase` (the one both
 * the save guard and the early warning use) against a purchase saved through
 * the real UI a moment ago: V0TEST Supplier Ltd / V0TEST-DUP-1, 6 lines.
 */
const { findExistingPurchase } = await import('../lib/local-purchasing/existing')
const { createAdminClient } = await import('../lib/supabase/server')
const admin = createAdminClient()
const { data: testSup } = await admin.from('local_suppliers').select('id').eq('name', 'V0TEST Supplier Ltd').maybeSingle()

if (!testSup) {
  console.log('SKIP  no V0TEST Supplier Ltd row - the live UI fixture is not present')
} else {
  const found = await findExistingPurchase(testSup.id, 'v0test-dup-1 ')
  check(
    'the real function finds the UI-saved purchase from a sloppy reference',
    !!found && found.docRef === 'V0TEST-DUP-1' && found.lineCount === 6,
    found ? `found ${found.docRef}, ${found.lineCount} lines, Rs ${found.total.toFixed(2)}` : 'NOT FOUND',
  )
  check(
    'its total is the 6 lines summed on the stored VAT-exclusive basis',
    !!found && found.total === 6020,
    `4x210 + 3x450 + 2x145 + 5x450 + 4x210 + 1x450 = 6,020.00; got ${found?.total}`,
  )
  check(
    'a different reference for the same supplier is not found',
    (await findExistingPurchase(testSup.id, 'V0TEST-DUP-2')) === null,
    'V0TEST-DUP-2',
  )
  check('no supplier means no check (nothing to compare against)', (await findExistingPurchase(null, 'V0TEST-DUP-1')) === null, 'supplierId null')
}

}

/*
 * SOURCE GUARD: the throw has to come BEFORE the header insert, or the check
 * runs after the damage. A unit test cannot see ordering inside the action.
 * Inserts now live inside one guarded RPC; the isolated order suite exercises
 * the real uniqueness constraint, concurrent saves and rollback behavior.
 */
const { readFile } = await import('node:fs/promises')
const actions = await readFile(new URL('../app/dashboard/purchasing/local/actions.ts', import.meta.url), 'utf8')
const saveBody = actions.slice(actions.indexOf('export async function savePurchaseAction'), actions.indexOf('export async function learnAliasAction'))
const service = await readFile(new URL('../lib/local-purchasing/purchase-service.ts', import.meta.url), 'utf8')
const rpcAt = service.indexOf("await db.rpc('local_commit_purchase'")
const guardAt = service.indexOf("if (error?.code === '23505')")
const returnedAt = service.indexOf('return data as')
check(
  'savePurchaseAction delegates all receipt writes to the atomic purchase service',
  saveBody.includes('await persistLocalPurchase(db, userId, input)') && !saveBody.includes(".from('local_purchases')") && rpcAt > 0,
  'No independently inserted header can survive a failed line or duplicate reference.',
)
check(
  'the atomic purchase service surfaces duplicate-reference failures before returning success',
  rpcAt < guardAt && guardAt < returnedAt && /if \(error\?\.code === '23505'\) throw new Error/.test(service),
  'Live constraint and concurrency behavior is verified by verify-local-orders.mts --live.',
)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
