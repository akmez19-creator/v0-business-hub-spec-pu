/**
 * Runs the REAL document reader against a REAL photographed invoice.
 *
 * Pins actual values, not guard rails. The known figures on the test invoice:
 *   Automatic Sweeping Robot  DT1057  qty 10  @ 210.00  = 2100.00
 *   Silicone Pads             DT9002  qty 24  @  12.50  =  300.00
 *   Hanging Rope With Hooks   DT2001  qty  5  @  89.50  =  447.50
 *   EMS Foot Massager         DT7745  qty  2  @ 1250.00 = 2500.00
 *   Sub Total 5347.50   VAT 15% 802.13   TOTAL 6149.63
 *
 * The invoice also has TWO BLANK table rows, which must NOT become products,
 * and a "P.U." column that must not be confused with the "Total" column.
 *
 * Run twice to check STABILITY: the payment-proof reader was stable on amounts
 * but NOT on reference strings, so multi-line reads must be checked, not assumed.
 */
import { readFileSync } from 'node:fs'
import { extractPurchaseDocument } from '../lib/local-purchasing/extract'

const RUNS = Number(process.env.RUNS ?? 2)

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const file = readFileSync('.v0-tmp/test-invoice.png')
const results: Awaited<ReturnType<typeof extractPurchaseDocument>>[] = []

for (let i = 0; i < RUNS; i++) {
  const r = await extractPurchaseDocument(file, 'image/png')
  results.push(r)
  console.log(`\n--- run ${i + 1}: status=${r.status} ---`)
  if (r.status === 'ok' || r.status === 'suspect') {
    console.log(
      `  supplier=${r.doc.supplierName} vat=${r.doc.vatNumber} ref=${r.doc.docRef} kind=${r.doc.docKind}`,
    )
    console.log(
      `  declared: sub=${r.doc.declaredSubtotal} vat=${r.doc.declaredVat} total=${r.doc.declaredTotal}`,
    )
    for (const l of r.doc.lines) {
      console.log(
        `  line: "${l.label}" code=${l.code} qty=${l.qty} unit=${l.unitPrice} total=${l.lineTotal}`,
      )
    }
    if (r.warnings.length) console.log(`  warnings: ${r.warnings.join(' | ')}`)
  } else {
    console.log(`  message: ${r.message}`)
  }
}

const first = results[0]
console.log('\n=== the read itself ===')
check('the document was read', first.status === 'ok' || first.status === 'suspect', first.status)

if (first.status === 'ok' || first.status === 'suspect') {
  const d = first.doc
  check('recognised as an invoice', d.docKind === 'invoice', d.docKind)
  check('supplier name read', (d.supplierName ?? '').toUpperCase().includes('MORIS'), `${d.supplierName}`)
  check('VAT number read exactly', d.vatNumber === 'VAT20456789', `${d.vatNumber}`)
  check('invoice ref read', (d.docRef ?? '').includes('144'), `${d.docRef}`)

  console.log('\n=== the blank rows must not become products ===')
  check('exactly 4 product lines, not 6', d.lines.length === 4, `got ${d.lines.length}`)

  console.log('\n=== unit price vs line total (the expensive confusion) ===')
  const robot = d.lines.find((l) => /sweeping robot/i.test(l.label))
  check('the Sweeping Robot line was found', !!robot, d.lines.map((l) => l.label).join(' | '))
  if (robot) {
    check('qty is 10', robot.qty === 10, `${robot.qty}`)
    check('unit price is 210, NOT the 2100 line total', robot.unitPrice === 210, `${robot.unitPrice}`)
    check('line total is 2100', robot.lineTotal === 2100, `${robot.lineTotal}`)
    check('supplier code DT1057', robot.code === 'DT1057', `${robot.code}`)
  }
  const massager = d.lines.find((l) => /massager/i.test(l.label))
  if (massager) {
    check(
      'the 4-figure price 1250 is read as the unit price (qty 2, total 2500)',
      massager.unitPrice === 1250 && massager.qty === 2 && massager.lineTotal === 2500,
      `qty=${massager.qty} unit=${massager.unitPrice} total=${massager.lineTotal}`,
    )
  }
  const pads = d.lines.find((l) => /silicone/i.test(l.label))
  if (pads) {
    check(
      'the decimal price 12.50 x 24 is exact',
      pads.unitPrice === 12.5 && pads.qty === 24,
      `qty=${pads.qty} unit=${pads.unitPrice}`,
    )
  }

  console.log('\n=== the declared totals drive the arithmetic check ===')
  check('declared total is 6149.63', d.declaredTotal === 6149.63, `${d.declaredTotal}`)
  check('declared subtotal is 5347.50', d.declaredSubtotal === 5347.5, `${d.declaredSubtotal}`)
  check('declared VAT is 802.13', d.declaredVat === 802.13, `${d.declaredVat}`)

  // Lines sum to 5347.50; the declared TOTAL is 6149.63 because VAT is added
  // on top. The audit must recognise that as reconciled, NOT flag it.
  check(
    'lines reconcile with the total via VAT, so it is NOT flagged as suspect',
    first.status === 'ok',
    `status=${first.status} warnings=${first.warnings.join(' | ')}`,
  )

  console.log('\n=== labels are copied verbatim for matching ===')
  check(
    'the label keeps the supplier\'s own wording "Automatic Sweeping Robot"',
    d.lines.some((l) => l.label.trim() === 'Automatic Sweeping Robot'),
    d.lines.map((l) => `"${l.label}"`).join(' | '),
  )
}

if (results.length > 1) {
  console.log('\n=== stability across runs ===')
  const sig = (r: (typeof results)[number]) =>
    r.status === 'ok' || r.status === 'suspect'
      ? JSON.stringify(
          r.doc.lines.map((l) => [l.label.trim().toLowerCase(), l.qty, l.unitPrice]).sort(),
        )
      : r.status
  const all = results.map(sig)
  check(
    `all ${results.length} runs read the same quantities and unit prices`,
    all.every((s) => s === all[0]),
    all.join('\n         VS \n'),
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
