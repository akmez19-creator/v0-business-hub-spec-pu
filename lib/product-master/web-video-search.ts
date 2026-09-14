/**
 * Deep-web discovery of Facebook Reels (and other video pages) by scraping
 * open web search engines.
 *
 * WHY THIS EXISTS
 * Facebook is the one platform with no usable search path of its own. Measured,
 * not assumed:
 *   - Graph `search?type=video` -> "Unsupported get request". The endpoint does
 *     not exist; Graph video reads only cover Pages you own.
 *   - Graph `ads_archive` (the Ad Library, which does hold seller promo videos)
 *     -> error 10/2332002 "Application does not have permission". Needs app
 *     review, so it is not available to us.
 *   - Instagram hashtag search DOES work and downloads -> see meta-reels.ts.
 *     That covers Meta Reels posted to Instagram, but not Facebook-only ones.
 *
 * So the only remaining route to a Facebook reel is to let a search engine
 * index it for us and harvest the permalinks. `resolveFacebook()` then turns a
 * permalink into a real mp4 - VERIFIED: a reel found this way downloaded as a
 * 2.8MB HD file.
 *
 * HONEST LIMITATION - READ BEFORE "FIXING" THIS
 * Engines bot-wall datacenter IPs aggressively. Measured from the server:
 * DuckDuckGo returned real reel ids on the FIRST request then served
 * `anomaly.js?cc=botnet`; Brave returned 11 real reel ids then 429'd on every
 * following request. r.jina.ai (reader proxy) now 403s without a key, and
 * public SearxNG instances return 200 with zero Facebook results.
 *
 * Therefore this is BEST-EFFORT and must never be on a hot path:
 *   - it is opt-in, never automatic
 *   - every engine is tried in turn, and a 429 parks that engine for a cooldown
 *   - results are cached hard, because a hit is scarce and re-scraping is what
 *     gets us blocked
 *   - an empty result is reported as "engines are rate-limiting", NOT as
 *     "no videos exist" - those are completely different facts and conflating
 *     them would send someone hunting for a bug that is not there
 *
 * If reliability matters more than zero cost, a Brave Search API key (free tier
 * ~2k queries/month) removes the blocking entirely; wire it in as another entry
 * in ENGINES and it will be preferred automatically.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** A discovered video page, before any attempt to resolve a stream. */
export type WebVideoHit = {
  /** Facebook's own reel id, so it dedupes against anything already on screen */
  id: string
  pageUrl: string
  title: string
  platform: 'facebook'
  /** Which engine surfaced it, for the honest "where did this come from" note */
  engine: string
}

export type WebSearchOutcome = {
  hits: WebVideoHit[]
  /** Engines that actually returned reels, for reporting */
  enginesUsed: string[]
  /**
   * Engines that refused us (429 / 403 / challenge page).
   *
   * Reported separately because only DuckDuckGo and Brave actually index reel
   * permalinks - Bing and Startpage answer HTTP 200 for the same query and
   * return none. So "some engine answered" is NOT evidence that no reels exist;
   * if the two capable engines were parked, the search simply could not look.
   */
  blockedEngines: string[]
  /** True when nothing was found AND at least one engine refused us */
  blocked: boolean
  error: string
}

/**
 * Engines are plain GET + regex. No parser is written against a CSS class,
 * because those change weekly and a silent parse failure is indistinguishable
 * from "no results". Pulling ids straight out of the raw HTML survives redesigns.
 */
const ENGINES: { name: string; url: (q: string) => string }[] = [
  { name: 'duckduckgo', url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` },
  { name: 'brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  { name: 'bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=30` },
  { name: 'startpage', url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  { name: 'searxng', url: (q) => `https://searxng.site/search?q=${encodeURIComponent(q)}` },
  { name: 'mojeek', url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
]

/**
 * An engine that just rate-limited us stays parked. Hammering a 429 is what
 * escalates a soft limit into a long block, so this protects future searches.
 */
const COOLDOWN_MS = 10 * 60 * 1000
const parked = new Map<string, number>()

/** Query -> outcome. Long TTL on purpose: scraping again is the thing that gets us blocked. */
const CACHE_TTL = 6 * 60 * 60 * 1000
const cache = new Map<string, { at: number; hits: WebVideoHit[]; engines: string[] }>()

/** Reel ids are 8+ digits. Anything shorter is a page id or a stray number. */
const REEL_RE = /facebook\.com\/reel\/(\d{8,})/g

/**
 * True when the page is a bot wall rather than results.
 *
 * Needed because these come back HTTP 200: DuckDuckGo serves an `anomaly.js`
 * challenge form that still ECHOES THE QUERY, which is how an early version of
 * this counted its own search terms as 11 "results".
 */
function isBotWall(html: string): boolean {
  return /anomaly\.js|cc=botnet|unusual traffic|are you a robot|\/sorry\/index|captcha-delivery/i.test(html)
}

function extractReels(html: string, engine: string): WebVideoHit[] {
  const seen = new Map<string, WebVideoHit>()
  for (const m of html.matchAll(REEL_RE)) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.set(id, {
      id: `fb-${id}`,
      pageUrl: `https://www.facebook.com/reel/${id}/`,
      // The engine's own <title> text is unreliable to associate with a given
      // link by regex, and resolveFacebook() only ever reports the useless
      // literal "facebook-video". An empty title is honest; the caller labels
      // these by the query that found them.
      title: '',
      platform: 'facebook',
      engine,
    })
  }
  return [...seen.values()]
}

/**
 * Brave's official Search API, used only when a key is configured.
 *
 * This is the reliable path: it is the same index that returned real reels when
 * scraped, but authenticated, so it does not 429 after one request. The free
 * tier is ~2k queries/month, which is far more than this feature needs. When no
 * key is set we fall back to scraping and say so.
 */
async function askBraveApi(query: string): Promise<{ hits: WebVideoHit[]; blocked: boolean } | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return null
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { hits: [], blocked: res.status === 429 || res.status === 401 }
    // Scan the whole payload rather than a specific field, so a schema tweak
    // cannot silently zero this out
    return { hits: extractReels(JSON.stringify(await res.json()), 'brave-api'), blocked: false }
  } catch {
    return { hits: [], blocked: false }
  }
}

