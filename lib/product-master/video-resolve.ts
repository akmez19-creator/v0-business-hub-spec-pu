/**
 * Platform video resolvers, shared by the interactive video-fetch route and the
 * background clip-jobs worker.
 *
 * Extracted verbatim from app/api/product-master/video-fetch/route.ts so both
 * callers use one copy. The worker needs these because a queued job must
 * resolve a FRESH stream url at download time - the signed CDN links these
 * return expire, so a job retried minutes later cannot reuse the url that was
 * resolved when the user clicked.
 */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export type Resolved = {
  videoUrl: string
  title: string
  cover: string | null
  source: 'tiktok' | 'facebook' | 'youtube' | 'bilibili'
  quality: 'hd' | 'sd'
}

/**
 * Keyword search against the provider's video index.
 *
 * WHY THIS LOOKS ODD: the provider put a Cloudflare bot challenge on the exact
 * path `/api/feed/search`, which 403s every request with a "Just a moment..."
 * page - that is what broke search by name and, silently, search by product
 * photo. The rule matches the path literally, so `/api/feed/search/` with a
 * trailing slash is not matched and returns normal JSON (verified: code 0,
 * real playable results, while the unslashed path failed 5/5).
 *
 * That is a fragile thing to depend on, so both spellings are tried rather
 * than swapping one hardcoded path for another: whichever side of the rule
 * moves next, one of the two still works. Kept here, in the one module both
 * search routes share, so the next block is a single-place fix.
 */
export async function searchVideoIndex(params: {
  keywords: string
  count?: number
  cursor?: number
}): Promise<{ cursor?: number; hasMore?: boolean; videos?: unknown[] }> {
  const body = `keywords=${encodeURIComponent(params.keywords)}&count=${params.count ?? 24}&cursor=${
    params.cursor ?? 0
  }&HD=1`

  // Trailing slash first - it is the spelling that currently gets through
  const paths = ['https://www.tikwm.com/api/feed/search/', 'https://www.tikwm.com/api/feed/search']
  let lastError = 'Search service unreachable'

  for (const path of paths) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body,
      })
      if (!res.ok) {
        // 403 here means the bot wall, not a bad query - try the other spelling
        lastError = res.status === 403 ? 'Search is being blocked by the video provider' : `Search failed (${res.status})`
        continue
      }
      const json = (await res.json()) as { code: number; msg?: string; data?: { videos?: unknown[] } }
      if (json.code !== 0 || !json.data) {
        // A real provider answer ("no results") is final - do not retry it as
        // if it were a transport problem
        throw new Error(json.msg || 'No results')
      }
      return json.data
    } catch (e) {
      // A thrown provider answer must not be swallowed by the next attempt
      if (e instanceof Error && (e.message === 'No results' || !/fetch|network|unreachable/i.test(e.message))) {
        throw e
      }
      lastError = 'Search service unreachable'
    }
  }

  throw new Error(lastError)
}

// ---- TikTok: tikwm returns the watermark-free video (hdplay = full HD) ----
export async function resolveTikTok(url: string): Promise<Resolved> {
  const res = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `url=${encodeURIComponent(url)}&hd=1`,
  })
  if (!res.ok) throw new Error('TikTok resolver unreachable')
  const json = (await res.json()) as {
    code: number
    msg?: string
    data?: { hdplay?: string; play?: string; title?: string; cover?: string }
  }
  if (json.code !== 0 || !json.data) throw new Error(json.msg || 'TikTok video not found')
  const raw = json.data.hdplay || json.data.play
  if (!raw) throw new Error('No downloadable stream for this TikTok')
  const videoUrl = raw.startsWith('http') ? raw : `https://www.tikwm.com${raw}`
  return {
    videoUrl,
    title: (json.data.title || 'tiktok-video').slice(0, 120),
    cover: json.data.cover || null,
    source: 'tiktok',
    quality: json.data.hdplay ? 'hd' : 'sd',
  }
}

// ---- Facebook: the public embed player exposes hd_src/sd_src without
// login. Works for videos, reels and fb.watch links. For post permalinks
// (pageId_postId) we resolve the video id via the Graph API first. ----
async function scrapeFbEmbed(href: string): Promise<Resolved | null> {
  const embed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`
  const res = await fetch(embed, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const html = await res.text()
  const pick = (key: string) => {
    const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`))
    if (!m) return null
    try {
      return JSON.parse(`"${m[1]}"`) as string
    } catch {
      return null
    }
  }
  const hd = pick('browser_native_hd_url') || pick('playable_url_quality_hd') || pick('hd_src')
  const sd = pick('browser_native_sd_url') || pick('playable_url') || pick('sd_src')
  const videoUrl = hd || sd
  if (!videoUrl) return null
  const title = pick('video_title') || 'facebook-video'
  return { videoUrl, title: title.slice(0, 120), cover: null, source: 'facebook', quality: hd ? 'hd' : 'sd' }
}

