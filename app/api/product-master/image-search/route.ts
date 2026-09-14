import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createClient } from '@/lib/supabase/server'
import { searchVideoIndex } from '@/lib/product-master/video-resolve'
import { searchYouTubeShorts } from '@/lib/product-master/youtube-shorts'
import { searchBilibili } from '@/lib/product-master/bilibili'
import { findListingVideos } from '@/lib/product-master/listing-videos'
import { prepareSearchImageFromBytes, releaseSearchImage } from '@/lib/product-master/search-image'
import { searchWebVideos } from '@/lib/product-master/web-video-search'

export const maxDuration = 60

/**
 * Rank supplier listing videos above every social hit.
 *
 * Deliberately a constant rather than a keyword score: these were matched by the
 * PHOTO, so relevance is already established, and their titles are Chinese and
 * would score zero against English keywords. Higher than any realistic keyword
 * count so they always lead.
 */
const LISTING_SCORE = 100

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Which platform a hit came from.
 *
 * This is not cosmetic - it decides whether the clip can be downloaded.
 * TikTok resolves to a watermark-free stream server-side; YouTube Shorts are
 * findable but bot-walled for download (see lib/product-master/youtube-shorts),
 * so the UI must offer "open" rather than "add to feed" for those.
 *
 * 'alibaba' is the supplier's own listing video, found by reverse-image search
 * on the product photo. It is the highest-value source here because it films the
 * ACTUAL product rather than the same category filmed by a stranger.
 */
export type HitPlatform = 'tiktok' | 'youtube' | 'alibaba' | 'facebook' | 'bilibili'

type SearchHit = {
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
  score: number
  platform: HitPlatform
  /** False for YouTube Shorts - search works, media fetch is blocked */
  downloadable: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const abs = (u?: string | null) => {
  if (!u) return null
  return u.startsWith('http') ? u : `https://www.tikwm.com${u}`
}

// Vision pass with the same resilience pattern used by ai-post: try the AI
// Gateway first, fall back to Gemini directly so lens search never goes down.
async function describeImage(imageData: string | Uint8Array, hint: string) {
  const system =
    'You identify consumer products in photos for a Mauritius e-commerce shop, so the shop can find ' +
    'real short-form videos (TikTok and YouTube Shorts) of the SAME kind of product to use in their reels. ' +
    'Look only at the product itself - ignore backgrounds, hands, watermarks and text overlays. ' +
    'Reply with STRICT JSON only, no markdown fence, in this exact shape:\n' +
    '{"label":"short product name","category":"broad category",' +
    '"names":["6 to 10 alternative names this product is sold under, including the generic name, ' +
    'common retail/marketplace names, and any regional or brand-style variants"],' +
    '"queries":["8 to 12 short search phrases people would actually type to find videos of this product"],' +
    '"keywords":["6 to 12 single lowercase words that must plausibly appear in a matching video title"],' +
    '"zh":["3 to 5 SIMPLIFIED CHINESE search phrases for this product as it would be searched on a ' +
    'Chinese video site - the plain product term plus how it is reviewed or tested, e.g. 便携剃须刀, ' +
    '剃须刀测评. Chinese characters only, no pinyin, no English"]}\n' +
    'The same object is often listed under very different names, so `names` matters: a shop label like ' +
    '"10M Hanging Rope" may really be an "anti-slip clothesline", a "windproof laundry line" or a ' +
    '"travel drying rope". Spread the names across those real-world phrasings.\n' +
    'Queries must describe the PRODUCT and how it is used, demoed or reviewed (e.g. "nylon rope strength test", ' +
    '"clothes line rope install"), never movie titles, songs or unrelated phrases. Keep each query under 5 words.'

  const prompt = hint
    ? `Identify this product. The shop lists it as "${hint}" but trust the image over that label if they disagree.`
    : 'Identify this product.'

  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: prompt },
        { type: 'image' as const, image: imageData },
      ],
    },
  ]

  try {
    const { text } = await generateText({ model: 'google/gemini-3-flash', system, messages })
    return text
  } catch (gatewayError) {
    const googleKey = process.env.GOOGLE_AI_API_KEY
    if (!googleKey) throw gatewayError
    console.error(
      'image-search: gateway failed, falling back to Gemini:',
      gatewayError instanceof Error ? gatewayError.name : gatewayError,
    )
    const google = createGoogleGenerativeAI({ apiKey: googleKey })
    const { text } = await generateText({ model: google('gemini-2.5-flash'), system, messages })
    return text
  }
}

