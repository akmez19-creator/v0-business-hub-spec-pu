/**
 * Bilibili video search - the "deep search" source.
 *
 * WHY THIS ONE, out of everything tested. I probed 20 candidate sources from
 * this server before writing a line of this file. Nearly all of them are walled
 * to a datacenter IP: Douyin returns an empty list without a signed `a-bogus`
 * param, Kuaishou and Youku serve a captcha, Xiaohongshu 500s, Weibo redirects
 * to its "visitor system", and every public SearXNG instance plus Yandex,
 * Startpage, Ecosia, Rumble, Pinterest and Marginalia either 403 or bot-wall us.
 * Dailymotion's search API works, but its only stream is an HLS manifest that
 * 403s from here - searchable, not usable, so it is deliberately NOT wired in.
 *
 * Bilibili is the one that passes end to end, and it is a genuinely good fit:
 * it is where Chinese buyers post hands-on product tests and comparisons, which
 * is exactly the footage a 1688 listing photo cannot give you.
 *
 * MEASURED, not assumed:
 *   - search returns 1000 results for a Chinese product term
 *   - `playurl` returns code 0 and a real mp4 (`ftyp` at byte 4)
 *   - the CDN answers 206 to a Range request, which the card self-preview needs
 *   - the CDN needs NO Referer and NO cookie, unlike the API itself
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export type BilibiliHit = {
  id: string
  title: string
  cover: string | null
  play: string | null
  duration: number
  author: string
  authorId: string
  pageUrl: string
  plays: number
  likes: number
  platform: 'bilibili'
  downloadable: boolean
}

export type BilibiliOutcome = {
  videos: BilibiliHit[]
  /** Why the list is empty, when it is empty for a REASON rather than genuinely. */
  error: string
}

const empty = (error = ''): BilibiliOutcome => ({ videos: [], error })

/**
 * The search API answers 412 ("precondition failed") to a cookieless request -
 * it wants the `buvid3` any browser picks up on its first page view. Loading the
 * home page once and replaying the Set-Cookie is enough; there is no login and
 * no API key anywhere in this file.
 *
 * Cached for the lifetime of the lambda so a multi-keyword fan-out costs one
 * handshake rather than one per query.
 */
let cookieCache: { value: string; at: number } | null = null

async function guestCookie(): Promise<string> {
  if (cookieCache && Date.now() - cookieCache.at < 10 * 60 * 1000) return cookieCache.value
  try {
    const res = await fetch('https://www.bilibili.com/', {
      headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    })
    const jar = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ')
    cookieCache = { value: jar, at: Date.now() }
    return jar
  } catch {
    return ''
  }
}

function apiHeaders(cookie: string) {
  return {
    'user-agent': UA,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    referer: 'https://www.bilibili.com/',
    ...(cookie ? { cookie } : {}),
  }
}

/**
 * Durations arrive as display strings ("1:44", "1:02:03"), not seconds. A raw
 * `Number()` on those yields NaN, which would render as an empty duration badge
 * and break any sort on length.
 */
function parseDuration(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw))
  if (typeof raw !== 'string') return 0
  const parts = raw.split(':').map((p) => Number.parseInt(p, 10))
  if (parts.some((p) => !Number.isFinite(p))) return 0
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/**
 * Titles come back with the matched words wrapped in `<em class="keyword">`, so
 * rendering them raw shows literal markup inside the card.
 */
