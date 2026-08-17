// Resolves a free-text product label (an ad name, or the copy of an organic
// post) onto a row in the canonical `products` catalogue.
//
// Order matters, and it is strictly most-trustworthy first:
//   1. exact name        - same rule as app/api/product-master/overview
//   2. alias             - the shared product_aliases table, already taught 104
//                          names by the deliveries/PO importers
//   3. fuzzy token match - only then, and it reports how sure it is
//
// The caller must respect `confidence`: a 'weak' guess is a hint, not a fact,
// and the inbox renders it differently from an exact hit.

export type MatchConfidence = 'exact' | 'strong' | 'weak'

export type ProductRow = {
  id: string
  name: string
  category?: string | null
}

export type ProductMatch = {
  productId: string
  productName: string
  category: string | null
  confidence: MatchConfidence
}

// Words that carry no product identity. "set/pcs/pack" are units and "b1g1" is
// an offer mechanic - leaving them in makes unrelated bundles look similar.
const STOP = new Set([
  'the', 'a', 'an', 'for', 'with', 'and', 'of', 'to', 'your',
  'new', 'set', 'pcs', 'pack', 'b1g1', 'promo', 'offer', 'offers', 'free',
])

// Spelling variants seen in real ad names. `vaccum` is by far the most common.
const SYNONYMS: Record<string, string> = {
  vaccum: 'vacuum',
  vacum: 'vacuum',
  vaccuum: 'vacuum',
}

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stem(word: string): string {
  const w = SYNONYMS[word] ?? word
  return w.replace(/ies$/, 'y').replace(/es$|s$/, '')
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      normalizeName(value)
        .split(' ')
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map(stem),
    ),
  ]
}

// Bounded edit distance: bails out as soon as the lengths are too far apart,
// so this stays cheap across ~280 products x ~600 labels.
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9
  const rows = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return rows[a.length][b.length]
}

// One typo is tolerated, but only on words long enough that a single edit
// cannot turn one real product into a different one ("mop" vs "map").
const similar = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1)

export type ProductMatcher = (label: string | null | undefined) => ProductMatch | null

/**
 * Builds a reusable matcher. Tokenising the catalogue once and closing over it
 * keeps this to a single pass per label instead of per lookup.
 */
export function createProductMatcher(
  products: ProductRow[],
  aliases: { alias_name: string; product_id: string }[] = [],
): ProductMatcher {
  const byId = new Map(products.map((p) => [p.id, p]))
  const byName = new Map<string, ProductRow>()
  for (const p of products) byName.set(normalizeName(p.name), p)

  const byAlias = new Map<string, ProductRow>()
  for (const a of aliases) {
    const product = byId.get(a.product_id)
    if (product) byAlias.set(normalizeName(a.alias_name), product)
  }

  const indexed = products
    .map((p) => ({ product: p, tokens: tokenize(p.name) }))
    .filter((p) => p.tokens.length > 0)

  const hit = (product: ProductRow, confidence: MatchConfidence): ProductMatch => ({
    productId: product.id,
    productName: product.name,
    category: product.category ?? null,
    confidence,
  })

  return (label) => {
    if (!label) return null
    const normalized = normalizeName(label)
    if (!normalized) return null

    const exact = byName.get(normalized)
    if (exact) return hit(exact, 'exact')

    const aliased = byAlias.get(normalized)
    if (aliased) return hit(aliased, 'exact')

    const tokens = tokenize(label)
    if (!tokens.length) return null

    let best: ProductRow | null = null
    let bestScore = 0
    for (const entry of indexed) {
      let matched = 0
      for (const token of entry.tokens) {
        if (tokens.some((t) => similar(t, token))) matched++
      }
      if (!matched) continue

      // coverage: how much of the PRODUCT name the label contains.
      // precision: how much of the LABEL the product name accounts for.
      const coverage = matched / entry.tokens.length
      const precision = matched / tokens.length

      // Accept when the product name appears in full ("Car Wash Kit" inside a
      // long ad title), or when the label is entirely contained by the product
      // name ("T9 Trimmer" -> "Vintage T9 Trimmer"). Two shared words is the
      // floor for anything else.
      if (coverage < 1 && precision < 1 && matched < 2) continue

      const score =
        Math.max(coverage, precision) +
        Math.min(coverage, precision) * 0.35 +
        Math.min(entry.tokens.length, 3) * 0.02

      if (score > bestScore) {
        bestScore = score
        best = entry.product
      }
    }

    if (!best || bestScore < 0.85) return null
    return hit(best, bestScore >= 1.2 ? 'strong' : 'weak')
  }
}
