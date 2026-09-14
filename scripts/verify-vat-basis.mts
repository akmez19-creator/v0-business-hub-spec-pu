/**
 * Pins the VAT-basis arithmetic to the OWNER'S ACTUAL DOCUMENT.
 *
 * The bug: invoice QN2613500 from Li Ah Choon & Co.Ltd printed a total payable of
 * Rs 69,958.00 with VAT ALREADY INCLUDED. The app assumed prices exclude VAT,
 * added 15% on top, and showed Rs 80,451.70 payable - Rs 10,493.70 of invented
 * cost, plus a China comparison that made local look 15% dearer than it is.
 *
 * Every assertion below pins a REAL VALUE. My own process failure once shipped a
 * wrong number with "9 passed, 0 failed" because every assertion tested guard
 * rails and none pinned an actual figure.
 */
import { readFile } from 'node:fs/promises'
import {
  vatExclusive,
  detectVatBasis,
  vatBreakdown,
  netUnitPrice,
  round2,
  DEFAULT_VAT_PERCENT,
  purchaseUnitAmounts,
} from '../lib/local-purchasing/vat'

let passed = 0
let failed = 0
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}\n        ${detail}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}\n        ${detail}`)
  }
}

console.log('\n--- the real invoice: Rs 69,958.00, VAT-inclusive ---\n')

const DOC_TOTAL = 69958
const RATE = 15

// Detection: the lines add up to the printed total payable, so they include VAT.
const basisInclusive = detectVatBasis(DOC_TOTAL, DOC_TOTAL, RATE)
check(
  'a line sum equal to the printed total is recognised as VAT-INCLUSIVE',
  basisInclusive.pricesIncludeVat === true && !basisInclusive.uncertain,
  basisInclusive.reason,
)

// The figures the screen must now show for that document.
const netFromDoc = round2(DOC_TOTAL / 1.15)
// These two expectations were MINE and they were wrong first time (I wrote
// 60,833.91 / 9,124.09). The code was right; my mental arithmetic was not. Left
// as a note because it is the reason to pin real values rather than assert that
// two computed expressions agree - that would have "passed" either way.
check(
  'goods excluding VAT is 60,833.04, not 69,958.00',
  netFromDoc === 60833.04,
  `69,958.00 / 1.15 = ${netFromDoc.toFixed(2)}`,
)
const vatOnDoc = round2(DOC_TOTAL - netFromDoc)
check(
  'VAT contained in the document is 9,124.96',
  vatOnDoc === 9124.96,
  `69,958.00 - ${netFromDoc.toFixed(2)} = ${vatOnDoc.toFixed(2)}`,
)
check(
  'total payable stays exactly the printed 69,958.00',
  round2(netFromDoc + vatOnDoc) === DOC_TOTAL,
  `${netFromDoc.toFixed(2)} + ${vatOnDoc.toFixed(2)} = ${round2(netFromDoc + vatOnDoc).toFixed(2)} - the buyer pays what the invoice says`,
)

// The size of the bug, stated plainly.
const wrongTotal = round2(DOC_TOTAL * 1.15)
check(
  'the OLD behaviour overstated this document by 10,493.70',
  wrongTotal === 80451.7 && round2(wrongTotal - DOC_TOTAL) === 10493.7,
  `old screen said ${wrongTotal.toFixed(2)} payable vs the invoice's ${DOC_TOTAL.toFixed(2)}`,
)

console.log('\n--- divide, never subtract ---\n')

check(
  'Rs 210 inclusive at 15% strips to 182.61',
  round2(vatExclusive(210, 15, true)) === 182.61,
  `210 / 1.15 = ${round2(vatExclusive(210, 15, true)).toFixed(2)}`,
)
check(
  'the naive "minus 15%" answer of 178.50 is NOT produced',
  round2(vatExclusive(210, 15, true)) !== 178.5,
  'subtracting the rate instead of dividing is out by Rs 4.11 a unit',
)
check(
  'stripping then re-adding VAT returns the original price',
  round2(vatBreakdown(vatExclusive(210, 15, true), 15, true).gross) === 210,
  'round trip on 210 is exact, so the payable total always matches the document',
)

