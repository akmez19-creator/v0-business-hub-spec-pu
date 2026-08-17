// Turns an ad name (or the copy of an organic post) into a product label.
//
// Deliberately dependency-free and not server-only, so backfill scripts and
// tests can import the exact same logic the app runs. Keeping a second copy in
// a script is how the cache and the UI silently drift apart.

/** Placeholder ad names that carry no product meaning. */
const JUNK_NAMES = /^(new engagement ad|dup|copy|untitled|test)\b/i

/**
 * Three shapes exist in this account:
 *   1. "DBM - Car Wash Kit - 1"       -> the house convention (majority)
 *   2. 'Post: "Easy to use mini..."'  -> Meta's auto name, i.e. the post copy
 *   3. "New Engagement Ad"            -> junk, deliberately returns null
 */
export function productFromAdName(adName: string | null | undefined): string | null {
  if (!adName) return null
  // NFKC folds the mathematical-bold characters these ads are often written in
  // (𝐒𝐚𝐲 𝐠𝐨𝐨𝐝𝐛𝐲𝐞 -> Say goodbye). Without it the label is unreadable AND
  // unmatchable, because none of those code points equal a normal letter.
  const raw = adName.normalize('NFKC').trim()
  if (!raw || JUNK_NAMES.test(raw)) return null

  const isAutoName = /^post:\s*/i.test(raw)

  // Shape 1: BRAND - Product [- VARIANT] - 3
  if (!isAutoName && raw.includes(' - ')) {
    const parts = raw
      .split(/\s+-\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length >= 2) {
      // Drop a short leading brand code (DBM/MBM) and any trailing plain
      // number, which is just the creative iteration.
      if (parts.length > 2 && parts[0].length <= 12 && !/\s/.test(parts[0])) parts.shift()
      while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) parts.pop()
      const joined = parts.join(' - ').trim()
      if (joined) return truncate(joined)
    }
  }

  // Shape 2: strip the wrapper, quotes and marketing noise, keep first clause.
  let s = raw.replace(/^post:\s*/i, '').replace(/^["“”']+|["“”']+$/g, '')
  s = s.replace(/^[^\p{L}\p{N}]+/u, '')
  s = s.replace(
    /^(ultimate deal|new price drop|price drop|special offer|mega deal|hot deal|flash sale|new|promo|sale|deal)\s*[!:–-]*\s*/i,
    '',
  )
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  if (!s) return null

  // Post copy is a sentence, not a name: stop at the first hard break so we
  // get "BUILDECO Bamboo Charcoal Boards" and not the whole sales pitch.
  let cut = (s.split(/[\n–—|]/)[0] ?? s).trim()
  cut = (cut.split(/\s+[-—]\s+|[.!?]\s|,\s|\s+(?:Rs|only|now)\b/i)[0] ?? cut).trim()
  // Marketing copy often leads with a verb phrase ("Revolutionize Your Walls
  // Instantly with BUILDECO's ..."); the product follows the preposition.
  const after = cut.match(/\b(?:with|from)\s+(.{6,})$/i)?.[1]
  if (after && /^[\p{Lu}]/u.test(after)) cut = after.trim()
  cut = cut
    .replace(/[’']s\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    // Trailing punctuation from the original sentence.
    .replace(/[!?.,:;\s]+$/u, '')
    .trim()

  return truncate(cut.length >= 8 ? cut : s)
}

/**
 * Product label from a CAMPAIGN name, e.g.
 *   "DT5763 EMS Foot Massager(Black Box) - VM" -> "EMS Foot Massager Black Box"
 *
 * Campaigns are named by a human here, so when an ad carries only Meta's
 * auto-generated post copy the campaign is usually the cleaner signal. Used as
 * a fallback, never in preference to a real ad name.
 */
export function productFromCampaignName(name: string | null | undefined): string | null {
  if (!name) return null
  let s = name.normalize('NFKC').trim()
  if (!s) return null

  // Leading internal SKU code ("DT5763 ") and trailing initials (" - VM").
  s = s.replace(/^[A-Z]{2,4}\d{3,6}\s*[-–]?\s*/i, '')
  s = s.replace(/\s*[-–]\s*[A-Z]{1,3}$/, '')
  // Parenthesised variants read better unwrapped.
  s = s.replace(/\s*\(([^)]*)\)/g, ' $1')
  s = s.replace(/\s{2,}/g, ' ').replace(/[-–\s]+$/, '').trim()

  if (s.length < 3 || JUNK_NAMES.test(s)) return null
  return truncate(s)
}

function truncate(value: string): string {
  const out = value.trim()
  // Split by code point, not UTF-16 unit. Some ad names are written in
  // mathematical-bold characters (𝐒𝐚𝐲 ...) which are surrogate PAIRS, and a
  // plain slice() can cut one in half. The resulting lone surrogate is not
  // valid JSON, and Postgres rejects the whole batch with an opaque
  // "invalid input syntax for type json".
  const chars = [...out]
  if (chars.length <= 48) return out
  return `${chars.slice(0, 48).join('').trimEnd()}…`
}
