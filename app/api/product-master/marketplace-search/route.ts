import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  PLATFORM_BY_ID,
  PLATFORMS,
  TMAPI_BASE,
  apiError,
  extractList,
  normalizeHit,
  type MarketplaceHit,
  type MarketplaceId,
  type MarketplacePlatform,
} from '@/lib/product-master/tmapi'

export const maxDuration = 60

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
): Promise<{ hits: MarketplaceHit[]; error: string | null }> {
  const qs = new URLSearchParams({ keyword, page: String(page), apiToken: token })
  for (const [k, v] of Object.entries(platform.extraParams ?? {})) qs.set(k, v)
  try {
    // A slow marketplace must not hold up the whole fan-out. Without this the
    // route would sit until the platform gave up and the user would watch a
    // spinner with no idea which source was stalling.
    const res = await fetch(`${TMAPI_BASE}${platform.path}?${qs}`, {
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

    if (query.length < 2) {
      return NextResponse.json({ success: false, error: 'Type at least 2 characters' }, { status: 400 })
    }

    const requested = Array.isArray(body?.platforms) ? (body.platforms as string[]) : []
    const selected = requested
      .map((id) => PLATFORM_BY_ID.get(id as MarketplaceId))
      .filter((p): p is MarketplacePlatform => Boolean(p))

    if (!selected.length) {
      return NextResponse.json({ success: false, error: 'Pick at least one marketplace' }, { status: 400 })
    }

    // Fan out in parallel: these are independent vendors, so one being slow or
    // down should cost us nothing on the others.
    const settled = await Promise.all(selected.map((p) => searchPlatform(p, query, page, token)))

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

    const results = videoOnly ? merged.filter((h) => h.video) : merged
    const withVideo = merged.filter((h) => h.video).length

    // Every source failing is an outage worth surfacing, not an empty result
    const allFailed = platformResults.every((p) => p.error)
    if (allFailed) {
      const first = platformResults.find((p) => p.error)?.error || 'All marketplaces failed'
      return NextResponse.json(
        { success: false, error: first, platforms: platformResults },
        { status: 502 },
      )
    }

    return NextResponse.json({
      success: true,
      results,
      platforms: platformResults,
      withVideo,
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
    platforms: PLATFORMS.map((p) => ({ id: p.id, label: p.label, note: p.note })),
    configured: Boolean(process.env.TMAPI_TOKEN),
  })
}
