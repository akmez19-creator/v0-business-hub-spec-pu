/**
 * Resolve what a customer typed to a real row of `localities`.
 *
 * Customers write "Vallee des pretres" for "Vallee Des Pretes", "Cpe" for
 * Curepipe, "troux aux biches" for "Trou Aux Biches". Exact/prefix/contains
 * matching sent all of those to the agent as "does not match the catalogue"
 * and made the AI ask questions it should not ask.
 *
 * Order: exact -> shorthand -> unique prefix/contains (a base name wins over
 * its own extensions, "Ebene" over "Ebene Cybercity") -> one-typo fuzzy with a
 * UNIQUE best. Anything ambiguous still returns null: a confidently wrong
 * locality routes the parcel to the wrong contractor, an empty one gets fixed.
 */

export function normaliseLocality(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // "Trou d'Eau Douce" and the customer's "Trou deau douce" must land on the same string.
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Street / house-number words that follow a locality in a full address. */
const ADDRESS_NOISE = new Set(['road', 'rd', 'street', 'st', 'rue', 'avenue', 'ave', 'av', 'lane', 'morcellement', 'morc', 'mrc', 'cite', 'residence', 'res', 'apt', 'appt', 'flat', 'no', 'num', 'lot', 'house', 'near', 'opposite', 'behind', 'next', 'to', 'the'])

/** Mauritian shorthand -> full name, all in normalised form. */
export const LOCALITY_SHORTHAND: Record<string, string> = {
  cpe: 'curepipe',
  crp: 'curepipe',
  qb: 'quatre bornes',
  'q bornes': 'quatre bornes',
  '4 bornes': 'quatre bornes',
  rh: 'rose hill',
  'r hill': 'rose hill',
  pl: 'port louis',
  'p louis': 'port louis',
  'port lwi': 'port louis',
  bb: 'beau bassin',
  'b bassin': 'beau bassin',
  gb: 'grand bay',
  'g bay': 'grand bay',
  'grand baie': 'grand bay',
  vcs: 'vacoas',
  mhbg: 'mahebourg',
  mbg: 'mahebourg',
  pmpl: 'pamplemousses',
  pamplemousse: 'pamplemousses',
  tdd: "trou d'eau douce",
  fef: 'flic en flac',
  'flic n flac': 'flic en flac',
  'flic-en-flac': 'flic en flac',
  ebe: 'ebene',
  tab: 'trou aux biches',
  rdr: 'riviere du rempart',
  'r du rempart': 'riviere du rempart',
  gdl: 'goodlands',
  'st pierre': 'saint pierre',
  'st julien': 'saint julien village',
  fs: 'forest side',
  'f side': 'forest side',
  'petit riviere': 'petite riviere',
  pointe: 'pointe aux sables',
}

/** Human-readable list for the AI prompt, so the reply spells the full name. */
export const LOCALITY_SHORTHAND_HINT =
  'Cpe = Curepipe, QB = Quatre Bornes, RH = Rose Hill, PL = Port Louis, BB = Beau Bassin, GB / Grand Baie = Grand Bay, Vcs = Vacoas, Mhbg = Mahebourg, Pmpl = Pamplemousses, TdD = Trou d\'Eau Douce, FeF = Flic en Flac, Ebe = Ebene, RdR = Riviere du Rempart, FS = Forest Side'

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Typo budget: 1 for short names, 2 from 12 characters, never more. */
function typoBudget(len: number): number {
  return len >= 12 ? 2 : len >= 5 ? 1 : 0
}

export type LocalityMatch<T> = { row: T; how: 'exact' | 'shorthand' | 'prefix' | 'contains' | 'fuzzy' | 'address' }

export function matchLocality<T>(guess: string | null | undefined, rows: readonly T[], nameOf: (r: T) => string): LocalityMatch<T> | null {
  const direct = matchLocalityText(guess, rows, nameOf)
  if (direct) return direct

  // A full address: "Trou deau douce beline road", "Beline road, Trou d'Eau Douce",
  // "Morc Swan, Flic en Flac". The locality is the longest run of words at the
  // start or the end that resolves on its own once street words are dropped.
  const words = normaliseLocality(guess ?? '').split(' ').filter((w) => w && !ADDRESS_NOISE.has(w) && !/^\d+[a-z]?$/.test(w))
  if (words.length < 2) return null
  for (let k = words.length - 1; k >= 1; k--) {
    const head = matchLocalityText(words.slice(0, k).join(' '), rows, nameOf, true)
    if (head) return { row: head.row, how: 'address' }
    const tail = matchLocalityText(words.slice(words.length - k).join(' '), rows, nameOf, true)
    if (tail) return { row: tail.row, how: 'address' }
  }
  return null
}

/**
 * One string against the catalogue. `strict` (address windows) skips the
 * prefix/contains passes: a two-word window like "douce beline" must not pick
 * a locality just because it shares a fragment with one.
 */
function matchLocalityText<T>(guess: string | null | undefined, rows: readonly T[], nameOf: (r: T) => string, strict = false): LocalityMatch<T> | null {
  if (!guess?.trim()) return null
  let g = normaliseLocality(guess)
  if (!g) return null

  const scored = rows.map((r) => ({ row: r, n: normaliseLocality(nameOf(r)) })).filter((s) => s.n)
  const exactOf = (needle: string) => scored.find((s) => s.n === needle)

  const exact = exactOf(g)
  if (exact) return { row: exact.row, how: 'exact' }

  const short = LOCALITY_SHORTHAND[g]
  if (short) {
    const hit = exactOf(short)
    if (hit) return { row: hit.row, how: 'shorthand' }
    g = short
  }

  // A base locality wins over its own extensions: "ebene" -> Ebene, not Ebene Cybercity.
  const pickBase = (cands: typeof scored) => {
    if (cands.length === 1) return cands[0]
    const shortest = [...cands].sort((a, b) => a.n.length - b.n.length)[0]
    return cands.every((c) => c.n.startsWith(shortest.n)) ? shortest : null
  }

  if (g.length >= 3 && !strict) {
    const prefix = pickBase(scored.filter((s) => s.n.startsWith(g) || g.startsWith(s.n)))
    if (prefix) return { row: prefix.row, how: 'prefix' }
  }
  if (g.length >= 4 && !strict) {
    const contains = pickBase(scored.filter((s) => s.n.includes(g) || g.includes(s.n)))
    if (contains) return { row: contains.row, how: 'contains' }
  }

  const budget = typoBudget(g.length)
  if (budget > 0) {
    let best: { row: T; d: number }[] = []
    for (const s of scored) {
      if (Math.abs(s.n.length - g.length) > budget) continue
      const d = levenshtein(g, s.n)
      if (d > budget) continue
      if (!best.length || d < best[0].d) best = [{ row: s.row, d }]
      else if (d === best[0].d) best.push({ row: s.row, d })
    }
    if (best.length === 1) return { row: best[0].row, how: 'fuzzy' }
  }

  return null
}
