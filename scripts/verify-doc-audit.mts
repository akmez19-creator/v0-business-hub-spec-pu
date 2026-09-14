/**
 * Proves the arithmetic safeguard actually FIRES, and only when it should.
 *
 * A check that never fires is decoration; a check that fires on every document
 * is noise the owner learns to ignore. Both failures are silent, so every case
 * below pins the expected outcome rather than merely calling the function.
 */
import { auditDoc, type DocExtraction } from '../lib/local-purchasing/extract'

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

const base: Omit<DocExtraction, 'declaredTotal' | 'lines'> = {
  docKind: 'invoice',
  supplierName: 'X',
  vatNumber: null,
  docRef: null,
  docDate: null,
  declaredSubtotal: null,
  declaredVat: null,
  pricesIncludeVat: null,
  discountPercent: null,
  legible: true,
  notes: null,
}
const line = (label: string, qty: number | null, unit: number | null, total: number | null) => ({
  label,
  code: null,
  qty,
  unitPrice: unit,
  lineTotal: total,
})
const mismatch = (w: string[]) => w.some((x) => x.includes('add up to'))

console.log('\n=== it must stay QUIET when the document reconciles ===')
{
  const w = auditDoc({
    ...base,
    declaredTotal: 300,
    lines: [line('A', 2, 100, 200), line('B', 1, 100, 100)],
  })
  check('an exact match produces no discrepancy warning', !mismatch(w), w.join(' | '))

  const vat = auditDoc({ ...base, declaredTotal: 345, lines: [line('A', 3, 100, 300)] })
  check('VAT added on top (300 -> 345) is recognised, not flagged', !mismatch(vat), vat.join(' | '))

  const disc = auditDoc({
    ...base,
    discountPercent: 20,
    declaredTotal: 240,
    lines: [line('A', 3, 100, 300)],
  })
  check('a 20% document discount (300 -> 240) is recognised', !mismatch(disc), disc.join(' | '))

  const round = auditDoc({ ...base, declaredTotal: 301.5, lines: [line('A', 3, 100, 300)] })
  check('a 1.50 rounding difference is tolerated', !mismatch(round), round.join(' | '))
}

console.log('\n=== it must FIRE when a figure is wrong ===')
{
  const w = auditDoc({
    ...base,
    declaredTotal: 500,
    lines: [line('A', 2, 100, 200), line('B', 1, 100, 100)],
  })
  check('a MISSING LINE is caught (declared 500, lines 300)', mismatch(w), w.join(' | '))
  check(
    'and the warning states BOTH real figures so it can be checked against the paper',
    w.some((x) => x.includes('300.00') && x.includes('500.00')),
    w.join(' | '),
  )

  const big = auditDoc({ ...base, declaredTotal: 300, lines: [line('A', 1, 3104, 3104)] })
  check('a unit price mis-read as a line total is caught', mismatch(big), big.join(' | '))
}

console.log('\n=== missing values are reported, never invented ===')
{
  const w = auditDoc({
    ...base,
    declaredTotal: 200,
    lines: [line('A', null, 100, null), line('B', 1, 100, 100)],
  })
  check(
    'a line with no printed quantity is reported',
    w.some((x) => x.includes('no quantity')),
    w.join(' | '),
  )
  check('and an unsummable line does NOT produce a false discrepancy', !mismatch(w), w.join(' | '))

  const noprice = auditDoc({ ...base, declaredTotal: 100, lines: [line('A', 2, null, null)] })
  check(
    'a line with no price at all is reported as uncomparable',
    noprice.some((x) => x.includes('no price at all')),
    noprice.join(' | '),
  )
}

console.log('\n=== a blurry document warns even when the maths works ===')
{
  const w = auditDoc({
    ...base,
    legible: false,
    declaredTotal: 300,
    lines: [line('A', 3, 100, 300)],
  })
  check(
    'an illegible document always tells the owner to check the paper',
    w.some((x) => x.includes('not fully sharp')),
    w.join(' | '),
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
