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
}

const abs = (u?: string | null) => {
  if (!u) return null
  return u.startsWith('http') ? u : `https://www.tikwm.com${u}`
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
    if (query.length < 2) {
      return NextResponse.json({ success: false, error: 'Type at least 2 characters' }, { status: 400 })
    }

    const res = await fetch('https://www.tikwm.com/api/feed/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: `keywords=${encodeURIComponent(query)}&count=24&cursor=${cursor}&HD=1`,
    })
    if (!res.ok) throw new Error('Search service unreachable')

    const json = (await res.json()) as {
      code: number
      msg?: string
      data?: {
        cursor?: number
        hasMore?: boolean
        videos?: Array<{
          video_id?: string
          title?: string
          cover?: string
          origin_cover?: string
          play?: string
          duration?: number
          play_count?: number
          digg_count?: number
          author?: { nickname?: string; unique_id?: string }
        }>
      }
    }
    if (json.code !== 0 || !json.data) throw new Error(json.msg || 'No results')

    const results: SearchHit[] = (json.data.videos || [])
      .filter((v) => v.video_id)
      .map((v) => {
        const uid = v.author?.unique_id || ''
        return {
          id: String(v.video_id),
          title: (v.title || 'Untitled').slice(0, 160),
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
        }
      })

    return NextResponse.json({
      success: true,
      results,
      cursor: json.data.cursor ?? cursor + results.length,
      hasMore: Boolean(json.data.hasMore),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Search failed'
    console.error('video-search error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
