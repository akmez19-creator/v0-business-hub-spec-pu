/**
 * Pins `cleanCopiedFigures` to the owner's screenshot (4 Sep 2026) and to the
 * names it must leave alone. Run: npx tsx scripts/verify-extract-labels.mts
 */
import { cleanCopiedFigures, type DocExtraction, type ExtractedLine } from '../lib/local-purchasing/extract'

const line = (label: string, o: Partial<ExtractedLine> = {}): ExtractedLine => ({
  label,
  code: null,
  qty: null,
  unitPrice: null,
  lineTotal: null,
  ...o,
})

const doc = (lines: ExtractedLine[]): DocExtraction => ({
  kind: 'receipt',
  supplierName: null,
  supplierVatNumber: null,
  docRef: null,
  docDate: null,
  discountPercent: null,
  declaredSubtotal: null,
  declaredVat: null,
  declaredTotal: null,
  pricesIncludeVat: null,
  legible: true,
  notes: null,
  lines,
}) as DocExtraction

let failed = 0
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

// --- The screenshot, verbatim -----------------------------------------------
{
  const r = cleanCopiedFigures(
    doc([
      line('washing machine cleaner 50', { qty: 364, unitPrice: 50 }),
      line('toothpaste, Niacinamide 140', { qty: 100, unitPrice: 140 }),
      line('Waterproof Spray 85', { qty: 24, unitPrice: 85 }),
    ]),
  )
  check(
    'owner screenshot: three prices come off',
    r.doc.lines.map((l) => l.label),
    ['washing machine cleaner', 'toothpaste, Niacinamide', 'Waterproof Spray'],
  )
  check('owner screenshot: touched = 3', r.touched, 3)
  check('figures untouched', r.doc.lines.map((l) => [l.qty, l.unitPrice]), [[364, 50], [100, 140], [24, 85]])
}

// --- Whole row copied: qty price total ---------------------------------------
{
  const r = cleanCopiedFigures(doc([line('Washing machine cleaner 364 50.00 18200.00', { qty: 364, unitPrice: 50, lineTotal: 18200 })]))
  check('qty+price+total all stripped', r.doc.lines[0].label, 'Washing machine cleaner')
}
{
  const r = cleanCopiedFigures(doc([line('Bulb Rs 45', { unitPrice: 45 })]))
  check('"Rs 45" stripped', r.doc.lines[0].label, 'Bulb')
}
{
  const r = cleanCopiedFigures(doc([line('Bulb 1,250', { unitPrice: 1250 })]))
  check('thousands comma stripped', r.doc.lines[0].label, 'Bulb')
}
{
  const r = cleanCopiedFigures(doc([line('Bulb 45', { unitPrice: 45.004 })]))
  check('half-cent tolerance', r.doc.lines[0].label, 'Bulb')
}

// --- Must NOT be touched ------------------------------------------------------
{
  const r = cleanCopiedFigures(doc([line('300G Waterproof Sealer', { unitPrice: 300 })]))
  check('leading size kept', r.doc.lines[0].label, '300G Waterproof Sealer')
}
{
  const r = cleanCopiedFigures(doc([line('Hanging Rope 10M', { unitPrice: 10 })]))
  check('"10M" is not a bare number', r.doc.lines[0].label, 'Hanging Rope 10M')
}
{
  const r = cleanCopiedFigures(doc([line('Tile 60x60', { unitPrice: 60 })]))
  check('"60x60" kept', r.doc.lines[0].label, 'Tile 60x60')
}
{
  const r = cleanCopiedFigures(doc([line('Cable Tie 100', { qty: 100, unitPrice: 55 })]))
  check('qty alone is NOT stripped (part of the name)', r.doc.lines[0].label, 'Cable Tie 100')
}
{
  const r = cleanCopiedFigures(doc([line('Bulb 45', { unitPrice: 46 })]))
  check('different number kept', r.doc.lines[0].label, 'Bulb 45')
}
{
  const r = cleanCopiedFigures(doc([line('50', { unitPrice: 50 })]))
  check('never stripped to nothing', r.doc.lines[0].label, '50')
}
{
  const r = cleanCopiedFigures(doc([line('Bulb 45', {})]))
  check('no figures on the line -> nothing to compare, kept', r.doc.lines[0].label, 'Bulb 45')
}
{
  const before = doc([line('Clean Name', { unitPrice: 50 })])
  const r = cleanCopiedFigures(before)
  check('untouched doc is returned as the same object', r.doc === before && r.touched === 0, true)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
