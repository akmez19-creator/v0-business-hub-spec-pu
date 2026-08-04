import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { scoreClipRelevance } from '@/lib/product-master/clip-relevance'

export const maxDuration = 60

/** Frames are captured in the browser, so cap what we accept. */
const MAX_FRAMES = 6
/** ~500KB of base64 per frame is far more than a 384px JPEG needs. */
const MAX_FRAME_CHARS = 500_000

/** Accepts a bare base64 string or a full `data:image/jpeg;base64,...` URL. */
function decodeFrame(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'string' || !raw) return null
  if (raw.length > MAX_FRAME_CHARS) return null
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
  try {
    const buf = Buffer.from(base64, 'base64')
    return buf.length ? new Uint8Array(buf) : null
  } catch {
    return null
  }
}

// POST { frames: string[], productName } -> { relevance, showsProduct, reason }
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const productName = String(body?.productName || '').trim()
    if (!productName) {
      return NextResponse.json(
        { success: false, error: 'A product name is required to judge relevance' },
        { status: 400 },
      )
    }

    const incoming: unknown[] = Array.isArray(body?.frames) ? body.frames.slice(0, MAX_FRAMES) : []
    const frames = incoming.map(decodeFrame).filter((f): f is Uint8Array => f !== null)
    if (!frames.length) {
      return NextResponse.json(
        { success: false, error: 'No usable frames were sent' },
        { status: 400 },
      )
    }

    const verdict = await scoreClipRelevance(frames, productName)
    return NextResponse.json({ success: true, ...verdict })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not judge this clip'
    console.error('clip-relevance POST error:', msg)
    // 502 not 500: the usual cause is the upstream model being unavailable,
    // and the client treats this as "unknown" rather than "irrelevant".
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
