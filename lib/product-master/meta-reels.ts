/**
 * Meta (Instagram/Facebook) Reels search for the Studio.
 *
 * WHY INSTAGRAM AND NOT FACEBOOK
 * Facebook has no video/reel search endpoint at all. `/search?type=video`
 * answers "Unsupported get request" (code 100, subcode 33) on a fully valid
 * token, while `/search?type=adinterest` on that SAME token returns data - so
 * it is the search TYPE that does not exist, not our access. There is no
 * workaround; the Graph API only ever reads Pages you own.
 *
 * Instagram hashtag search DOES exist and is the only supported way to find
 * other people's Reels inside Meta. Reels cross-post between Instagram and
 * Facebook, so this is the same pool of content the owner was asking for.
 *
 * THE QUOTA IS THE REAL CONSTRAINT
 * Meta allows only ~30 UNIQUE hashtags per IG user per rolling 7 days. That is
 * the whole budget, so this module:
 *   - caps how many hashtags one search may resolve (MAX_TAGS)
 *   - resolves name -> hashtag id through `fbGet` with a multi-day TTL, since
 *     that mapping never changes. Repeats then cost nothing, and common tokens
 *     like "clothesline" are reused across products for free.
 *   - never throws: if the quota or the token fails, the caller still shows
 *     TikTok and YouTube results.
 */
import { fbGet, FbGraphError } from '@/lib/facebook/graph'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Hashtag ids and the IG account id are stable, so cache them for days. */
const STABLE_TTL = 3 * 24 * 60 * 60 * 1000
/** Media listings move, but not fast enough to justify burning calls. */
const MEDIA_TTL = 30 * 60 * 1000

/**
 * Hard cap on hashtags per search. With ~30 unique tags per 7 days, 3 keeps a
 * realistic number of searches available per week. Raising this trades away
 * searches later in the week for slightly wider coverage now.
 */
// 4 leaves room for the head noun, a generic keyword and a compound - the three
// shapes that measurably return anything - while still allowing ~7 products a
// week against Instagram's 30-unique-hashtag cap. Resolved tag ids are cached
// for days, so re-searching the same product costs nothing.
const MAX_TAGS = 4

export type ReelHit = {
  /** Instagram's media id */
  id: string
  caption: string
  /** Direct mp4. Fetchable now, but NOT re-resolvable later - see below. */
  mediaUrl: string | null
  permalink: string
  likes: number
  comments: number
  timestamp: string | null
  /** Which hashtag surfaced it, for display */
  tag: string
}

/**
 * Turn a human phrase into a usable hashtag token.
 *
 * Instagram rejects any hashtag containing a space with error 24, so phrases
 * must be collapsed ("windproof clothesline" -> "windproofclothesline").
 */
export function toHashtag(phrase: string): string {
  return phrase
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 60)
}

/**
 * Pick the hashtags most likely to actually return this product.
 *
 * MEASURED, not guessed. Collapsing the AI's own product names gives tags that
 * are perfectly descriptive and completely empty: #antislipclothesline and
 * #travelclothesline both returned ZERO reels, yet consumed the whole budget.
 * The tags that actually returned this product were the plain head noun
 * (#clothesline) and short compounds of common words (#dryingrope,
 * #clotheslinerope).
 *
 * So the order is popularity-first: real people tag the generic thing, never the
 * full marketing name. Ties break on brevity, since a shorter tag is almost
 * always the better-populated one.
 */
const shortestFirst = (a: string, b: string) => a.length - b.length

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)

/**
 * The nouns the product actually IS - the last word of each name.
 *
 * "anti-slip clothesline" and "plastic drying rope" are both fundamentally a
 * clothesline / a rope. Everything before the head is a property, and a property
 * shared with unrelated goods is what lets noise in.
 */
function headNouns(names: string[]): string[] {
  const out = names.map((n) => words(n).pop() || '').filter((w) => w.length >= 4)
  return [...new Set(out)]
}

/**
 * Adjacent word pairs drawn from the product's names ("drying rope").
 *
 * The one unit that works for BOTH jobs here: specific enough to name the
 * object (unlike a bare word) but loose enough to survive real captions (unlike
 * a full marketing name). Used to build hashtags and to judge relevance, so the
 * two can never drift apart.
 *
 * CRITICAL: a pair must contain a head noun. "anti slip" is a real bigram of
 * "anti-slip clothesline", but it describes a PROPERTY - accepting it matched
 * anti-slip socks, car mats and yoga mats (measured: 22 of 22 kept, nearly all
 * junk). "drying rope" names the object and does not have that problem.
 */
