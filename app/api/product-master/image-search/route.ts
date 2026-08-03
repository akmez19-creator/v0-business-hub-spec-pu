import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

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
}

const abs = (u?: string | null) => {
  if (!u) return null
  return u.startsWith('http') ? u : `https://www.tikwm.com${u}`
}

// Vision pass with the same resilience pattern used by ai-post: try the AI
// Gateway first, fall back to Gemini directly so lens search never goes down.
async function describeImage(imageData: string | Uint8Array, hint: string) {
  const system =
    'You identify consumer products in photos for a Mauritius e-commerce shop, so the shop can find ' +
    'real short-form videos of the SAME kind of product to use in their reels. ' +
    'Look only at the product itself - ignore backgrounds, hands, watermarks and text overlays. ' +
    'Reply with STRICT JSON only, no markdown fence, in this exact shape:\n' +
    '{"label":"short product name","category":"broad category",' +
    '"queries":["4 to 6 short search phrases people would actually type on TikTok to find videos of this product"],' +
    '"keywords":["6 to 12 single lowercase words that must plausibly appear in a matching video title"]}\n' +
    'Queries must describe the PRODUCT and how it is used or demoed (e.g. "nylon rope strength test", ' +
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
      queries?: unknown
      keywords?: unknown
    }
    const list = (v: unknown, cap: number) =>
      Array.isArray(v)
        ? [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => x.length > 1))].slice(0, cap)
        : []
    return {
      label: String(o.label || '').slice(0, 80),
      category: String(o.category || '').slice(0, 60),
      queries: list(o.queries, 6),
      keywords: list(o.keywords, 12),
    }
  } catch {
    return null
  }
}

async function searchOne(query: string) {
  const res = await fetch('https://www.tikwm.com/api/feed/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `keywords=${encodeURIComponent(query)}&count=16&cursor=0&HD=1`,
  })
  if (!res.ok) return []
  const json = (await res.json()) as {
    code: number
    data?: {
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
  if (json.code !== 0 || !json.data?.videos) return []
  return json.data.videos
}

// POST { imageUrl | imageBase64, productName }
// "Lens" search: read the product photo, derive real search phrases from what
// is actually pictured, fan those out across the video index, then rank hits
// by how well their titles match the product. This is what stops a text
// search for "10M Hanging Rope" returning movie trailers.
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

    // Fan the derived phrases out in parallel and merge
    const batches = await Promise.all(
      vision.queries.map((q) => searchOne(q).catch(() => [])),
    )

    const keywords = vision.keywords.length > 0 ? vision.keywords : vision.label.toLowerCase().split(/\s+/)
    const seen = new Set<string>()
    const merged: SearchHit[] = []

    for (const videos of batches) {
      for (const v of videos) {
        if (!v.video_id || seen.has(String(v.video_id))) continue
        seen.add(String(v.video_id))
        const title = (v.title || 'Untitled').slice(0, 160)
        const lower = title.toLowerCase()
        const hits = keywords.filter((k) => lower.includes(k)).length
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
          score: hits,
        })
      }
    }

    // Relevance first, popularity as the tie-break. Drop the zero-match noise
    // only when there are enough genuine matches to fill the grid.
    const matched = merged.filter((m) => m.score > 0)
    const ranked = (matched.length >= 8 ? matched : merged).sort(
      (a, b) => b.score - a.score || b.plays - a.plays,
    )

    return NextResponse.json({
      success: true,
      label: vision.label,
      category: vision.category,
      queries: vision.queries,
      results: ranked.slice(0, 40),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Image search failed'
    console.error('image-search error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