export async function resolveFacebook(url: string): Promise<Resolved> {
  // Direct attempt with the given link
  const direct = await scrapeFbEmbed(url)
  if (direct) return direct

  // fb.watch and share links redirect - follow and retry with the final URL
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (res.url && res.url !== url) {
      const followed = await scrapeFbEmbed(res.url)
      if (followed) return followed
    }
  } catch {
    // ignore, try Graph fallback below
  }

  // Post permalink (pageId_postId) - resolve the ad creative's video id via
  // the Graph API, then embed watch?v=<video_id>
  const storyMatch = url.match(/facebook\.com\/(\d{6,}_\d{6,})/)
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (storyMatch && token) {
    const idsToTry: string[] = []
    const storyRes = await fetch(
      `https://graph.facebook.com/v21.0/${storyMatch[1]}?fields=id&access_token=${encodeURIComponent(token)}`,
    )
    if (storyRes.ok) idsToTry.push(storyMatch[1].split('_')[1])
    for (const vid of idsToTry) {
      const viaId = await scrapeFbEmbed(`https://www.facebook.com/watch/?v=${vid}`)
      if (viaId) return viaId
    }
  }

  throw new Error(
    'Could not extract this Facebook video. Make sure the video is public (ad/page videos work best).',
  )
}

// ---- YouTube: blocked for datacenter IPs by YouTube itself; best-effort
// via ytdl-core, with an honest error when YouTube refuses. ----
export async function resolveYouTube(url: string): Promise<Resolved> {
  try {
    const ytdl = (await import('@distube/ytdl-core')).default
    const info = await ytdl.getInfo(url)
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: (f) => Boolean(f.hasVideo && f.hasAudio),
    })
    if (!format?.url) throw new Error('no format')
    return {
      videoUrl: format.url,
      title: (info.videoDetails.title || 'youtube-video').slice(0, 120),
      cover: info.videoDetails.thumbnails?.at(-1)?.url || null,
      source: 'youtube',
      quality:
        (format.qualityLabel || '').includes('720') || (format.qualityLabel || '').includes('1080') ? 'hd' : 'sd',
    }
  } catch {
    throw new Error(
      'YouTube blocks server downloads right now. Download it with your usual site and upload the file here - TikTok and Facebook links work directly.',
    )
  }
}

/**
 * Which platform a pasted link belongs to, or null when unsupported.
 *
 * Instagram is deliberately absent. Reels found via hashtag search arrive with
 * a ready mp4 url, but that url is single-use: re-reading the media by id is
 * refused for content we do not own, so an instagram.com/reel/... permalink
 * cannot be turned back into a stream. Returning null keeps `canReResolve`
 * false for those jobs, so a stale retry fails cleanly instead of looping.
 */
export function platformOf(url: string): 'tiktok' | 'facebook' | 'youtube' | 'bilibili' | null {
  if (/tiktok\.com|vt\.tiktok/i.test(url)) return 'tiktok'
  if (/facebook\.com|fb\.watch|fb\.me/i.test(url)) return 'facebook'
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube'
  if (/bilibili\.com|b23\.tv/i.test(url)) return 'bilibili'
  return null
}

/**
 * Bilibili, adapted to the shared `Resolved` shape.
 *
 * Unlike YouTube this one genuinely works from a datacenter IP - verified 5/5
 * videos returning HTTP 206 real mp4s - so its clips are downloadable rather
 * than hand-off only. The page url is re-resolvable, which is what the retry
 * path in the clip-jobs worker needs.
 */
async function resolveBilibiliAsResolved(url: string): Promise<Resolved> {
  const { resolveBilibili } = await import('./bilibili')
  const out = await resolveBilibili(url)
  if (!out.videoUrl) throw new Error(out.error || 'Could not extract this Bilibili video.')
  return {
    videoUrl: out.videoUrl,
    title: (out.title || 'bilibili-video').slice(0, 120),
    cover: out.cover,
    source: 'bilibili',
    // qn=32 is Bilibili's 480p tier: the highest a guest session is served
    // without a login, so calling it "hd" would be a lie in the clip list.
    quality: 'sd',
  }
}

/** Resolve any supported link to a direct stream. Throws on unsupported hosts. */
export async function resolveAny(url: string): Promise<Resolved> {
  switch (platformOf(url)) {
    case 'tiktok':
      return resolveTikTok(url)
    case 'facebook':
      return resolveFacebook(url)
    case 'youtube':
      return resolveYouTube(url)
    case 'bilibili':
      return resolveBilibiliAsResolved(url)
    default:
      throw new Error('Unsupported link. Use TikTok, Facebook, YouTube or Bilibili.')
  }
}

/**
 * Hosts our own proxy and worker will fetch from.
 *
 * The marketplace CDNs are here because TMAPI listing photos and videos are
 * served from them - without these entries every marketplace thumbnail and clip
 * would be refused by our own proxy with a 403.
 */
export const ALLOWED_HOSTS =
  // .cdninstagram.com is where Instagram Reel mp4s are served from. Meta also
  // uses .fbcdn.net for the same content, so BOTH are needed - a reel resolved
  // to a cdninstagram host would otherwise be refused by our own proxy.
  /(\.fbcdn\.net|\.cdninstagram\.com|\.tiktokcdn[^/]*\.com|tikwm\.com|\.googlevideo\.com|\.akamaized\.net|\.mm\.bing\.net|duckduckgo\.com|\.alicdn\.com|\.aliexpress-media\.com|\.susercontent\.com|\.shopeemobile\.com|\.shopee\.[a-z.]+|\.media-amazon\.com|\.ssl-images-amazon\.com|\.lazcdn\.com|\.slatic\.net|\.dhresource\.com|\.byteimg\.com|\.tbcdn\.cn|\.taobaocdn\.com|\.video\.taobao\.com|\.bilivideo\.com|\.hdslb\.com)$/i

/** True when we are willing to download from this url's host. */
export function hostAllowed(url: string): boolean {
  try {
    return ALLOWED_HOSTS.test(new URL(url).hostname)
  } catch {
    return false
  }
}
