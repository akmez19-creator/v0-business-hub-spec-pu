/**
 * RANKING BENCHMARK against real labelled data.
 *
 * Every China PO row is a (supplier label -> product the business linked it to)
 * pair. That is the only ground truth we have for "what did this wording mean".
 * The EASY pairs (label equals the product name, or is a learned alias) are
 * skipped - they score 100/96 regardless of the shared-word ranking. What is
 * left are the HARD pairs, where only the shared-word ranking decides the order
 * the buyer sees.
 *
 * Run before and after a ranking change. The numbers must move in the right
 * direction, and "auto-linked WRONG" must stay at zero.
 */
import { createAdminClient } from '../lib/supabase/server'
import { normalizeName } from '../lib/products/match'
import { suggestForLabels } from '../lib/local-purchasing/suggest'
import { decideAutoLink } from '../lib/local-purchasing/autolink'

const db = createAdminClient()

const [{ data: pos }, { data: products }, { data: aliases }] = await Promise.all([
  db.from('purchase_orders').select('product_name, product_id').not('product_id', 'is', null),
  db.from('products').select('id, name'),
  db.from('product_aliases').select('alias_name'),
])

const productName = new Map((products ?? []).map((p) => [p.id as string, p.name as string]))
const productNorm = new Map((products ?? []).map((p) => [p.id as string, normalizeName(p.name as string)]))
const aliasSet = new Set((aliases ?? []).map((a) => normalizeName(a.alias_name as string)))

// Distinct label -> the product it was linked to. If one label went to several
// products the truth is ambiguous; keep the most frequent.
const votes = new Map<string, Map<string, number>>()
for (const po of pos ?? []) {
  const label = String(po.product_name ?? '').trim()
  if (!label) continue
  const m = votes.get(label) ?? new Map()
  m.set(po.product_id as string, (m.get(po.product_id as string) ?? 0) + 1)
  votes.set(label, m)
}
const truth = new Map<string, string>()
for (const [label, m] of votes) truth.set(label, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0])

// Hard pairs only: labels that differ from the product's own name. Aliases are
// HELD OUT (ignoreAliases) - every PO label has already been learned, so with
// them on, the shared-word ranking is never exercised and the score is 0/0.
const hard = [...truth.entries()].filter(([label, pid]) => normalizeName(label) !== productNorm.get(pid))
console.log(
  `PO pairs: ${truth.size} distinct labels, ${hard.length} hard (label differs from product name; ${aliasSet.size} aliases held out)\n`,
)

const suggestions = await suggestForLabels(
  hard.map(([l]) => l),
  { ignoreAliases: true },
)

let top1 = 0
let top3 = 0
let none = 0
let autoLinked = 0
let autoWrong = 0
const wrongExamples: string[] = []
const misses: string[] = []

for (const [label, pid] of hard) {
  const cands = suggestions.get(label) ?? []
  const idx = cands.findIndex((c) => c.productId === pid)
  if (idx === 0) top1++
  if (idx >= 0 && idx < 3) top3++
  if (!cands.length) none++
  const v = decideAutoLink(cands)
  if (v.link) {
    autoLinked++
    if (v.productId !== pid) {
      autoWrong++
      wrongExamples.push(`  "${label}" -> linked ${v.productName}  (truth: ${productName.get(pid)})  [${v.reason}]`)
    }
  }
  if (idx !== 0 && misses.length < 12) {
    misses.push(
      `  "${label}"  truth=${productName.get(pid)}  rank=${idx < 0 ? 'absent' : idx + 1}  top=${cands[0]?.name ?? '-'} (${cands[0]?.score ?? '-'}: ${cands[0]?.reason ?? '-'})`,
    )
  }
}

console.log(`Truth ranked #1:      ${top1}/${hard.length}  (${((100 * top1) / hard.length).toFixed(1)}%)`)
console.log(`Truth in top 3:       ${top3}/${hard.length}  (${((100 * top3) / hard.length).toFixed(1)}%)`)
console.log(`No candidate at all:  ${none}`)
console.log(`Auto-linked:          ${autoLinked}   WRONG: ${autoWrong}`)
if (wrongExamples.length) console.log('\nAUTO-LINKED WRONG:\n' + wrongExamples.join('\n'))
console.log('\nSample of misses (truth not #1):\n' + misses.join('\n'))

// The specific case that started this.
const m90 = await suggestForLabels(['M90 earbuds', 'Earbuds M90 TWS Bluetooth', 'A9 earbuds', 'T9 trimmer rechargeable'])
for (const [label, cands] of m90) {
  const v = decideAutoLink(cands)
  console.log(`\n"${label}" -> ${v.link ? `LINK ${v.productName}` : `ASK: ${v.reason}`}`)
  for (const c of cands.slice(0, 3)) console.log(`    ${String(c.score).padStart(3)}  ${c.name.padEnd(36)} ${c.reason}`)
}