function parseVision(raw: string) {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    const o = JSON.parse(cleaned.slice(start, end + 1)) as {
      label?: string
      category?: string
      names?: unknown
      queries?: unknown
      keywords?: unknown
      zh?: unknown
    }
    const list = (v: unknown, cap: number) =>
      Array.isArray(v)
        ? [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => x.length > 1))].slice(0, cap)
        : []
    return {
      label: String(o.label || '').slice(0, 80),
      category: String(o.category || '').slice(0, 60),
      names: list(o.names, 10),
      queries: list(o.queries, 12),
      keywords: list(o.keywords, 12),
      // Chinese terms for the deep sources. Bilibili is a Chinese site: an
      // English phrase finds a fraction of what the native term does, and the
      // hands-on comparison videos worth having are titled in Chinese only.
      zh: list(o.zh, 6),
    }
  } catch {
    return null
  }
}

type RawSearchVideo = {
  video_id?: string
  title?: string
  cover?: string
  origin_cover?: string
  play?: string
  duration?: number
  play_count?: number
  digg_count?: number
  author?: { nickname?: string; unique_id?: string }
}

/**
 * One phrasing against the TikTok index.
 *
 * Returning [] on failure is deliberate: this fans out over several phrases and
 * one bad phrasing should not sink the search. But it also meant a provider
 * block looked exactly like "nothing matched your photo", which is how the
 * Cloudflare wall on the search path stayed invisible here. The reason is now
 * logged and reported to the caller so a total failure can say so.
 */
async function searchOne(query: string, onBlocked?: (reason: string) => void) {
  try {
    const data = await searchVideoIndex({ keywords: query, count: 16, cursor: 0 })
    return (data.videos ?? []) as RawSearchVideo[]
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Search failed'
    if (reason !== 'No results') {
      console.log('[v0] image-search phrase failed:', query, '-', reason)
      onBlocked?.(reason)
    }
    return []
  }
}