async function askEngine(engine: { name: string; url: (q: string) => string }, query: string) {
  const until = parked.get(engine.name) ?? 0
  if (Date.now() < until) return { hits: [] as WebVideoHit[], blocked: true }

  try {
    const res = await fetch(engine.url(query), {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(12_000),
    })
    const html = await res.text()

    // 429/403 and challenge pages both mean "stop asking for a while"
    if (res.status === 429 || res.status === 403 || isBotWall(html)) {
      parked.set(engine.name, Date.now() + COOLDOWN_MS)
      return { hits: [], blocked: true }
    }
    if (!res.ok) return { hits: [], blocked: false }

    return { hits: extractReels(html, engine.name), blocked: false }
  } catch {
    // A timeout is not a block, but it is not worth an immediate retry either
    return { hits: [], blocked: false }
  }
}

/**
 * Search the open web for Facebook reels matching any of `queries`.
 *
 * Queries are tried one at a time and engines are rotated, stopping as soon as
 * enough has been found - the goal is a handful of usable clips, not exhaustive
 * coverage, and every extra request raises the chance of being parked.
 */
export async function searchWebVideos(queries: string[], limit = 12): Promise<WebSearchOutcome> {
  const terms = queries.map((q) => q.trim()).filter((q) => q.length >= 3).slice(0, 3)
  if (!terms.length)
    return { hits: [], enginesUsed: [], blockedEngines: [], blocked: false, error: 'No search terms' }

  const found = new Map<string, WebVideoHit>()
  const enginesUsed = new Set<string>()
  const blockedEngines = new Set<string>()

  for (const term of terms) {
    // `site:` keeps results on reel permalinks instead of the whole of Facebook
    const query = `site:facebook.com/reel ${term}`

    const cached = cache.get(query)
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      for (const h of cached.hits) found.set(h.id, h)
      cached.engines.forEach((e) => enginesUsed.add(e))
      if (found.size >= limit) break
      continue
    }

    const hitsForQuery: WebVideoHit[] = []
    const enginesForQuery: string[] = []

    // The authenticated index first when available - it is the only one that
    // does not rate-limit, so scraping becomes a fallback rather than the plan
    const viaApi = await askBraveApi(query)
    if (viaApi?.hits.length) {
      hitsForQuery.push(...viaApi.hits)
      enginesForQuery.push('brave-api')
      enginesUsed.add('brave-api')
    } else if (viaApi?.blocked) {
      blockedEngines.add('brave-api')
    }

    for (const engine of hitsForQuery.length ? [] : ENGINES) {
      const { hits, blocked } = await askEngine(engine, query)
      if (blocked) blockedEngines.add(engine.name)
      if (hits.length) {
        hitsForQuery.push(...hits)
        enginesForQuery.push(engine.name)
        enginesUsed.add(engine.name)
        // One engine answering is enough for this query; asking the rest only
        // spends goodwill we will need for the next product.
        break
      }
    }

    cache.set(query, { at: Date.now(), hits: hitsForQuery, engines: enginesForQuery })
    for (const h of hitsForQuery) found.set(h.id, h)
    if (found.size >= limit) break
  }

  const hits = [...found.values()].slice(0, limit)
  return {
    hits,
    enginesUsed: [...enginesUsed],
    blockedEngines: [...blockedEngines],
    // Nothing found AND someone refused us: the search could not actually look,
    // so the caller must not present this as "this product has no reels".
    blocked: hits.length === 0 && blockedEngines.size > 0,
    error: '',
  }
}
