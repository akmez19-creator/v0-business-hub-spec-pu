/**
 * Runs automatic linking against the REAL catalogue.
 *
 * The pure tests use candidates I wrote by hand, so they prove my rules but not
 * that the live data produces the candidates those rules expect. This one asks
 * the actual matcher for the actual decoy and checks what would happen.
 */
import { suggestForLabels } from '../lib/local-purchasing/suggest'
import { decideAutoLink } from '../lib/local-purchasing/autolink'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

console.log('\nAutomatic linking against the live catalogue\n')

// The known decoy pair, and a label that should match nothing.
const labels = ['Sweeping Robot', 'Automatic Sweeping Robot', 'Zzq Nonexistent Widget 9981']
const suggestions = await suggestForLabels(labels)

for (const label of labels) {
  const cands = suggestions.get(label) ?? []
  const decision = decideAutoLink(cands)
  const top = cands[0]
  console.log(
    `\n  "${label}"\n    candidates: ${cands.length ? cands.map((c) => `${c.name} [${c.score}, ${c.importCount} imports]`).join(' | ') : 'none'}\n    decision: ${decision.link ? `LINK -> ${decision.productName}` : `ASK (${decision.reason})`}`,
  )

  if (label === 'Sweeping Robot' || label === 'Automatic Sweeping Robot') {
    // Whatever it decides, it must NOT silently attach a product with no
    // purchase history while a rival with history exists.
    const chosen = decision.link ? cands.find((c) => c.productId === decision.productId) : null
    const rivalWithHistory = cands.find(
      (c) => c.productId !== chosen?.productId && c.importCount > 0,
    )
    check(
      `"${label}" never auto-links a zero-history product over one with history`,
      !(chosen && chosen.importCount === 0 && rivalWithHistory),
      chosen
        ? `linked ${chosen.name} (${chosen.importCount} imports) over ${rivalWithHistory?.name}`
        : '',
    )
  }

  if (label.startsWith('Zzq')) {
    check('a label matching nothing is never auto-linked', decision.link === false)
  }
  void top
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
