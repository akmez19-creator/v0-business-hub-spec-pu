import { type NextRequest, NextResponse } from 'next/server'
import * as fal from '@fal-ai/serverless-client'

// Original background music for a reel, generated on demand.
//
// Meta Sound Collection cannot be browsed from here: it has no public API, it
// sits behind a business login, and its terms forbid third-party tools and
// using the audio anywhere outside Meta's own products. Stable Audio 3 is the
// closest thing that is actually embeddable - it is trained on fully licensed
// data and cleared for commercial use, and because each track is generated
// fresh there is no existing recording for anyone to claim.

fal.config({ credentials: process.env.FAL_KEY })

// Generation is slow enough to blow the default serverless window
export const maxDuration = 120

type FalAudio = {
  audio?: { url?: string; content_type?: string; file_name?: string }
  seed?: number
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Music generation is not configured' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const prompt = String(body?.prompt || '').slice(0, 400).trim()
    // Reels are short, and long renders are slow and rarely used in full
    const duration = Math.min(60, Math.max(10, Number(body?.duration) || 30))

    if (!prompt) {
      return NextResponse.json({ error: 'A style is required' }, { status: 400 })
    }

    const result = (await fal.subscribe('fal-ai/stable-audio-3/medium/text-to-audio', {
      input: {
        prompt,
        duration,
        output_format: 'mp3',
        // 128k keeps the inline response small; background music under a
        // voiceover gains nothing audible from a higher rate
        bitrate: '128k',
        // Returns the audio inline as a data URI, so there is no second
        // cross-origin fetch from the browser that CORS could block
        sync_mode: true,
      },
    })) as FalAudio

    const url = result?.audio?.url
    if (!url) {
      return NextResponse.json({ error: 'No audio came back. Try again.' }, { status: 502 })
    }

    // sync_mode should already hand back a data URI, but the API is free to
    // return a hosted URL instead - fetching it here keeps the browser on a
    // same-origin response either way
    if (url.startsWith('data:')) {
      return NextResponse.json({ success: true, audio: url })
    }

    const res = await fetch(url)
    if (!res.ok) {
      return NextResponse.json({ error: 'Could not download the generated track' }, { status: 502 })
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const mime = result.audio?.content_type || 'audio/mpeg'

    return NextResponse.json({
      success: true,
      audio: `data:${mime};base64,${buf.toString('base64')}`,
    })
  } catch (e) {
    console.log('[v0] generate-music failed:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Music generation failed' },
      { status: 500 },
    )
  }
}
