import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

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
  /** Title mentions Temu - a real marketplace demo of the product */
  temu?: boolean
}

const TEMU_RE = /\btemu\b/i

const abs = (u?: string | null) => {
  if (!u) return null
  return u.startsWith('http') ? u : `https://www.tikwm.com${u}`
}

type RawVideo = {
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

const toHit = (v: RawVideo): SearchHit => {
  const uid = v.author?.unique_id || ''
  const title = (v.title || 'Untitled').slice(0, 160)
  return {
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
    temu: TEMU_RE.test(title),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const STOP = new Set(['the', 'and', 'for', 'with', 'temu', 'new', 'pcs', 'set', 'pack'])

/** Meaningful words from the product name, used to judge title relevance. */
function productTerms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+m?$/.test(w)),
    ),
  ]
}

/** How much of the product wording a video title actually carries. */
function relevance(title: string, terms: string[]) {
  if (!terms.length) return 0
  const t = title.toLowerCase()
  return terms.reduce((n, term) => (t.includes(term) ? n + 1 : n), 0)
}

/** One keyword search against the short-video index. */
async function searchOnce(keywords: string, cursor = 0, count = 24) {
  const res = await fetch('https://www.tikwm.com/api/feed/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `keywords=${encodeURIComponent(keywords)}&count=${count}&cursor=${cursor}&HD=1`,
  })
  if (!res.ok) throw new Error('Search service unreachable')
  const json = (await res.json()) as {
    code: number
    msg?: string
    data?: { cursor?: number; hasMore?: boolean; videos?: RawVideo[] }
  }
  if (json.code !== 0 || !json.data) throw new Error(json.msg || 'No results')
  return json.data
}

// POST { query, cursor } -> TikTok keyword search.
// Uses the same provider that already powers the paste-a-link resolver, so
// results can be handed straight to /video-fetch for an HD, watermark-free
// download.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const query = String(body?.query || '').trim()
    const cursor = Number(body?.cursor || 0) || 0
    const source = String(body?.source || 'all')
    if (query.length < 2) {
      return NextResponse.json({ success: false, error: 'Type at least 2 characters' }, { status: 400 })
    }

    // Temu itself renders its listings through a signed internal API and ships
    // no playable video in its HTML, so it can't be scraped directly. What does
    // work is that Temu sellers and buyers post the same products as short
    // videos - so fan out over Temu-flavoured phrasings and keep those.
    if (source === 'temu') {
      const variants = [`temu ${query}`, `${query} temu haul`, `${query} temu review`]

      // The provider allows 1 request/second - firing these in parallel gets
      // two of the three rejected, so they run spaced out instead.
      const seen = new Set<string>()
      const merged: SearchHit[] = []
      for (let i = 0; i < variants.length; i++) {
        if (i) await sleep(1100)
        try {
          const data = await searchOnce(variants[i], cursor, 20)
          for (const v of data.videos || []) {
            if (!v.video_id || seen.has(String(v.video_id))) continue
            seen.add(String(v.video_id))
            merged.push(toHit(v))
          }
        } catch {
          // one phrasing failing shouldn't sink the whole search
        }
      }
      if (!merged.length) throw new Error('No Temu videos found for this product')

      // "Mentions Temu" alone is a terrible signal - it surfaces unrelated Temu
      // hauls. Rank on how much of the product wording the title actually
      // carries, and only use the Temu mention to break ties.
      const terms = productTerms(query)
      const scored = merged
        .map((hit) => ({ hit, rel: relevance(hit.title, terms) }))
        .sort((a, b) => b.rel - a.rel || Number(b.hit.temu) - Number(a.hit.temu) || b.hit.plays - a.hit.plays)

      // Drop the noise entirely when we have enough on-topic clips
      const onTopic = scored.filter((s) => s.rel > 0)
      const finalList = (onTopic.length >= 6 ? onTopic : scored).map((s) => s.hit)

      return NextResponse.json({
        success: true,
        source: 'temu',
        results: finalList.slice(0, 36),
        cursor: cursor + 20,
        hasMore: finalList.length >= 20,
      })
    }

    const data = await searchOnce(query, cursor, 24)
    const results: SearchHit[] = (data.videos || []).filter((v) => v.video_id).map(toHit)

    return NextResponse.json({
      success: true,
      source: 'all',
      results,
      cursor: data.cursor ?? cursor + results.length,
      hasMore: Boolean(data.hasMore),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed'
    console.error('video-search error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
