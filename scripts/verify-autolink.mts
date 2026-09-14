/**
 * Does automatic linking refuse to guess when the evidence is thin?
 *
 * These assertions pin REAL VALUES, not guard rails. The lesson from the last
 * round is that a suite can be entirely green while the feature is wrong,
 * because every assertion tested a boundary and none tested an answer. So each
 * case below states the decision it expects AND the reason, and the decoy case
 * uses the actual catalogue strings that already caused a wrong cost comparison.
 */
import { decideAutoLink } from '../lib/local-purchasing/autolink'
import type { Candidate } from '../lib/local-purchasing/suggest'

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

const cand = (over: Partial<Candidate> & { name: string; score: number }): Candidate => ({
  productId: over.productId ?? `id-${over.name.toLowerCase().replace(/\s+/g, '-')}`,
  name: over.name,
  score: over.score,
  reason: over.reason ?? 'Name match',
  importCount: over.importCount ?? 0,
  stock: over.stock ?? 0,
  lastImportCp: over.lastImportCp ?? null,
})

console.log('\nAutomatic linking\n')

// --- The decoy. This is the case that already cost real money. ---------------
{
  // Both names normalise to the same token signature, which is exactly why
  // scoring alone cannot separate them.
  const decision = decideAutoLink([
    cand({ name: 'Automatic Sweeping Robot', score: 100, reason: 'Exact name', importCount: 0, stock: 0 }),
    cand({ name: 'Sweeping Robot', score: 92, reason: 'Name match', importCount: 3, stock: 4 }),
  ])
  check(
    'DECOY: exact-name duplicate with no history is NOT auto-linked',
    decision.link === false,
    `got link=${decision.link} (${'reason' in decision ? decision.reason : ''})`,
  )
  check(
    'DECOY: the reason names the ambiguity so the buyer knows what to look at',
    decision.link === false && /similar|two|both|resembl/i.test(decision.reason),
    decision.link === false ? decision.reason : '',
  )
}

// --- A genuine single match -------------------------------------------------
{
  const decision = decideAutoLink([
    cand({ name: 'Wall Clock 30cm', score: 100, reason: 'Exact name', importCount: 5, stock: 12 }),
  ])
  check('single exact match with history IS auto-linked', decision.link === true)
  check(
    'auto-linked line carries the product it chose',
    decision.link === true && decision.productName === 'Wall Clock 30cm',
  )
}

// --- A learned alias: the whole point of compounding ------------------------
{
  const decision = decideAutoLink([
    cand({ name: 'Sweeping Robot', score: 96, reason: 'Known alias', importCount: 3 }),
  ])
  check('a KNOWN ALIAS is auto-linked (this is what learning buys)', decision.link === true)
}

// --- Weak evidence must ask -------------------------------------------------
{
  const decision = decideAutoLink([cand({ name: 'Some Cable', score: 62, reason: 'Partial match' })])
  check('a weak single candidate is NOT auto-linked', decision.link === false)
}

{
  const decision = decideAutoLink([])
  check('no candidates at all is NOT auto-linked', decideAutoLink([]).link === false)
  check(
    'the reason for nothing found does not blame the buyer',
    decision.link === false && /nothing|no /i.test(decision.reason),
    decision.link === false ? decision.reason : '',
  )
}

// --- Two clearly different products, one clearly better --------------------
{
  const decision = decideAutoLink([
    cand({ name: 'Office Chair Mesh', score: 100, reason: 'Exact name', importCount: 4, stock: 9 }),
    cand({ name: 'Office Desk Lamp', score: 58, reason: 'Partial match' }),
  ])
  check(
    'a decisive winner over an unrelated runner-up IS auto-linked',
    decision.link === true,
    decision.link === false ? decision.reason : '',
  )
}

// --- Two near-equal scores on DIFFERENT products: still ambiguous ----------
{
  const decision = decideAutoLink([
    cand({ name: 'Steel Bucket 10L', score: 88, reason: 'Name match', importCount: 2 }),
    cand({ name: 'Steel Bucket 12L', score: 86, reason: 'Name match', importCount: 2 }),
  ])
  check(
    'two near-equal candidates (10L vs 12L) are NOT auto-linked',
    decision.link === false,
    `got link=${decision.link}`,
  )
}

// --- Exact name, no duplicate, but zero history ---------------------------
{
  const decision = decideAutoLink([
    cand({ name: 'Ceiling Fan 56in', score: 100, reason: 'Exact name', importCount: 0, stock: 0 }),
  ])
  check(
    'an exact name with no twin IS auto-linked even with no import history',
    decision.link === true,
    decision.link === false ? decision.reason : '',
  )
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