console.log('\n--- exclusive documents must be left alone ---\n')

check(
  'an exclusive price is returned unchanged',
  vatExclusive(168, 15, false) === 168,
  'Quotation 144 behaviour is untouched: 168 net stays 168',
)
// Quotation 144, from memory: list 210 less 20% = 168 net, +15% = 193.20 payable.
const q144 = vatBreakdown(netUnitPrice(vatExclusive(210, 15, false), 20), 15, true)
check(
  'Quotation 144 still gives 168.00 net and 193.20 payable',
  round2(q144.net) === 168 && round2(q144.gross) === 193.2,
  `net ${round2(q144.net).toFixed(2)}, payable ${round2(q144.gross).toFixed(2)} - the previously CORRECT case did not regress`,
)
const basisExclusive = detectVatBasis(168, 193.2, 15)
check(
  'lines that only reach the printed total after VAT are recognised as EXCLUSIVE',
  basisExclusive.pricesIncludeVat === false && !basisExclusive.uncertain,
  basisExclusive.reason,
)

console.log('\n--- discount and VAT order does not matter ---\n')

const stripFirst = netUnitPrice(vatExclusive(210, 15, true), 20)
const discountFirst = vatExclusive(netUnitPrice(210, 20), 15, true)
check(
  'stripping VAT before or after the discount gives the same net',
  round2(stripFirst) === round2(discountFirst),
  `${round2(stripFirst).toFixed(2)} either way, so the single conversion point is safe`,
)

console.log('\n--- undecidable documents ASK, they do not guess ---\n')

const noTotal = detectVatBasis(50000, null, RATE)
check(
  'no printed total is reported as uncertain',
  noTotal.uncertain === true,
  noTotal.reason,
)
const mismatch = detectVatBasis(50000, 91000, RATE)
check(
  'a total matching neither basis is reported as uncertain, not forced',
  mismatch.uncertain === true && mismatch.pricesIncludeVat === false,
  mismatch.reason,
)
check(
  'a 0% rate makes inclusive and exclusive identical',
  vatExclusive(210, 0, true) === 210,
  'no division by 1.00 surprises, and no divide-by-zero',
)

// Rounding across many lines must not push detection off a real document.
const tenLines = detectVatBasis(69957.4, DOC_TOTAL, RATE)
check(
  'per-line rounding of Rs 0.60 across 10 lines still detects INCLUSIVE',
  tenLines.pricesIncludeVat === true && !tenLines.uncertain,
  'tolerance absorbs rounding without being loose enough to confuse a 15% gap',
)

console.log('\n--- values MEASURED in the browser, pinned against regression ---\n')

/*
 * The real 2-line CSV (4 x Rs 210 + 2 x Rs 145 = Rs 1,130) read as VAT-INCLUSIVE.
 * These are the figures actually on screen, not recomputed expectations - a test
 * that asserts two computed expressions agree would have passed while the screen
 * showed Rs 1,299.50.
 */
const gross = 4 * 210 + 2 * 145

/*
 * Reproduces the app's ACTUAL rounding, which took me two wrong guesses to get
 * right - worth writing down because both wrong answers looked reasonable:
 *   - dividing the Rs 1,130 total once  -> 982.61 (one cent high)
 *   - rounding each unit to 2dp first   -> 982.62 (two cents high)
 * The real rule: `vatExclusive` keeps FOUR decimals (round4), the unit price
 * stays 182.6087, and only the line total is rounded to 2dp. Rounding a unit
 * price to cents before multiplying by qty is the classic invoice rounding
 * error, and it is what my second attempt did.
 */
const lineNet = (unit: number, qty: number) => round2(vatExclusive(unit, RATE, true) * qty)
const netAll = round2(lineNet(210, 4) + lineNet(145, 2))
check(
  'Rs 1,130 inclusive shows goods of Rs 982.60',
  netAll === 982.6,
  `182.6087 x 4 + 126.087 x 2, each line rounded = ${netAll.toFixed(2)} (browser showed Rs 982.60)`,
)
check(
  'VAT of Rs 147.40 and total payable back to exactly Rs 1,130',
  round2(gross - netAll) === 147.4,
  `${netAll.toFixed(2)} + ${round2(gross - netAll).toFixed(2)} = ${gross.toFixed(2)} - the money actually paid`,
)
check(
  'the OLD behaviour would have inflated this to Rs 1,299.50',
  round2(gross * 1.15) === 1299.5,
  'that is the Rs 169.50 of invented cost this fixes, on a Rs 1,130 document',
)

