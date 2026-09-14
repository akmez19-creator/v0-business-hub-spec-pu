/**
 * Does the shared naming module produce the HOUSE name - two words, in the
 * shop's own vocabulary, correctly filed - from a real product photo?
 *
 * Takes real catalogue products that have a photo and a category, hides their
 * name behind a supplier-style label, and asks. A pass is: two (max three)
 * words, Title Case, and the category the shop actually filed it under. The
 * name is compared LOOSELY to the real one (shares the head noun), because
 * "Meat Slicer" for a row called "Electric Meat Slicer" is the point, not an
 * error.
 *
 *   npx tsx scripts/verify-house-name.mts
 */
import { createClient } from '@supabase/supabase-js'
import { houseName } from '../lib/products/house-name'
import { normaliseCategory } from '../lib/products/categories'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
const db = createClient(url, key)

const { data: all, error } = await db
  .from('products')
  .select('id,name,category,image_url')
  .order('id')
  .range(0, 1999)
if (error) throw error
const rows = (all ?? []) as { id: string; name: string; category: string | null; image_url: string | null }[]
console.log(`catalogue: ${rows.length} products`)

const vocabulary = rows.map((r) => r.name.trim()).filter(Boolean)
const perCategory = new Map<string, string[]>()
for (const r of rows) {
  const cat = normaliseCategory(r.category)
  if (!cat) continue
  const list = perCategory.get(cat) ?? []
  if (list.length < 6) list.push(r.name)
  perCategory.set(cat, list)
}
const categoryExamples = [...perCategory.entries()].flatMap(([category, names]) => names.map((name) => ({ name, category })))
console.log(`categories illustrated: ${perCategory.size}, examples: ${categoryExamples.length}`)

// Real rows with a photo and a canonical category, spread across categories.
const pool = rows.filter((r) => r.image_url && /^https?:\/\//.test(r.image_url) && normaliseCategory(r.category))
const picked: typeof pool = []
const seenCat = new Set<string>()
for (const r of pool) {
  const c = normaliseCategory(r.category)!
  if (seenCat.has(c)) continue
  seenCat.add(c)
  picked.push(r)
  if (picked.length >= 8) break
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const head = (s: string) => words(s).at(-1)?.toLowerCase().replace(/s$/, '') ?? ''
const isTitle = (s: string) => words(s).every((w) => /^[A-Z0-9]/.test(w))

let pass = 0
let fail = 0
for (const r of picked) {
  // A supplier-style label: lower case, a size, a marketing word - the mess
  // the dialog actually starts from.
  const messy = `${r.name.toLowerCase()} 2pcs premium`
  const t0 = Date.now()
  const res = await houseName({ imageUrl: r.image_url, currentName: messy, vocabulary, categoryExamples })
  const ms = Date.now() - t0
  const expectCat = normaliseCategory(r.category)
  if (!res) {
    fail++
    console.log(`FAIL  ${r.name}: no answer (${ms}ms)`)
    continue
  }
  const n = words(res.name).length
  const twoWords = n >= 1 && n <= 3
  const title = isTitle(res.name)
  const inVocab = vocabulary.some((v) => v.toLowerCase() === res.name.toLowerCase())
  const sameHead = head(res.name) === head(r.name)
  const catOk = res.category === expectCat
  const ok = twoWords && title && catOk && (inVocab || sameHead)
  if (ok) pass++
  else fail++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  "${r.name}" -> "${res.name}" [${res.category ?? 'null'}] ` +
      `(${n}w${title ? '' : ' NOT-TITLE'}${inVocab ? ' in-vocab' : sameHead ? ' same-head' : ' DIFFERENT'}` +
      `${catOk ? '' : ` cat!=${expectCat}`}) ${res.source} ${ms}ms - ${res.reason}`,
  )
}

/*
 * ROUND 2 - a product the shop has NEVER HAD. The row's own name is removed
 * from the vocabulary and the label is what a supplier actually prints for an
 * unknown item ("ITEM 4471 2PCS"), so the photo is the only evidence. Pass:
 * two/three Title Case words, right category, and the head noun is the same
 * thing the shop's real name says it is.
 */
console.log('\n--- round 2: product not in the catalogue, useless label ---')
let pass2 = 0
let fail2 = 0
for (const r of picked) {
  const hidden = vocabulary.filter((v) => v.toLowerCase() !== r.name.toLowerCase())
  const t0 = Date.now()
  const res = await houseName({ imageUrl: r.image_url, currentName: 'ITEM 4471 2PCS', vocabulary: hidden, categoryExamples })
  const ms = Date.now() - t0
  const expectCat = normaliseCategory(r.category)
  if (!res) {
    fail2++
    console.log(`FAIL  ${r.name}: no answer (${ms}ms)`)
    continue
  }
  const n = words(res.name).length
  const twoWords = n >= 1 && n <= 3
  const title = isTitle(res.name)
  const sameHead = head(res.name) === head(r.name)
  const catOk = res.category === expectCat
  const ok = twoWords && title && catOk
  if (ok) pass2++
  else fail2++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  photo of "${r.name}" -> "${res.name}" [${res.category ?? 'null'}] ` +
      `(${n}w${title ? '' : ' NOT-TITLE'}${sameHead ? ' same-head' : ' other-words'}${catOk ? '' : ` cat!=${expectCat}`}) ${ms}ms - ${res.reason}`,
  )
}

console.log(`\nround 1: ${pass} passed, ${fail} failed   round 2: ${pass2} passed, ${fail2} failed`)
if (fail + fail2 > 0) process.exit(1)