function cleanTitle(raw: unknown): string {
  return String(raw ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** Covers are protocol-relative (`//i1.hdslb.com/...`), which is not fetchable server-side. */
function absoluteCover(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (s.startsWith('//')) return `https:${s}`
  return s.startsWith('http') ? s : null
}

/**
 * Searches one keyword. Bilibili is a Chinese site, so a Chinese term finds
 * dramatically more than its English translation - the caller is expected to
 * pass Chinese phrases where it has them.
 */
async function searchOne(keyword: string, cookie: string): Promise<BilibiliHit[]> {
  const url =
    'https://api.bilibili.com/x/web-interface/search/type' +
    `?search_type=video&keyword=${encodeURIComponent(keyword)}&page=1&order=totalrank`
  const res = await fetch(url, { headers: apiHeaders(cookie) })
  if (!res.ok) return []
  const json = (await res.json().catch(() => null)) as
    | { code?: number; data?: { result?: unknown[] } }
    | null
  if (!json || json.code !== 0) return []

  const rows = Array.isArray(json.data?.result) ? json.data!.result! : []
  const out: BilibiliHit[] = []
  for (const row of rows as Record<string, unknown>[]) {
    const bvid = String(row.bvid ?? '').trim()
    if (!bvid) continue
    out.push({
      id: `bilibili:${bvid}`,
      title: cleanTitle(row.title),
      cover: absoluteCover(row.pic),
      // Deliberately null: the mp4 is behind two more API calls, so resolving
      // every hit up front would multiply the request count for clips nobody
      // clicks. The download path resolves from `pageUrl` on demand.
      play: null,
      duration: parseDuration(row.duration),
      author: String(row.author ?? ''),
      authorId: String(row.mid ?? ''),
      pageUrl: `https://www.bilibili.com/video/${bvid}`,
      plays: Number(row.play) || 0,
      likes: Number(row.like) || 0,
      platform: 'bilibili',
      downloadable: true,
    })
  }
  return out
}

/**
 * Fans out over several phrases and de-duplicates by bvid, mirroring how the
 * other sources are searched.
 */
export async function searchBilibili(keywords: string[]): Promise<BilibiliOutcome> {
  const terms = Array.from(new Set(keywords.map((k) => k.trim()).filter(Boolean))).slice(0, 6)
  if (!terms.length) return empty('No search term for Bilibili.')

  const cookie = await guestCookie()
  // Without the guest cookie every query 412s, so say so rather than showing an
  // empty row that reads as "no Chinese videos exist".
  if (!cookie) return empty('Bilibili would not issue a guest session from the server just now.')

  const settled = await Promise.allSettled(terms.map((t) => searchOne(t, cookie)))
  const seen = new Set<string>()
  const videos: BilibiliHit[] = []
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue
    for (const hit of s.value) {
      if (seen.has(hit.id)) continue
      seen.add(hit.id)
      videos.push(hit)
    }
  }

  if (!videos.length) {
    const allRejected = settled.every((s) => s.status === 'rejected')
    return empty(allRejected ? 'Bilibili did not respond from the server just now.' : '')
  }
  // Most-watched first: on Bilibili view count tracks how thorough a hands-on
  // test is far better than upload date does.
  videos.sort((a, b) => b.plays - a.plays)
  return { videos, error: '' }
}

/**
 * Turns a Bilibili page URL into a downloadable mp4.
 *
 * `fnval=1` asks for the legacy single-file mp4 rather than the DASH streams the
 * web player normally uses; DASH would hand back separate video and audio tracks
 * that we would then have to mux ourselves.
 */
export async function resolveBilibili(pageUrl: string): Promise<{
  videoUrl: string | null
  title: string
  cover: string | null
  error: string
}> {
  const bvid = pageUrl.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? ''
  if (!bvid) return { videoUrl: null, title: '', cover: null, error: 'Not a Bilibili video link.' }

  const cookie = await guestCookie()
  const headers = apiHeaders(cookie)

  /*
   * `/x/web-interface/view` is the obvious way to get the cid and it answers 412
   * to us - it sits behind the same WAF as the unsigned search endpoint, needing
   * a signed `wbi` param. `/x/player/pagelist` returns the same cid and is NOT
   * behind it, so it is used instead. Verified side by side: view 412, pagelist
   * 200 code 0, on the same video with the same cookie.
   *
   * The consequence is that no title or cover comes back from here - the search
   * hit already carries both, so the caller keeps what it displayed rather than
   * this function inventing a second source of truth for them.
   */
  const list = (await fetch(`https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`, { headers })
    .then((r) => r.json())
    .catch(() => null)) as { code?: number; data?: { cid?: number; part?: string }[] } | null
  if (!list || list.code !== 0 || !Array.isArray(list.data) || !list.data.length) {
    return { videoUrl: null, title: '', cover: null, error: 'Bilibili would not return this video.' }
  }

  const cid = Number(list.data[0]?.cid) || 0
  const partTitle = cleanTitle(list.data[0]?.part)
  if (!cid) return { videoUrl: null, title: '', cover: null, error: 'Bilibili returned no playable part.' }

  const play = (await fetch(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=32&fnval=1&platform=html5`,
    { headers },
  )
    .then((r) => r.json())
    .catch(() => null)) as { code?: number; data?: { durl?: { url?: string }[] } } | null

  const videoUrl = play?.code === 0 ? play.data?.durl?.[0]?.url ?? null : null
  if (!videoUrl) {
    return {
      videoUrl: null,
      title: partTitle,
      cover: null,
      error: 'This Bilibili video is members-only or region-locked.',
    }
  }

  return { videoUrl, title: partTitle, cover: null, error: '' }
}
