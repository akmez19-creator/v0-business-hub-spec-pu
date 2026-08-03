import { type NextRequest, NextResponse } from 'next/server'
import * as fal from '@fal-ai/serverless-client'

// AI background removal (BiRefNet matting) - replaces the old in-browser
// flood-fill which produced rough, Canva-inferior cutouts on textured or
// dark backgrounds. Accepts a data URL or http(s) URL, returns a PNG data
// URL with true alpha so the client can draw it on canvas without CORS.

fal.config({ credentials: process.env.FAL_KEY })

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json()
    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'image (URL or data URL) is required' }, { status: 400 })
    }

    const result = (await fal.subscribe('fal-ai/birefnet/v2', {
      input: {
        image_url: image,
        model: 'General Use (Heavy)',
        operating_resolution: '1024x1024',
        output_format: 'png',
        refine_foreground: true,
      },
    })) as { image?: { url?: string } }

    const outUrl = result.image?.url
    if (!outUrl) throw new Error('No image returned by the model')

    // Re-serve as a data URL so the canvas pipeline never hits CORS issues
    const res = await fetch(outUrl)
    if (!res.ok) throw new Error(`Could not download result (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    return NextResponse.json({ dataUrl: `data:image/png;base64,${buf.toString('base64')}` })
  } catch (error) {
    console.error('remove-bg failed:', error)
    return NextResponse.json({ error: 'Background removal failed' }, { status: 502 })
  }
}
