import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  PLATFORM_BY_ID,
  PLATFORMS,
  TMAPI_BASE,
  apiError,
  attachVideos,
  convertImageUrl,
  extractList,
  isAlibabaHosted,
  normalizeHit,
  type MarketplaceHit,
  type MarketplaceId,
  type MarketplacePlatform,
} from '@/lib/product-master/tmapi'

export const maxDuration = 60

/**
 * Ceiling on reference photos per search.
 *
 * Each one is its own paid search, and measured overlap between photos of the
 * same product is high (15-20 of 20 results repeat), so a fourth photo buys
 * almost no new listings for a full extra call.
 */
const MAX_REFERENCE_IMAGES = 3

/** Per-platform outcome, so the UI can say which source failed and why. */
type PlatformResult = {
  id: MarketplaceId
  label: string
  count: number
  error: string | null
}

async function searchPlatform(
  platform: MarketplacePlatform,
  keyword: string,
  page: number,
  token: string,
  imageRef?: string | null,
): Promise<{ hits: MarketplaceHit[]; error: string | null }> {
  // Image mode swaps both the path and the query param - everything after the
  // request (unwrapping, normalising, error handling) is identical.
  const byImage = Boolean(imageRef)
  if (byImage && !platform.imagePath) {
    return { hits: [], error: `${platform.label} has no image search` }
  }

  const path = byImage ? (platform.imagePath as string) : platform.path
  const qs = new URLSearchParams(
    byImage
      ? { img_url: imageRef as string, page: String(page), apiToken: token }
      : { keyword, page: String(page), apiToken: token },
  )
  for (const [k, v] of Object.entries(platform.extraParams ?? {})) qs.set(k, v)
  try {
    // A slow marketplace must not hold up the whole fan-out. Without this the
    // route would sit until the platform gave up and the user would watch a
    // spinner with no idea which source was stalling.
    const res = await fetch(`${TMAPI_BASE}${path}?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    })

    if (!res.ok) {
      // 404 almost certainly means the path in PLATFORMS is wrong rather than
      // the search being empty, so say so instead of "no results"
      if (res.status === 404) return { hits: [], error: 'Endpoint not found - path may need correcting' }
      if (res.status === 401 || res.status === 403) return { hits: [], error: 'Token rejected' }
      if (res.status === 429) return { hits: [], error: 'Rate limited' }
      // 439 is TMAPI's own non-standard "out of credit" status. Reporting it
      // as a raw number tells the user nothing actionable, and the cause is
      // billing rather than anything wrong with the app.
      if (res.status === 439) return { hits: [], error: 'No API credit for this marketplace' }
      return { hits: [], error: `HTTP ${res.status}` }
    }

    const json = await res.json().catch(() => null)
    if (!json) return { hits: [], error: 'Bad response' }

    const failed = apiError(json)
    if (failed) return { hits: [], error: failed }

    const hits = extractList(json)
      .map((raw) => normalizeHit(raw, platform))
      .filter((h): h is MarketplaceHit => h !== null)

    return { hits, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Request failed'
    return { hits: [], error: /timeout|abort/i.test(msg) ? 'Timed out' : msg }
  }
}

// POST { query, platforms[], page, videoOnly } -> marketplace listings.
// Each platform is a separate paid TMAPI call, so only the platforms the user
// ticked are queried.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.TMAPI_TOKEN
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'TMAPI_TOKEN is not set. Add it in project settings.' },
        { status: 503 },
      )
    }

    const body = await request.json()
    const query = String(body?.query || '').trim()
    const page = Math.max(1, Number(body?.page || 1) || 1)
    const videoOnly = Boolean(body?.videoOnly)
    // imageUrls (plural) is the "propose several photos" flow: each selected
    // reference photo is searched and the results merged. imageUrl stays
    // supported so the single-photo path keeps working unchanged.
    const rawImages: string[] = Array.isArray(body?.imageUrls)
      ? (body.imageUrls as unknown[]).map((u) => String(u || '').trim()).filter(Boolean)
      : []
    const single = String(body?.imageUrl || '').trim()
    // Capped because every reference photo is its own paid search
    const imageUrls = [...new Set(rawImages.length ? rawImages : single ? [single] : [])].slice(0, MAX_REFERENCE_IMAGES)
    const byImage = imageUrls.length > 0

    if (!byImage && query.length < 2) {
      return NextResponse.json({ success: false, error: 'Type at least 2 characters' }, { status: 400 })
    }

    const requested = Array.isArray(body?.platforms) ? (body.platforms as string[]) : []
    const selected = requested
      .map((id) => PLATFORM_BY_ID.get(id as MarketplaceId))
      .filter((p): p is MarketplacePlatform => Boolean(p))

    if (!selected.length) {
      return NextResponse.json({ success: false, error: 'Pick at least one marketplace' }, { status: 400 })
    }

    // Image search needs an Alibaba-hosted image. Resolve every reference photo
    // up front so a conversion is never repeated per marketplace.
    let imageRefs: string[] = []
    if (byImage) {
      const capable = selected.filter((p) => p.imagePath && p.convertPath)
      if (!capable.length) {
        return NextResponse.json(
          { success: false, error: 'Image search is only available on 1688. Tick it to search by photo.' },
          { status: 400 },
        )
      }

      const resolved = await Promise.all(
        imageUrls.map(async (src) => {
          // A listing photo is already on alicdn and the search takes it as-is,
          // so skipping the upload halves the cost of every refine search.
          if (isAlibabaHosted(src)) return { url: src, error: null }
          return convertImageUrl(capable[0], src, token)
        }),
      )

      imageRefs = resolved.map((r) => r.url).filter((u): u is string => Boolean(u))
      if (!imageRefs.length) {
        return NextResponse.json(
          { success: false, error: resolved[0]?.error || 'Could not prepare that image' },
          { status: 502 },
        )
      }
    }

    // Fan out in parallel: these are independent vendors, so one being slow or
    // down should cost us nothing on the others. With several reference photos
    // every (marketplace x photo) pair is one search, and they are independent
    // in exactly the same way.
    const jobs = byImage
      ? selected.flatMap((p) => imageRefs.map((ref) => ({ platform: p, ref })))
      : selected.map((p) => ({ platform: p, ref: null as string | null }))

    const jobResults = await Promise.all(
      jobs.map((jb) => searchPlatform(jb.platform, query, page, token, jb.ref)),
    )

    // Collapse the per-photo jobs back down to one row per marketplace, so the
    // status line still reads "1688: 24" rather than the same source repeated
    const settled = selected.map((p) => {
      const mine = jobs.map((jb, i) => ({ jb, r: jobResults[i] })).filter((x) => x.jb.platform.id === p.id)
      const hits: MarketplaceHit[] = []
      const seenIds = new Set<string>()
      for (const { r } of mine) {
        for (const hit of r.hits) {
          if (seenIds.has(hit.id)) continue
          seenIds.add(hit.id)
          hits.push(hit)
        }
      }
      // Only a total failure is worth reporting - one photo of several finding
      // nothing is normal and must not look like an outage
      const error = mine.every((x) => x.r.error) ? mine[0]?.r.error ?? null : null
      return { hits, error }
    })

    const platformResults: PlatformResult[] = selected.map((p, i) => ({
      id: p.id,
      label: p.label,
      count: settled[i].hits.length,
      error: settled[i].error,
    }))

    // Interleave rather than concatenate, so the first screen shows a spread of
    // marketplaces instead of 40 AliExpress rows before any Shopee appears.
    const lists = settled.map((s) => s.hits)
    const merged: MarketplaceHit[] = []
    const seen = new Set<string>()
    const longest = Math.max(0, ...lists.map((l) => l.length))
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const hit = list[i]
        if (!hit || seen.has(hit.id)) continue
        seen.add(hit.id)
        merged.push(hit)
      }
    }

    // Listing videos live on the item-detail record, never on the search
    // response, so "video only" can only be honoured after enriching. Each
    // lookup is a paid call, so this runs only when the filter is actually on.
    const enriched = videoOnly ? await attachVideos(merged, token) : merged

    const results = videoOnly ? enriched.filter((h) => h.video) : enriched
    const withVideo = enriched.filter((h) => h.video).length

    // Every source failing is an outage worth surfacing, not an empty result
    const allFailed = platformResults.every((p) => p.error)
    if (allFailed) {
      const first = platformResults.find((p) => p.error)?.error || 'All marketplaces failed'
      return NextResponse.json(
        { success: false, error: first, platforms: platformResults },
        { status: 502 },
      )
    }

    // Photos of the same product taken from the listings themselves. These are
    // the "several images" offered back to the user to refine with: they cost
    // nothing extra here, and because they are alicdn-hosted, searching one
    // later skips the conversion call entirely.
    const usedRefs = new Set(imageUrls)
    const candidateImages = [
      ...new Set(enriched.flatMap((h) => (h.image ? [h.image] : [])).filter((u) => !usedRefs.has(u))),
    ].slice(0, 12)

    return NextResponse.json({
      success: true,
      results,
      platforms: platformResults,
      withVideo,
      // Distinguishes "we checked and found none" from "we never looked",
      // which is what made the old "0 with video" line misleading
      videoChecked: videoOnly,
      candidateImages,
      referenceImages: imageUrls,
      page,
      // Any platform filling its page suggests there is more behind it
      hasMore: settled.some((s) => s.hits.length >= 10),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed'
    console.error('marketplace-search error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}

// GET -> the platform list, so the UI never hardcodes a second copy of it
export async function GET() {
  return NextResponse.json({
    success: true,
    // imageSearch/video let the UI disable controls a marketplace cannot honour
    // instead of offering them and failing after the user has paid for a call
    platforms: PLATFORMS.map((p) => ({
      id: p.id,
      label: p.label,
      note: p.note,
      imageSearch: Boolean(p.imagePath && p.convertPath),
      video: Boolean(p.detailPath),
    })),
    configured: Boolean(process.env.TMAPI_TOKEN),
  })
}