/**
 * Function words. A bigram containing one of these is grammar, not a product.
 *
 * "hanging rope with hooks" was yielding "rope with" -> #ropewith and
 * "with hooks" -> #withhooks: both pass the head-noun test (each sits next to
 * "rope"/"hooks"), both name nothing, and with MAX_TAGS at 3 they crowded out
 * the tags that work. Instagram allows ~30 unique tags per WEEK, so a wasted
 * slot is real budget, not just noise.
 */
const FUNCTION_WORDS = new Set([
  'with', 'for', 'and', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'by',
  'from', 'up', 'at', 'or', 'per', 'set', 'pcs', 'pack',
])

function bigrams(names: string[]): string[] {
  const heads = new Set(headNouns(names))
  const out: string[] = []
  for (const n of names) {
    const w = words(n)
    for (let i = 0; i < w.length - 1; i++) {
      // BOTH words must be content words, and at least one a head noun.
      if (FUNCTION_WORDS.has(w[i]) || FUNCTION_WORDS.has(w[i + 1])) continue
      if (heads.has(w[i]) || heads.has(w[i + 1])) out.push(`${w[i]} ${w[i + 1]}`)
    }
  }
  return [...new Set(out)]
}

export function pickHashtags(names: string[], keywords: string[]): string[] {
  const out: string[] = []
  const push = (t: string) => {
    if (t.length >= 4 && t.length <= 24 && !out.includes(t)) out.push(t)
  }

  // 1. The head noun of the SHORTEST name - what the thing actually IS
  //    ("anti-slip clothesline" -> clothesline).
  //
  //    Only the shortest name, and only if it is a real compound noun: taking
  //    the last word of every name harvests #rope and #line too, which are
  //    climbing rope and queue jokes.
  const byLength = [...names].sort(shortestFirst)
  const head = words(byLength[0] || '').pop() || ''
  if (head.length >= 7) push(head)

  // 2. Two-word compounds, built ONLY from word pairs that really sit next to
  //    each other in one of the names ("drying rope" -> #dryingrope).
  //
  //    MEASURED: compounds produced the only genuine matches, so they outrank
  //    bare words. Taking every pairing instead invents nonsense - "anti-slip"
  //    plus "non-slip" gave #antinon, a tag for nothing.
  const compounds = bigrams(names)
    .map((b) => b.replace(/\s+/g, ''))
    .filter((c) => c.length >= 8)
  for (const c of compounds.sort(shortestFirst)) push(c)

  // 3. Single keywords last, and only reasonably specific ones. A 4-letter word
  //    is too broad to describe a product and only feeds the filter noise.
  for (const k of [...keywords].sort(shortestFirst)) {
    const t = toHashtag(k)
    if (t.length >= 7) push(t)
  }

  // 4. Only now the full collapsed names, as a last resort
  for (const n of byLength) push(toHashtag(n))

  return out.slice(0, MAX_TAGS)
}

/** The IG business account linked to one of the owner's Pages. */
async function igUserId(token: string): Promise<string | null> {
  try {
    const json = await fbGet<{
      data?: { instagram_business_account?: { id?: string } }[]
    }>(`${GRAPH}/me/accounts?fields=instagram_business_account&access_token=${token}`, { cacheTtl: STABLE_TTL })
    for (const page of json.data || []) {
      const id = page.instagram_business_account?.id
      if (id) return id
    }
    return null
  } catch {
    return null
  }
}

/** Resolve a hashtag to its id. Long TTL: this mapping is permanent. */
async function hashtagId(tag: string, igId: string, token: string): Promise<string | null> {
  try {
    const json = await fbGet<{ data?: { id?: string }[] }>(
      `${GRAPH}/ig_hashtag_search?user_id=${igId}&q=${encodeURIComponent(tag)}&access_token=${token}`,
      { cacheTtl: STABLE_TTL },
    )
    return json.data?.[0]?.id ?? null
  } catch {
    // Unknown tag, or the weekly unique-hashtag budget is spent
    return null
  }
}

/** Reels carrying one hashtag. `top_media` is ranked, so it beats recent. */
async function reelsForTag(tagId: string, tag: string, igId: string, token: string): Promise<ReelHit[]> {
  // NOTE: thumbnail_url is REJECTED on hashtag media (owned media only), so
  // there is no cover image to show - the mp4 itself is the preview.
  const fields = 'id,media_type,media_product_type,permalink,media_url,caption,like_count,comments_count,timestamp'
  const out: ReelHit[] = []

  for (const edge of ['top_media', 'recent_media']) {
    try {
      const json = await fbGet<{
        data?: {
          id: string
          media_product_type?: string
          media_type?: string
          permalink?: string
          media_url?: string
          caption?: string
          like_count?: number
          comments_count?: number
          timestamp?: string
        }[]
      }>(`${GRAPH}/${tagId}/${edge}?user_id=${igId}&fields=${fields}&limit=24&access_token=${token}`, {
        cacheTtl: MEDIA_TTL,
      })

      for (const m of json.data || []) {
        // Reels only. Photos and carousels are not usable as video clips.
        const isReel = m.media_product_type === 'REELS' || m.media_type === 'VIDEO'
        if (!isReel || !m.permalink) continue
        out.push({
          id: m.id,
          caption: m.caption || '',
          mediaUrl: m.media_url || null,
          permalink: m.permalink,
          likes: m.like_count ?? 0,
          comments: m.comments_count ?? 0,
          timestamp: m.timestamp ?? null,
          tag,
        })
      }
    } catch (e) {
      // One edge failing is not fatal - the other may still return
      if (e instanceof FbGraphError && e.isRateLimit) break
    }
  }
  return out
}

