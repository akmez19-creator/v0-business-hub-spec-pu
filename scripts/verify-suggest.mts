/**
 * Ranks the real Quotation 144 labels and checks the RIGHT product is offered
 * first - especially for the two the existing matcher got wrong.
 */
import { suggestForLabels } from '../lib/local-purchasing/suggest'

const LABELS = [
  'Automatic Sweeping Robot',
  'Cooking Oil Sprayer',
  'Pest Repelling Aid',
  'Drum Paint',
  'EMS FootMassager',
  'Nail Clipper Set',
  'Hanging Rope with Hooks',
]

// What a human would confirm, established by hand from the master list.
const EXPECTED: Record<string, string> = {
  'Automatic Sweeping Robot': 'Sweeping Robot',
  'Pest Repelling Aid': 'Pest Repellent',
  'EMS FootMassager': 'EMS Foot Massager',
}

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ' - ' + detail}`)
}

const suggestions = await suggestForLabels(LABELS)

for (const label of LABELS) {
  const list = suggestions.get(label) ?? []
  console.log(`\n"${label}"  ${list.length} candidate(s)`)
  for (const c of list.slice(0, 4)) {
    console.log(
      `   ${c.score.toString().padStart(3)}  ${c.name}` +
        `  [${c.importCount} import${c.importCount === 1 ? '' : 's'}` +
        `${c.landedUnitCost ? `, Rs ${c.landedUnitCost}/u` : ''}, stock ${c.stockOnHand ?? '-'}]` +
        `  - ${c.reason}`,
    )
  }
}

console.log('\n=== the lines the old matcher got wrong ===')
for (const [label, want] of Object.entries(EXPECTED)) {
  const list = suggestions.get(label) ?? []
  const top = list[0]
  check(
    `"${label}" offers "${want}" first`,
    top?.name === want,
    `got "${top?.name ?? 'nothing'}"`,
  )
  // Even when ranking is right, the alternative must still be visible - the
  // buyer has to be able to see the decoy to reject it knowingly.
  if (label === 'Automatic Sweeping Robot') {
    check(
      '...and the decoy is still OFFERED (visible, not hidden)',
      list.some((c) => c.name === 'Automatic Sweeping Robot'),
      `list: ${list.map((c) => c.name).join(' | ')}`,
    )
    const decoy = list.find((c) => c.name === 'Automatic Sweeping Robot')
    const real = list.find((c) => c.name === 'Sweeping Robot')
    check(
      '...and their import counts make the difference legible (0 vs 3)',
      decoy?.importCount === 0 && (real?.importCount ?? 0) >= 3,
      `decoy ${decoy?.importCount}, real ${real?.importCount}`,
    )
  }
}

console.log('\n=== one number, one derivation ===')
// The candidate list and the comparison panel must agree on the landed cost.
// They did NOT at first: this file computed "latest by date" independently and
// showed the Sweeping Robot at Rs 3,104.55/u (the mis-linked "Cleaning Cart" PO)
// while the comparison correctly said Rs 133.56. Pinned so it cannot drift back.
{
  const real = (suggestions.get('Automatic Sweeping Robot') ?? []).find(
    (c) => c.name === 'Sweeping Robot',
  )
  check(
    'the candidate list shows Rs 133.56/u, the same figure the comparison uses',
    real?.landedUnitCost === 133.56,
    `got ${real?.landedUnitCost}`,
  )
}

console.log('\n=== short words are not mangled into plurals ===')
{
  const list = suggestions.get('EMS FootMassager') ?? []
  check(
    '"Silicone Pads" (matched via "ems" -> "em" -> "empty") is gone from the list',
    !list.some((c) => c.name.toLowerCase().includes('silicone pad')),
    `list: ${list.map((c) => c.name).join(' | ')}`,
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
