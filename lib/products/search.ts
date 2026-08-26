/**
 * Product name search.
 *
 * The catalogue used a single `name ilike %query%`, which fails on the way
 * people actually type. Measured against the live 843 products:
 *   "hair dryer"  -> 0 hits   (the product is "Dryer Hair Brush")
 *   "ear buds"    -> 0 hits   (7 products contain "Earbud")
 *   "bucket set"  -> 0 hits
 *   "blendr"      -> 0 hits
 * One substring must appear verbatim and in order, so any reordering or typo
 * returns nothing - and nothing reads as "we do not sell it".
 *
 * Names are short (2-4 words) and there are only ~900 distinct words, so
 * ranking every row in JS is cheap and, unlike a SQL similarity() threshold,
 * testable without a database.
 */

/** Lowercase, strip accents, and reduce punctuation to spaces. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function words(s: string): string[] {
  const n = normalise(s)
  return n ? n.split(' ') : []
}

/**
 * Levenshtein distance, abandoned early once it exceeds `max`.
 * Cheaper than a full matrix because we only ever care about "within 1 or 2".
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < best) best = curr[j]
    }
    if (best > max) return max + 1
    prev = curr
  }
  return prev[b.length]
}

/**
 * Typo tolerance scaled to word length. Short words are excluded entirely:
 * at 3 letters, one edit reaches "car" from "cat", "can" and "bar", which
 * would swamp the 36 real car products with noise.
 */
function fuzzyLimit(len: number): number {
  if (len >= 7) return 2
  if (len >= 5) return 1
  return 0
}

/** Score one query token against one product word. 0 means no match. */
function scoreToken(token: string, word: string): number {
  if (token === word) return 10
  if (word.startsWith(token)) return 7
  // Trailing-plural equality ("earbuds" vs "earbud") is a full match, not a
  // partial one - handled by the prefix rule above in one direction and here
  // in the other.
  if (token.startsWith(word) && token.length - word.length <= 2) return 6
  if (word.includes(token) && token.length >= 3) return 4
  const limit = fuzzyLimit(Math.max(token.length, word.length))
  if (limit > 0 && editDistance(token, word, limit) <= limit) return 3
  return 0
}

export interface Searchable {
  name: string
  category?: string | null
}

/**
 * Relevance score for one product, or 0 when it should not appear.
 *
 * Every query token must match something. AND rather than OR is deliberate:
 * with OR, "car holder" returns all 36 car products ahead of the holders,
 * so adding a word to narrow a search would make it worse.
 */
export function scoreProduct(query: string, item: Searchable): number {
  const tokens = words(query)
  if (!tokens.length) return 1

  const nameWords = words(item.name)
  const categoryWords = item.category ? words(item.category) : []
  let total = 0

  for (const token of tokens) {
    let best = 0
    for (const w of nameWords) best = Math.max(best, scoreToken(token, w))
    if (!best) {
      // Category is a weaker signal so a name match always outranks it, but it
      // lets "kitchen scissors" find a product named only "Scissors".
      for (const w of categoryWords) best = Math.max(best, scoreToken(token, w) * 0.3)
    }
    if (!best) return 0
    total += best
  }

  const name = normalise(item.name)
  const q = normalise(query)
  // Whole-phrase hits rank above the same words scattered through a longer
  // name, so typing more of the real name keeps pulling it upward.
  if (name === q) total += 100
  else if (name.startsWith(q)) total += 20
  else if (name.includes(q)) total += 10
  // Shorter names are the more specific match for the same word count.
  total -= nameWords.length * 0.1
  return total
}

/** Rank `items` by relevance, dropping non-matches. Stable for equal scores. */
export function searchProducts<T extends Searchable>(query: string, items: T[]): T[] {
  if (!normalise(query)) return items
  return items
    .map((item, i) => ({ item, i, score: scoreProduct(query, item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item)
}

/**
 * Score ignoring the all-tokens rule: the best any single token can do.
 * Used only to build the near-miss list below.
 */
function looseScore(query: string, item: Searchable): number {
  const nameWords = words(item.name)
  let best = 0
  for (const token of words(query)) {
    for (const w of nameWords) best = Math.max(best, scoreToken(token, w))
  }
  return best
}

export interface SearchOutcome<T> {
  results: T[]
  /**
   * True when nothing matched the full query and `results` holds loosely
   * related products instead. The UI must label these, because an unlabelled
   * near-miss looks like a real answer and an empty screen looks like "we do
   * not sell it" - both mislead an agent who is mid-conversation.
   */
  fallback: boolean
}

/**
 * Search, degrading to related products rather than to nothing.
 *
 * "hair dryer" genuinely has no match in this catalogue, but a blank screen
 * cannot distinguish that from a spelling the search failed to handle. Showing
 * the closest hair and dryer products lets the agent judge for themselves.
 */
export function searchWithFallback<T extends Searchable>(
  query: string,
  items: T[],
  limit = 12,
): SearchOutcome<T> {
  const results = searchProducts(query, items)
  if (results.length || !normalise(query)) return { results, fallback: false }

  const loose = items
    .map((item, i) => ({ item, i, score: looseScore(query, item) }))
    // 4 is the substring tier: below it only fuzzy noise remains, and a list
    // of unrelated products is worse than a short one.
    .filter((r) => r.score >= 4)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.item)

  return { results: loose, fallback: loose.length > 0 }
}
