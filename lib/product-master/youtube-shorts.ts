/**
 * YouTube Shorts search, no API key.
 *
 * WHY NOT THE OFFICIAL API: the YouTube Data API v3 needs its own key. The
 * project's GOOGLE_AI_API_KEY is a Generative-Language key and returns
 * API_KEY_SERVICE_BLOCKED against youtube/v3 (verified), so the documented
 * route is simply not available here.
 *
 * WHAT THIS USES INSTEAD: the same InnerTube endpoint the youtube.com web
 * player calls. It needs no key, and `params: EgIYAQ%3D%3D` is the encoded
 * "type = Shorts" search filter, so results come back as Shorts rather than
 * long-form uploads.
 *
 * IMPORTANT - SEARCH ONLY, NEVER DOWNLOAD:
 * Finding Shorts works, but pulling their media server-side does not. Both
 * @distube/ytdl-core and three separate InnerTube player clients (IOS, ANDROID,
 * WEB_EMBEDDED_PLAYER) were tested from this box and every one came back with
 * "Sign in to confirm you're not a bot" / LOGIN_REQUIRED. So Shorts are
 * surfaced as things to watch and open, and the caller must not offer them to
 * the clip download queue - only TikTok hits can actually be fetched.
 *
 * Thumbnails are on i.ytimg.com, which does NOT hotlink-block and is NOT on the
 * video-fetch proxy allowlist, so callers must render those URLs directly
 * rather than through inlineUrl().
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Encoded InnerTube search filter for "type: Shorts". */
const SHORTS_FILTER = 'EgIYAQ%3D%3D'

export type ShortsHit = {
  /** The 11-char YouTube video id */
  id: string
  title: string
  /** i.ytimg.com URL - render directly, do not proxy */
  cover: string | null
  /** Shorts watch page */
  pageUrl: string
  author: string
  /** Parsed from the "1.2M views" overlay; 0 when absent */
  plays: number
}

/** "1.2M views" / "45K views" / "812 views" -> a number. */
function parseViews(text: string): number {
  const m = text.match(/([\d.,]+)\s*([KMB])?/i)
  if (!m) return 0
  const n = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(n)) return 0
  const mult = m[2]?.toUpperCase()
  if (mult === 'B') return Math.round(n * 1_000_000_000)
  if (mult === 'M') return Math.round(n * 1_000_000)
  if (mult === 'K') return Math.round(n * 1_000)
  return Math.round(n)
}

/**
 * Walk the InnerTube response for Shorts entries.
 *
 * The payload is a deeply nested renderer tree whose shape changes without
 * notice, so this recurses looking for the two lockup types rather than
 * following a fixed path - a path-based reader breaks on the next tweak.
 */
function extractShorts(payload: unknown): ShortsHit[] {
  const out: ShortsHit[] = []
  const seen = new Set<string>()

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>

    // Current shape (shortsLockupViewModel) and the older reelItemRenderer
    const lockup = (obj.shortsLockupViewModel ?? obj.reelItemRenderer) as
      | Record<string, any>
      | undefined

    if (lockup) {
      const id: string =
        lockup?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
        lockup?.navigationEndpoint?.reelWatchEndpoint?.videoId ||
        String(lockup?.entityId ?? '').match(/[A-Za-z0-9_-]{11}/)?.[0] ||
        lockup?.videoId ||
        ''

      const title: string =
        lockup?.overlayMetadata?.primaryText?.content ||
        lockup?.headline?.simpleText ||
        lockup?.accessibility?.accessibilityData?.label ||
        ''

      const viewText: string =
        lockup?.overlayMetadata?.secondaryText?.content ||
        lockup?.viewCountText?.simpleText ||
        ''

      if (id && /^[A-Za-z0-9_-]{11}$/.test(id) && !seen.has(id)) {
        seen.add(id)
        out.push({
          id,
          title: (title || 'Untitled').slice(0, 160),
          // Deterministic thumbnail: the lockup's own image URL is a short-lived
          // signed variant, while this path is stable for any public video.
          cover: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          pageUrl: `https://www.youtube.com/shorts/${id}`,
          author: '',
          plays: parseViews(viewText),
        })
      }
    }

    for (const key of Object.keys(obj)) visit(obj[key])
  }

  visit(payload)
  return out
}

/**
 * Search YouTube Shorts for a phrase.
 *
 * Resolves to [] on any failure rather than throwing: this is fanned out over
 * several AI-generated phrasings alongside the TikTok index, and one dud
 * phrasing (or YouTube rate-limiting one call) must not sink the whole search.
 */
export async function searchYouTubeShorts(query: string, limit = 12): Promise<ShortsHit[]> {
  const term = query.trim()
  if (term.length < 2) return []

  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/search?prettyPrint=false`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'en',
            gl: 'US',
          },
        },
        query: term,
        params: SHORTS_FILTER,
      }),
      // Shorts search is a nice-to-have next to the downloadable TikTok
      // results, so it must never hold the whole request open.
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) {
      console.log('[v0] youtube-shorts: search http', res.status, 'for', term)
      return []
    }

    const hits = extractShorts(await res.json())
    return hits.slice(0, limit)
  } catch (e) {
    console.log(
      '[v0] youtube-shorts: search failed for',
      term,
      '-',
      e instanceof Error ? e.message : e,
    )
    return []
  }
}
