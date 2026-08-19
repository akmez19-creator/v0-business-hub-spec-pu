/**
 * Shortlisting for photo-to-product matching.
 *
 * Stage 1 of a retrieve-then-verify pipeline. A vision pass describes the
 * photographed item; this module turns that description into a short list of
 * plausible products which stage 2 then verifies visually.
 *
 * Why not just search the product name? Because the names in this catalogue are
 * terse and generic - "Gel Stamp", "Handy Heater", "Veslee spray", ~16
 * characters on average. Matching a vision label against them alone is close to
 * a coin flip. The signals below are weighted accordingly: text physically
 * printed on the packaging is treated as near-decisive, while category is
 * treated as weak because only 138 of 488 products have one.
 */

/** Ranked below this and we say "no match" rather than offer a bad guess. */
export const MATCH_CONFIDENCE_FLOOR = 0.45

/** How many products stage 2 is allowed to compare images for. */
export const VISUAL_CANDIDATE_LIMIT = 12

/** How many products stage 1 hands to stage 2. */
export const SHORTLIST_SIZE = 14

/** What the vision pass extracts from the agent's photo. */
export interface PhotoDescription {
  label: string
  category: string | null
  form_factor: string | null
  colour: string | null
  material: string | null
  /** Text read verbatim off the packaging. The strongest signal available. */
  packaging_text: string[]
  /** Other plausible names for the same object ("torch" for "flashlight"). */
  alternate_names: string[]
}

export interface ScorableProduct {
  id: string
  name: string
  category: string | null
  description: string | null
  sku: string | null
  image_url: string | null
}

export interface ScoredProduct extends ScorableProduct {
  score: number
  /** Human-readable reason, surfaced when no visual comparison was possible. */
  basis: string
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'in', 'on', 'to',
  'pcs', 'pc', 'set', 'pack', 'x', 'new', 'type', 'size', 'colour', 'color',
])

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

/**
 * Character-trigram similarity, the same measure `pg_trgm` uses, implemented
 * here so the whole 488-row catalogue can be scored in one pass in memory
 * instead of issuing one query per candidate term.
 */
function trigramSimilarity(a: string, b: string): number {
  const trigrams = (s: string) => {
    const padded = `  ${s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()} `
    const out = new Set<string>()
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
    return out
  }
  const A = trigrams(a)
  const B = trigrams(b)
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  // Jaccard, matching pg_trgm's definition.
  return shared / (A.size + B.size - shared)
}

/**
 * Score every product against the photo description and return the best few.
 *
 * Ordering is deliberately generous at this stage: the goal is recall, not
 * precision. Missing the right product here means stage 2 can never find it,
 * whereas a few wrong candidates are simply rejected by the visual pass.
 */
export function shortlistProducts(
  description: PhotoDescription,
  products: ScorableProduct[],
  limit = SHORTLIST_SIZE,
): ScoredProduct[] {
  // Everything the AI thinks this object might be called.
  const nameTerms = [description.label, ...description.alternate_names]
    .filter(Boolean)
    .map(t => t.trim())
    .filter(t => t.length > 1)

  // Brand and product text read off the box. Short fragments ("500", "ml") are
  // dropped - they match half the catalogue and would drown the real signal.
  const brandTerms = description.packaging_text
    .map(t => t.trim())
    .filter(t => t.length >= 3)

  const descriptorTokens = new Set(
    [description.form_factor, description.colour, description.material]
      .filter(Boolean)
      .flatMap(v => tokenise(v as string)),
  )

  const scored = products.map(product => {
    const haystack = [product.name, product.description, product.sku]
      .filter(Boolean)
      .join(' ')
    const productTokens = new Set(tokenise(haystack))
    const reasons: string[] = []
    let score = 0

    // 1. Fuzzy name similarity against the best-matching candidate name.
    let bestName = 0
    for (const term of nameTerms) {
      bestName = Math.max(bestName, trigramSimilarity(term, product.name))
    }
    score += bestName * 3
    if (bestName > 0.35) reasons.push('name is similar')

    // 2. Verbatim packaging text. Weighted highest by a wide margin: the word
    //    "VESLEE" on a bottle identifies the product outright, in a way that
    //    "plastic" or "bottle" never can.
    let brandHit = false
    for (const term of brandTerms) {
      const needle = term.toLowerCase()
      if (haystack.toLowerCase().includes(needle)) {
        score += 6
        brandHit = true
        reasons.push(`packaging text "${term}" appears in the product name`)
        break
      }
      // Near-miss on a long fragment still counts - OCR misreads characters.
      if (term.length >= 5 && trigramSimilarity(term, product.name) > 0.5) {
        score += 3
        brandHit = true
        reasons.push(`packaging text resembles "${term}"`)
        break
      }
    }

    // 3. Shared words between the vision label and the product name.
    const labelTokens = new Set(nameTerms.flatMap(tokenise))
    let overlap = 0
    for (const token of labelTokens) if (productTokens.has(token)) overlap++
    if (overlap) {
      score += overlap * 1.5
      reasons.push(`${overlap} shared word${overlap > 1 ? 's' : ''}`)
    }

    // 4. Physical descriptors - weak individually, useful as a tiebreak.
    let descriptorHits = 0
    for (const token of descriptorTokens) {
      if (productTokens.has(token)) descriptorHits++
    }
    score += descriptorHits * 0.5

    // 5. Category. Deliberately small: most products have no category, so a
    //    match is mild evidence and a mismatch is almost no evidence at all.
    if (
      description.category &&
      product.category &&
      trigramSimilarity(description.category, product.category) > 0.5
    ) {
      score += 0.75
      reasons.push('same category')
    }

    // Products without a photo can never be visually verified, so a text-only
    // score must not be allowed to win outright. Nudged down so a genuine
    // visual match always outranks a plausible-sounding guess.
    if (!product.image_url && !brandHit) score *= 0.8

    return {
      ...product,
      score,
      basis: reasons.length ? reasons.join(', ') : 'weak text similarity',
    }
  })

  return scored
    .filter(p => p.score > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Convert a stage-1 score into a rough 0-1 confidence for the text-only case.
 * Intentionally pessimistic and capped below the floor's comfort zone: without
 * a visual check we should never look certain.
 */
export function textOnlyConfidence(score: number): number {
  return Math.min(0.6, score / 12)
}
