/**
 * Runs the REAL Quotation 144 through the cross-check and prints the verdicts,
 * so the maths is checked against a document the owner has in his hand rather
 * than against invented numbers.
 */
import { fetchChinaCostRefs, fetchProductRefs } from '../lib/local-purchasing/costs'
import { compareLine, vatBreakdown, netUnitPrice, chooseChinaReference } from '../lib/local-purchasing/vat'
import { connect } from '../lib/products/pg'

// Quotation 144, verbatim. Header discount 20%, VAT 15%.
const LINES = [
  { label: 'Automatic Sweeping Robot', code: 'DT1057', qty: 10, gross: 210 },
  { label: 'Cooking Oil Sprayer', code: 'DT1082', qty: 20, gross: 165 },
  { label: 'Pest Repelling Aid', code: 'DT1090', qty: 50, gross: 60 },
  { label: 'Drum Paint', code: 'DT1131', qty: 5, gross: 1250 },
  { label: 'EMS FootMassager', code: 'DT1146', qty: 8, gross: 900 },
]
const HEADER_DISCOUNT = 20
const VAT = 15

const client = await connect()
let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ' - ' + detail}`)
}

try {
  console.log('=== VAT maths, against the printed document ===')
  // The quotation totals: subtotal 25,690, discount 5,138, net 20,552,
  // VAT 3,082.80, total 23,634.80.
  const net = netUnitPrice(25690, HEADER_DISCOUNT)
  const b = vatBreakdown(net, VAT, true)
  check('discount reproduces the printed net (20,552)', b.net === 20552, `got ${b.net}`)
  check('VAT reproduces the printed 3,082.80', b.vat === 3082.8, `got ${b.vat}`)
  check('gross reproduces the printed 23,634.80', b.gross === 23634.8, `got ${b.gross}`)
  check('reclaimable VAT is excluded from the cost', b.effectiveCost === 20552, `got ${b.effectiveCost}`)

  const nonReclaim = vatBreakdown(net, VAT, false)
  check(
    'NON-registered supplier: VAT becomes a real cost',
    nonReclaim.effectiveCost === 23634.8,
    `got ${nonReclaim.effectiveCost}`,
  )

  console.log('\n=== Per line, matched by hand to the RIGHT product ===')
  // Matched by hand deliberately: the automatic matcher picks the decoy
  // "Automatic Sweeping Robot" (0 POs) over the real "Sweeping Robot" (3 POs).
  const NAMES: Record<string, string> = {
    'Automatic Sweeping Robot': 'Sweeping Robot',
    'Cooking Oil Sprayer': 'Cooking Oil Sprayer',
    'Pest Repelling Aid': 'Pest Repellent',
    'Drum Paint': 'Drum Paint',
    'EMS FootMassager': 'EMS Foot Massager',
  }

  const { rows: prods } = await client.query(
    `select id, name from products where name = any($1)`,
    [Object.values(NAMES)],
  )
  const idByName = new Map(prods.map((p: { id: string; name: string }) => [p.name, p.id]))

  const ids = [...idByName.values()] as string[]
  const china = await fetchChinaCostRefs(ids)
  const refs = await fetchProductRefs(ids)

  for (const line of LINES) {
    const target = NAMES[line.label]
    const pid = idByName.get(target) as string | undefined
    const localNet = netUnitPrice(line.gross, HEADER_DISCOUNT)
    const cmp = compareLine({
      localNetUnit: localNet,
      qty: line.qty,
      vatPercent: VAT,
      vatReclaimable: true,
      china: pid ? (china.get(pid) ?? null) : null,
      stockOnHand: pid ? (refs.get(pid)?.stockOnHand ?? null) : null,
      linked: Boolean(pid),
    })
    console.log(
      `\n  ${line.label}  (x${line.qty})` +
        `\n    -> ${target}${pid ? '' : '  [NOT IN MASTER]'}` +
        `\n    local net Rs ${localNet.toFixed(2)}/u   china Rs ${
          cmp.chinaUnitCost == null ? '-' : cmp.chinaUnitCost.toFixed(2)
        }/u   stock ${cmp.stockOnHand ?? '-'}` +
        `\n    ${cmp.verdict.toUpperCase()}  ${cmp.message}` +
        (cmp.totalDifference == null
          ? ''
          : `\n    across ${line.qty} units: ${cmp.totalDifference > 0 ? '+' : ''}Rs ${cmp.totalDifference.toFixed(2)}`),
    )
  }

  console.log('\n=== The outlier trap, pinned to real values ===')
  // THIS IS THE ASSERTION THAT WAS MISSING. The first run of this script printed
  // "94.6% cheaper than importing" for the Sweeping Robot and still reported
  // "9 passed, 0 failed", because every assertion was about guard rails and none
  // about the actual number. A test that cannot fail on a wrong answer is not a
  // test. The real landed costs are Rs 131.43 and Rs 133.56; the Rs 3,104.55
  // "Cleaning Cart" PO must be rejected.
  const srId = idByName.get('Sweeping Robot') as string | undefined
  if (srId) {
    const ref = china.get(srId)
    check(
      'Sweeping Robot reference is the real Rs 133.56, NOT the Rs 3,104.55 Cleaning Cart row',
      ref?.landedUnitCost === 133.56,
      `got ${ref?.landedUnitCost}`,
    )
    check(
      'the Cleaning Cart row is reported as suspect rather than silently dropped',
      (ref?.suspectRows ?? []).some((r) => r.landedUnitCost === 3104.55),
      `suspects: ${JSON.stringify(ref?.suspectRows?.map((r) => r.landedUnitCost))}`,
    )
    const cmp = compareLine({
      localNetUnit: netUnitPrice(210, HEADER_DISCOUNT),
      qty: 10,
      china: ref ?? null,
      linked: true,
    })
    check(
      'and the verdict flips to LOCAL_DEARER, which is the truth',
      cmp.verdict === 'local_dearer',
      `got ${cmp.verdict} (${cmp.variancePercent}%)`,
    )
  } else {
    check('Sweeping Robot present for the outlier test', false, 'product not found')
  }

  console.log('\n=== Guard rails ===')
  // Two costed rows must NOT trigger outlier rejection - with no majority the
  // "outlier" could just as easily be the correct row.
  const twoRows = chooseChinaReference(
    [
      { landedUnitCost: 100, importedAt: '2026-01-01', qty: 10, supplierName: null, label: 'a' },
      { landedUnitCost: 9000, importedAt: '2026-02-01', qty: 1, supplierName: null, label: 'b' },
    ],
    2,
  )
  check(
    'with only two costed rows nothing is rejected (no majority to judge against)',
    twoRows.suspectRows?.length === 0 && twoRows.landedUnitCost === 9000,
    `got ${twoRows.landedUnitCost}, ${twoRows.suspectRows?.length} suspects`,
  )

  // Genuine shipment-to-shipment variation must survive.
  const varied = chooseChinaReference(
    [
      { landedUnitCost: 100, importedAt: '2026-01-01', qty: 500, supplierName: null, label: 'a' },
      { landedUnitCost: 135, importedAt: '2026-02-01', qty: 500, supplierName: null, label: 'b' },
      { landedUnitCost: 170, importedAt: '2026-03-01', qty: 500, supplierName: null, label: 'c' },
    ],
    3,
  )
  check(
    'a 70% swing between real shipments is NOT treated as an outlier',
    varied.suspectRows?.length === 0 && varied.landedUnitCost === 170,
    `got ${varied.landedUnitCost}, ${varied.suspectRows?.length} suspects`,
  )

  // Uncosted POs must not read as "never imported".
  const uncosted = chooseChinaReference([], 3)
  check(
    'a product whose POs are all uncosted keeps orderCount but has no usable cost',
    uncosted.orderCount === 3 && uncosted.landedUnitCost === 0,
  )
  const uncostedCmp = compareLine({ localNetUnit: 168, qty: 1, china: uncosted, linked: true })
  check('...and reports no usable reference', uncostedCmp.verdict === 'no_china_history')

  const unlinked = compareLine({ localNetUnit: 168, qty: 10, china: null, linked: false })
  check(
    'unlinked line does NOT claim "never imported"',
    unlinked.verdict === 'unlinked' && !unlinked.message.includes('Never imported'),
  )

  // The decoy: a product that exists but has zero POs must read as no history.
  const { rows: decoy } = await client.query(
    `select id from products where name = 'Automatic Sweeping Robot' limit 1`,
  )
  if (decoy.length) {
    const decoyChina = await fetchChinaCostRefs([decoy[0].id])
    const c = compareLine({
      localNetUnit: 168,
      qty: 10,
      china: decoyChina.get(decoy[0].id) ?? null,
      linked: true,
    })
    check(
      'the DECOY product reports no China history (proving the link matters)',
      c.verdict === 'no_china_history',
      `got ${c.verdict}`,
    )
  }

  const band = compareLine({
    localNetUnit: 100,
    qty: 1,
    china: { landedUnitCost: 99, importedAt: null, qty: null, supplierName: null, orderCount: 1 },
    linked: true,
  })
  check('a 1% difference is "comparable", not a verdict', band.verdict === 'comparable')

  const stocked = compareLine({
    localNetUnit: 168,
    qty: 5,
    china: { landedUnitCost: 131, importedAt: null, qty: null, supplierName: null, orderCount: 3 },
    stockOnHand: 40,
    linked: true,
  })
  check('existing stock covering the quantity is flagged', stocked.stockCoversQty === true)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
