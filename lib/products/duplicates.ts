// Finding the same physical product entered twice under different names.
//
// Lives in lib/ and stays pure so it can be run against the real 874-row
// catalogue directly - the whole value of this feature is whether the pairs it
// proposes are actually duplicates, and that cannot be judged through a UI.
//
// The shape of the problem, measured on live data: 287 products are counted but
// have zero purchase orders, and 261 have purchase orders but were never
// counted. That near-mirror is the signature of one item existing twice - the
// storekeeper counts what is on the shelf, the buyer orders under the name on
// the invoice, and nothing joins the two.

export type DuplicateProduct = {
  id: string
  name: string
  quantity: number | null
  zone: string | null
  shelf_code: string | null
  last_counted_at: string | null
  po_count: number
  image_count: number
}

export type DuplicateReason = 'identical' | 'typo'

export type DuplicatePair = {
  /** The product that keeps its identity. Null when zone cannot decide. */
  winner: DuplicateProduct | null
  loser: DuplicateProduct | null
  /** Always populated, in stable order, so an undecided pair is still showable. */
  a: DuplicateProduct
  b: DuplicateProduct
  reason: DuplicateReason
  /** Why this pair needs a human, or null when zone settled it. */
  undecided: 'both-zoned' | 'neither-zoned' | null
  editDistance: number
}

/** Case, spacing and punctuation carry no meaning here: "U-Shaped" == "U Shape". */
export function squashName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Every token containing a digit - "15l", "m28", "16x64", "4".
 *
 * This is the single most valuable guard in the file. Edit distance alone rated
 * "15L Foldable Bucket" vs "9L Foldable Bucket" and "M28 Earbuds" vs "G20
 * Earbuds" as near-identical, because one character IS one character to a string
 * algorithm - but to the warehouse they are different SKUs. Measured on the real
 * catalogue this rule removes 15 of 27 typo-style pairs, and every single one it
 * removed was a genuinely different product.
 */
export function modelMarks(name: string): Set<string> {
  return new Set((name.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => /\d/.test(t)))
}

function sameModelMarks(a: string, b: string): boolean {
  const A = modelMarks(a)
  const B = modelMarks(b)
  if (A.size !== B.size) return false
  for (const t of A) if (!B.has(t)) return false
  return true
}

/** Bounded edit distance; anything further apart than 3 is not a typo. */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 3) return 99
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[m][n]
}

/** Below this a one-character difference is more likely a real distinction. */
const MIN_TYPO_LENGTH = 6

/**
 * zone is a GENERATED column - the leading letters of shelf_code, upper-cased.
 * So "has a zone" really means "someone gave this product a shelf code", which
 * is exactly the signal wanted: a person stood at the rack and placed it.
 * Verified live: 0 of 874 rows disagree between having a shelf_code and a zone.
 *
 * It also means zone must never be written directly - Postgres rejects it.
 */
const hasZone = (p: DuplicateProduct) => Boolean(p.zone && p.zone.trim() !== '')

/**
 * Zone decides the winner, per the warehouse rule: a product with a zone has
 * been physically located on a shelf and counted there, so it is the real one.
 * Measured live, 577 of the 580 zoned products are counted.
 *
 * Deliberately NOT decided by quantity, purchase orders or photo count. In
 * every decided pair on the live data the zoned side is the counted one and the
 * unzoned side carries the orders, so picking by "has more data" would choose
 * the paperwork over the shelf.
 */
export function decidePair(a: DuplicateProduct, b: DuplicateProduct): Pick<DuplicatePair, 'winner' | 'loser' | 'undecided'> {
  const az = hasZone(a)
  const bz = hasZone(b)
  if (az && !bz) return { winner: a, loser: b, undecided: null }
  if (bz && !az) return { winner: b, loser: a, undecided: null }
  // Two zones means two shelf locations, which on the live data usually means
  // two genuinely different products (Mini Pot D12 / Mini Mop A14). Never guess.
  return { winner: null, loser: null, undecided: az && bz ? 'both-zoned' : 'neither-zoned' }
}

/**
 * Candidate pairs only. Nothing here is a merge instruction - containment
 * matching ("Shampoo" vs "Shampoo Brush") is deliberately excluded because on
 * the real catalogue it produced 109 pairs that were overwhelmingly different
 * products, including the user's own example: "AirFryer" (the appliance, 700 in
 * stock) vs "Airfryer Paper" (parchment liners, 5000 sheets on order).
 */
export function findDuplicatePairs(products: DuplicateProduct[]): DuplicatePair[] {
  const prepared = products.map(p => ({ p, squashed: squashName(p.name) }))
  const pairs: DuplicatePair[] = []

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const x = prepared[i]
      const y = prepared[j]
      if (!x.squashed || !y.squashed) continue

      let reason: DuplicateReason | null = null
      let distance = 0

      if (x.squashed === y.squashed) {
        reason = 'identical'
      } else {
        const d = levenshtein(x.squashed, y.squashed)
        if (d <= 2 && Math.min(x.squashed.length, y.squashed.length) >= MIN_TYPO_LENGTH) {
          reason = 'typo'
          distance = d
        }
      }

      if (!reason) continue
      // A differing model code or size makes it a different SKU, not a typo.
      if (!sameModelMarks(x.p.name, y.p.name)) continue

      pairs.push({ ...decidePair(x.p, y.p), a: x.p, b: y.p, reason, editDistance: distance })
    }
  }

  // Decided pairs first, then closest names, so the clearest work is on top.
  return pairs.sort((l, r) => {
    if (!l.undecided !== !r.undecided) return l.undecided ? 1 : -1
    return l.editDistance - r.editDistance
  })
}