// POST { imageUrl | imageBase64, productName }
// "Lens" search: read the product photo, derive the names this thing is really
// sold under, fan those out across TikTok and YouTube Shorts, then rank hits by
// how well their titles match. This is what stops a text search for
// "10M Hanging Rope" returning movie trailers.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const imageUrl = String(body?.imageUrl || '').trim()
    const imageBase64 = String(body?.imageBase64 || '')
    const productName = String(body?.productName || '').slice(0, 120)

    // Fetch remote images server-side so private/CDN hosts and signed URLs
    // work the same as a direct upload
    let imageData: string | Uint8Array
    if (imageBase64) {
      imageData = imageBase64.replace(/^data:[^;]+;base64,/, '')
    } else if (/^https?:\/\//i.test(imageUrl)) {
      const img = await fetch(imageUrl, { headers: { 'User-Agent': UA } })
      if (!img.ok) throw new Error('Could not load the product image')
      const buf = new Uint8Array(await img.arrayBuffer())
      if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('Product image is too large')
      imageData = buf
    } else {
      return NextResponse.json({ success: false, error: 'No image provided' }, { status: 400 })
    }

    const vision = parseVision(await describeImage(imageData, productName))
    if (!vision || vision.queries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Could not read that image - try another photo' },
        { status: 422 },
      )
    }

    // If every TikTok phrasing fails for the same provider-side reason, say so
    // rather than "no videos match your photo" - but only when YouTube came up
    // empty too, since Shorts alone is still a usable result.
    let blockedReason = ''
    const noteBlocked = (reason: string) => {
      blockedReason ||= reason
    }

    // The AI's alternate names are searched as well as its usage phrasings:
    // the shop's own label is frequently not what anyone films this thing as.
    const phrases = [...new Set([...vision.queries, ...vision.names])]

    // TikTok's provider allows roughly 1 request/second, so its phrasings are
    // spaced out. YouTube has no such limit here and runs fully in parallel,
    // which keeps the extra platform almost free in wall-clock terms.
    const ytPromise = Promise.all(
      phrases.slice(0, 6).map((q) => searchYouTubeShorts(q, 10).catch(() => [])),
    )

    /*
     * DEEP SEARCH (opt-in). Bilibili is the only extra source that survived
     * testing from this server - see the header of lib/product-master/bilibili.ts
     * for the full list of what was probed and exactly how each one refused us.
     *
     * Opt-in rather than always-on for one honest reason: it is a Chinese site
     * whose clips are long-form comparison tests, so it changes the character of
     * the grid. It costs one extra request round and never blocks the rest -
     * a failure here leaves every other source untouched.
     *
     * Searched with the AI's Chinese terms first, falling back to the English
     * label only if the model gave none, since the native term is what finds
     * the good footage.
     */
    const deep = body?.deep === true
    const zhTerms = vision.zh.length ? vision.zh : [vision.label].filter(Boolean)
    const biliPromise = deep
      ? searchBilibili(zhTerms).catch(() => ({ videos: [], error: 'Bilibili search failed.' }))
      : Promise.resolve({ videos: [], error: '' })

    // The supplier's own listing video, found by reverse-image search on this
    // same photo. Runs in parallel with the social searches. Alibaba pulls the
    // image from our link from inside China, so it needs a public URL - an
    // uploaded photo used to be skipped entirely here, which is why "Upload" and
    // "Better photo" silently returned social results only. Now the bytes are
    // published to a temp public URL first, and removed once the search is done.
    const listingPromise = (async () => {
      if (/^https?:\/\//i.test(imageUrl)) return findListingVideos(imageUrl).catch(() => null)
      if (!imageBase64) return null
      // `imageData` is a base64 STRING on this branch (it is only a Uint8Array
      // for the fetched-URL branch), so it must be decoded, not wrapped.
      const prepared = await prepareSearchImageFromBytes(Buffer.from(String(imageData), 'base64'))
      if (!prepared.url) {
        return {
          videos: [],
          photos: [],
          matched: 0,
          checked: 0,
          error: prepared.error || 'Could not prepare the upload for 1688 search.',
        }
      }
      try {
        return await findListingVideos(prepared.url).catch(() => null)
      } finally {
        await releaseSearchImage(prepared)
      }
    })()

    // Facebook reels via open web search. Facebook has no video search API at
    // all (the Graph endpoint is unsupported, not merely restricted), so the
    // only route to a reel permalink is a search engine that has indexed it.
    const webPromise = searchWebVideos(phrases.slice(0, 2), 10).catch(() => null)

    const tikBatches: RawSearchVideo[][] = []
    const tikPhrases = phrases.slice(0, 6)
    for (let i = 0; i < tikPhrases.length; i++) {
      if (i) await sleep(1100)
      tikBatches.push(await searchOne(tikPhrases[i], noteBlocked).catch(() => []))
    }

    const [ytBatches, listing, web] = await Promise.all([ytPromise, listingPromise, webPromise])


    const keywords = vision.keywords.length > 0 ? vision.keywords : vision.label.toLowerCase().split(/\s+/)
    const scoreOf = (title: string) => {
      const lower = title.toLowerCase()
      return keywords.filter((k) => lower.includes(k)).length
    }

    const seen = new Set<string>()
    const merged: SearchHit[] = []

    for (const videos of tikBatches) {
      for (const v of videos) {
        if (!v.video_id || seen.has(`tt:${v.video_id}`)) continue
        seen.add(`tt:${v.video_id}`)
        const title = (v.title || 'Untitled').slice(0, 160)
        const uid = v.author?.unique_id || ''
        merged.push({
          id: String(v.video_id),
          title,
          cover: abs(v.cover || v.origin_cover),
          play: abs(v.play),
          duration: Number(v.duration || 0),
          author: v.author?.nickname || uid || 'Unknown',
          authorId: uid,
          pageUrl: uid
            ? `https://www.tiktok.com/@${uid}/video/${v.video_id}`
            : `https://www.tiktok.com/video/${v.video_id}`,
          plays: Number(v.play_count || 0),
          likes: Number(v.digg_count || 0),
          score: scoreOf(title),
          platform: 'tiktok',
          downloadable: true,
        })
      }
    }

    for (const shorts of ytBatches) {
      for (const s of shorts) {
        if (seen.has(`yt:${s.id}`)) continue
        seen.add(`yt:${s.id}`)
        merged.push({
          id: `yt-${s.id}`,
          title: s.title,
          cover: s.cover,
          // No stream: YouTube blocks server-side media fetch, so there is
          // nothing to inline-play or download here.
          play: null,
          duration: 0,
          author: s.author || 'YouTube',
          authorId: '',
          pageUrl: s.pageUrl,
          plays: s.plays,
          likes: 0,
          score: scoreOf(s.title),
          platform: 'youtube',
          downloadable: false,
        })
      }
    }

    // The supplier's listing videos. Scored above everything else on purpose:
    // reverse-image search matched the actual object, so these are not "similar
    // products" but this product. Ranking them by keyword like a social title
    // would bury them, since the titles are Chinese and match no English keyword.
    for (const v of listing?.videos ?? []) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      merged.push({
        id: v.id,
        // 1688 titles are Chinese keyword-stuffed strings. On screen they came
        // out as tofu boxes (the UI font carries no CJK glyphs) and would be
        // unreadable to this shop even with the glyphs, so lead with what the
        // reader can actually use: the identified product and the asking price.
        // The "¥" is not decoration. 1688 prices are YUAN, and a bare "11.8" on
        // a Mauritius screen reads as rupees - which makes a real rope look
        // absurdly cheap and invites a pricing mistake. lib/inventory/cost.ts
        // sets the same rule: yuan is only ever shown as a LABELLED reference.
        title: v.price ? `${vision.label} - ${'\u00a5'}${v.price}` : vision.label,
        cover: v.cover,
        play: v.play,
        duration: 0,
        // Same problem for the shop name, and "1688 supplier" is the useful part
        author: '1688 supplier',
        authorId: '',
        pageUrl: v.pageUrl,
        // Sales volume only exists on the detail record, never on image search,
        // so this stays 0 and the UI hides the metric rather than printing "0"
        plays: v.sold,
        likes: 0,
        score: LISTING_SCORE,
        platform: 'alibaba',
        downloadable: true,
      })
    }

    for (const r of web?.hits ?? []) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push({
        id: r.id,
        title: r.title || 'Facebook reel',
        // Web search gives a permalink and nothing else. The stream is resolved
        // on demand when the user adds it, so there is no cover to show here.
        cover: null,
        play: null,
        duration: 0,
        author: 'Facebook',
        authorId: '',
        pageUrl: r.pageUrl,
        plays: 0,
        likes: 0,
        // Floor of 1: the engine was asked for this product phrase, so relevance
        // is established by the query itself. Scoring a bare 0 would let the
        // "drop the zero-match noise" filter discard the rarest source we have,
        // and these are hard enough to find that losing them is worse than
        // showing one loose match.
        score: Math.max(1, scoreOf(r.title || '')),
        platform: 'facebook',
        downloadable: true,
      })
    }

    /*
     * Deep-search hits. Chinese titles score 0 against English keywords, which
     * is precisely how the ranking silently deleted every 1688 row once before,
     * so these carry a floor of 1 and are exempted from the noise filter below.
     * Their relevance comes from having been searched with the native product
     * term, not from an English keyword appearing in a Chinese title.
     */
    const bili = await biliPromise
    for (const v of bili.videos) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      merged.push({
        id: v.id,
        title: v.title || 'Bilibili video',
        cover: v.cover,
        play: v.play,
        duration: v.duration,
        author: v.author,
        authorId: v.authorId,
        pageUrl: v.pageUrl,
        plays: v.plays,
        likes: v.likes,
        score: Math.max(1, scoreOf(v.title || '')),
        platform: 'bilibili',
        downloadable: true,
      })
    }

    if (blockedReason && merged.length === 0) {
      return NextResponse.json({ success: false, error: blockedReason }, { status: 502 })
    }

    /**
     * Drop the zero-match noise only when there are enough genuine matches to
     * fill the grid.
     *
     * `alibaba` is EXEMPT, and that exemption is load-bearing. Supplier titles
     * are Chinese keyword-stuffed strings, so `scoreOf()` - which counts English
     * keywords - returns 0 for every one of them. With TikTok alone supplying 8+
     * matches, this filter was silently deleting every 1688 listing video on
     * every search. Their relevance was established by REVERSE-IMAGE MATCH on
     * the actual object, which is stronger evidence than any title keyword.
     */
    const matched = merged.filter((m) => m.score > 0 || m.platform === 'alibaba')
    const pool = matched.length >= 8 ? matched : merged

    /**
     * Group by SOURCE, in the order the shop wants to look at them.
     *
     * Facebook Reels lead because that is where these ads are actually posted,
     * so a reel is the closest thing to the finished product. 1688 sits below
     * TikTok rather than at the top (where relevance alone would put it, since
     * reverse-image search matched the exact object) because a supplier clip is
     * raw footage, not an ad. YouTube Shorts come last - they cannot be
     * downloaded at all, so they are watch-only reference.
     *
     * Relevance and popularity still order videos WITHIN each source.
     */
    const sourceRank: Record<string, number> = {
      facebook: 0,
      tiktok: 1,
      alibaba: 2,
      // Above YouTube because Bilibili clips ARE downloadable from this server
      // (verified 5/5 as real mp4s), so they are usable footage rather than
      // watch-only reference.
      bilibili: 3,
      youtube: 4,
    }

    /**
     * A PER-SOURCE quota, not one global cap.
     *
     * This is the bug that made the shop say "I used to get all four sources".
     * Sorting by source and THEN taking `slice(0, 48)` is a trap: TikTok returns
     * 47+ hits across six phrasings and sorts near the front, so it ate the
     * entire budget and 1688 + YouTube Shorts - which sort last by design - were
     * cut off the end of the array every single time. The sort order that makes
     * the grid readable was quietly deciding which sources existed at all.
     *
     * Quotas are per platform, so a flood on one source can no longer starve the
     * others. TikTok gets the largest share because it genuinely has the most
     * usable ad footage; the rare sources are small but GUARANTEED.
     */
    const SOURCE_QUOTA: Record<string, number> = {
      facebook: 10,
      tiktok: 22,
      alibaba: 10,
      bilibili: 12,
      youtube: 10,
    }

    const byRelevance = (a: SearchHit, b: SearchHit) => b.score - a.score || b.plays - a.plays
    const perSource = new Map<string, SearchHit[]>()
    for (const hit of pool) {
      const bucket = perSource.get(hit.platform)
      if (bucket) bucket.push(hit)
      else perSource.set(hit.platform, [hit])
    }

    const ranked = [...perSource.entries()]
      .sort(([a], [b]) => (sourceRank[a] ?? 9) - (sourceRank[b] ?? 9))
      .flatMap(([platform, hits]) => hits.sort(byRelevance).slice(0, SOURCE_QUOTA[platform] ?? 10))

    return NextResponse.json({
      success: true,
      label: vision.label,
      category: vision.category,
      names: vision.names,
      queries: vision.queries,
      // Returned so an opt-in Meta Reels search can reuse this vision pass
      // instead of paying for a second one.
      keywords,
      // No global slice here: the quotas above already bounded this, and a
      // second cap on a source-ordered array is exactly what starved 1688 and
      // YouTube Shorts before.
      results: ranked,
      counts: {
        tiktok: ranked.filter((r) => r.platform === 'tiktok').length,
        youtube: ranked.filter((r) => r.platform === 'youtube').length,
        alibaba: ranked.filter((r) => r.platform === 'alibaba').length,
        facebook: ranked.filter((r) => r.platform === 'facebook').length,
        bilibili: ranked.filter((r) => r.platform === 'bilibili').length,
      },
      // Same honesty rule as `listing` and `web`: when deep search ran and found
      // nothing, say whether it FAILED or genuinely came back empty. Also echo
      // the Chinese terms actually used, because an odd translation is the most
      // likely reason a deep search returns nothing useful.
      deep: deep ? { ran: true, videos: bili.videos.length, error: bili.error, terms: zhTerms } : null,
      // Why the supplier row is empty, when it is. Distinguishing "no credit" or
      // "photo could not be uploaded" from "this product has no listing video"
      // matters, because only one of those is worth retrying.
      listing: listing
        ? { matched: listing.matched, checked: listing.checked, videos: listing.videos.length, error: listing.error }
        : null,
      /**
       * Every product photo found on the way to those videos.
       *
       * As load-bearing as the clips: the reel editor burns a product photo onto
       * the video as an overlay, so the number of usable pictures decides how
       * many different ads this footage can make. One photo means one ad.
       *
       * Free - the paid detail calls that reveal the videos carry these
       * galleries with them, so harvesting them costs nothing extra.
       */
      photos: listing?.photos ?? [],
      // Same distinction for Facebook: engines that refused us are NOT evidence
      // that no reels exist, and the UI must not claim otherwise.
      web: web ? { found: web.hits.length, engines: web.enginesUsed, blockedEngines: web.blockedEngines } : null,
      // A partial failure is worth saying out loud: Shorts-only results are
      // findable but not downloadable, and the user should know why.
      partial: blockedReason || '',
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Image search failed'
    console.error('image-search error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