export type ReelSearchResult = {
  hits: ReelHit[]
  /** Hashtags actually queried, for display */
  tags: string[]
  /** Set when Meta could not be searched at all, for an honest message */
  error: string
  /** Reels found before relevance filtering, so the yield is visible */
  examined: number
}

/**
 * Drop reels whose caption has nothing to do with the product.
 *
 * This is not optional polish. A hashtag matches a WORD, not a product, so a
 * broad tag like #laundry returns laundry-perfume ads, laundromat memes and
 * (measured) a baby-dinosaur video.
 *
 * MEASURED: matching single keywords keeps 29 of 29 - useless. Every caption
 * under #laundry contains the word "laundry", so a generic word can only ever
 * confirm the hashtag we just searched. Relevance has to come from a MULTI-WORD
 * phrase ("drying rope", "clothes line"), which is what the two genuine product
 * hits actually contained. Single words are therefore ignored on purpose.
 */
function relevant(hit: ReelHit, phrases: string[]): boolean {
  const cap = hit.caption.toLowerCase().replace(/[#_]/g, ' ').replace(/\s+/g, ' ')
  if (!cap) return false
  const squashed = cap.replace(/\s/g, '')
  return phrases.some((p) => {
    const t = p.toLowerCase().trim()
    // Only phrases discriminate. A bare word is either the hashtag itself or
    // too common to mean anything.
    if (!t.includes(' ') || t.length < 7) return false
    // "drying rope" also appears hashtagged as #dryingrope
    return cap.includes(t) || squashed.includes(t.replace(/\s+/g, ''))
  })
}

/**
 * Phrases a caption may be judged against: the full names AND their bigrams.
 *
 * Requiring a whole name is too strict - a real caption read "CLOTHES DRYING
 * ROPE - HEAVY DUTY", which contains no complete name but clearly is the
 * product. Its "drying rope" bigram catches it.
 */
function matchPhrases(names: string[]): string[] {
  return [...names, ...bigrams(names)]
}

/**
 * Search Meta Reels for a product.
 *
 * Never throws: Meta is one of three sources and must not take the other two
 * down with it.
 */
export async function searchMetaReels(names: string[], keywords: string[]): Promise<ReelSearchResult> {
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return { hits: [], tags: [], error: 'no Facebook token configured', examined: 0 }

  const igId = await igUserId(token)
  if (!igId) {
    return { hits: [], tags: [], error: 'no Instagram business account linked to your Pages', examined: 0 }
  }

  const tags = pickHashtags(names, keywords)
  if (tags.length === 0) return { hits: [], tags: [], error: '', examined: 0 }

  const resolved = await Promise.all(tags.map(async (t) => ({ tag: t, id: await hashtagId(t, igId, token) })))
  const usable = resolved.filter((r): r is { tag: string; id: string } => Boolean(r.id))
  if (usable.length === 0) {
    return {
      hits: [],
      tags,
      error: 'Instagram had no matching hashtags (or the weekly hashtag limit is spent)',
      examined: 0,
    }
  }

  const batches = await Promise.all(usable.map((r) => reelsForTag(r.id, r.tag, igId, token)))

  const seen = new Set<string>()
  const all: ReelHit[] = []
  for (const batch of batches) {
    for (const h of batch) {
      if (seen.has(h.id)) continue
      seen.add(h.id)
      all.push(h)
    }
  }

  // Only keep reels that actually look like this product, then put the ones we
  // can pull into the feed (those with an mp4) first.
  // Only the multi-word names can discriminate; `keywords` are single words and
  // would match every caption under the hashtag we just searched.
  const hits = all
    .filter((h) => relevant(h, matchPhrases(names)))
    .sort((a, b) => Number(Boolean(b.mediaUrl)) - Number(Boolean(a.mediaUrl)) || b.likes - a.likes)

  return { hits, tags: usable.map((r) => r.tag), error: '', examined: all.length }
}