/*
 * SOURCE GUARD, not a behaviour test.
 *
 * The bug that survived my first pass was a MISSING DEPENDENCY: clicking
 * "Include VAT" changed the wording under the totals but left the money on the
 * old basis, because the re-run effect was not keyed on it. No unit test of
 * vat.ts can see that, so this asserts the wiring in the component itself.
 */
const entry = await readFile(
  new URL('../components/local-purchasing/purchase-entry.tsx', import.meta.url),
  'utf8',
)
check(
  'all term handlers invalidate and recheck, including both supplier pickers',
  /const changeTerms[\s\S]*?setAnalysis\(\{\}\)[\s\S]*?scheduleRecheck\(\)/.test(entry) &&
    ['setSupplierId(e.target.value)', 'setSupplierId(docSupplier.known!.id)', 'setSupplierId(created.id)', 'setVatPercent(e.target.value)', 'setDiscountPercent(e.target.value)', 'setVatBasis({'].every((setter) => entry.includes(`changeTerms(() => ${setter}`)),
  'handlers drop the old results synchronously instead of fetching from an effect',
)
check(
  'late responses cannot repaint a newer receipt or VAT basis',
  entry.includes('version !== analysisVersion.current || requestTerms !== termsRevisionRef.current') &&
    entry.includes('answer.lineRevision === lineAnalysisRevision(line)'),
  'both request generation and current-input revisions must agree',
)
check(
  'creation receives live cost context rather than a captured unitCostNet',
  entry.includes('unitAmounts={creating ? unitAmountsFor(creating.lineKey) : null}') && !entry.includes('unitCostNet: net'),
  'VAT or price changes cannot leave an obsolete net value in the dialog',
)
check(
  'the save call sends pricesIncludeVat to the server',
  /pricesIncludeVat,/.test(entry.slice(entry.indexOf('savePurchaseAction'))),
  'otherwise the stored cost keeps the VAT in it forever',
)

const creamUnit = purchaseUnitAmounts({ enteredPrice: 40, vatPercent: 15, pricesIncludeVat: true, reclaimable: true })
check('Rs 40 inclusive is 34.7826 net, 5.22 VAT and 40 payable',
  creamUnit.unitPriceNet === 34.7826 && creamUnit.unitVat.vat === 5.22 && creamUnit.unitVat.gross === 40,
  JSON.stringify(creamUnit))
const creamLine = vatBreakdown(creamUnit.unitPriceNet * 3, 15, true)
check('three units use four-decimal costs, not the displayed 34.78',
  creamLine.net === 104.35 && creamLine.gross === 120,
  `line net ${creamLine.net}, payable ${creamLine.gross}`)
const discountedUnit = purchaseUnitAmounts({ enteredPrice: 210, vatPercent: 15, headerDiscountPercent: 20, reclaimable: true })
check('header discount is part of the shared stored-price calculation',
  discountedUnit.listPriceNet === 210 && discountedUnit.discountPercent === 20 && discountedUnit.unitPriceNet === 168 && discountedUnit.unitVat.gross === 193.2,
  JSON.stringify(discountedUnit))
const overrideUnit = purchaseUnitAmounts({ enteredPrice: 210, headerDiscountPercent: 20, discountPercent: 0 })
check('a zero line discount overrides, rather than inherits, header discount', overrideUnit.discountPercent === 0 && overrideUnit.unitPriceNet === 210, JSON.stringify(overrideUnit))
const unregistered = purchaseUnitAmounts({ enteredPrice: 40, vatPercent: 15, pricesIncludeVat: true, reclaimable: false })
check('non-reclaimable VAT stays in comparison cost but not in stored net', unregistered.unitPriceNet === 34.7826 && unregistered.unitVat.reclaimable === 0 && unregistered.unitVat.effectiveCost === 40, JSON.stringify(unregistered))

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
