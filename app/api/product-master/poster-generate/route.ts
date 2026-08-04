import { NextResponse } from 'next/server'
import { generateImage } from 'ai'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_POSTER_MODEL,
  MODEL_BY_ID,
  POSTER_MODELS,
  buildPosterPrompt,
  type PosterFields,
} from '@/lib/product-master/poster-models'

// Poster generation is slow - image models routinely take 30s+
export const maxDuration = 300

/**
 * Fetch the source product photo and hand it to the model as raw bytes.
 *
 * Marketplace CDNs frequently refuse requests without a browser User-Agent, and
 * passing a URL the provider then fails to fetch produces a confusing
 * provider-side error. Fetching here means a bad image URL fails with a clear
 * message instead.
 */
/**
 * Pull the real photo out of an SVG wrapper.
 *
 * Over half of the product images in this catalogue are SVG files that do
 * nothing but wrap a single base64 JPEG/PNG in an <image> tag. Image models
 * reject SVG outright, so sending one through fails with an opaque provider
 * error. The embedded raster is the actual photo, so extract and use that.
 * Returns null when the SVG is genuine vector art with nothing to extract.
 */
function extractEmbeddedRaster(bytes: Uint8Array): Uint8Array | null {
  // Only look at the head - these files are mostly one huge base64 blob and
  // decoding the whole thing as text just to find the header wastes memory.
  const head = Buffer.from(bytes.slice(0, 4096)).toString('utf8')
  if (!head.includes('<svg')) return null

  const text = Buffer.from(bytes).toString('utf8')
  const m = text.match(/data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)/)
  if (!m) return null

  const b64 = m[2].replace(/\s/g, '')
  if (!b64) return null
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

async function loadSourceImage(src: string): Promise<Uint8Array> {
  const res = await fetch(src, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Could not load the product photo (${res.status})`)
  const type = res.headers.get('content-type') || ''
  if (type && !type.startsWith('image/')) throw new Error('That link is not an image')

  const bytes = new Uint8Array(await res.arrayBuffer())

  if (type.includes('svg') || src.toLowerCase().includes('.svg')) {
    const raster = extractEmbeddedRaster(bytes)
    if (raster) return raster
    throw new Error(
      'This product photo is a vector (SVG) image, which the AI models cannot read. Upload a JPG or PNG instead.',
    )
  }

  return bytes
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()

    const modelId = String(body?.model || DEFAULT_POSTER_MODEL)
    const model = MODEL_BY_ID.get(modelId)
    if (!model) return NextResponse.json({ success: false, error: 'Unknown model' }, { status: 400 })

    const fields: PosterFields = {
      productName: String(body?.productName || ''),
      priceNow: String(body?.priceNow || ''),
      priceWas: String(body?.priceWas || ''),
      currency: String(body?.currency || 'Rs'),
      features: Array.isArray(body?.features) ? body.features.map(String) : [],
      badges: Array.isArray(body?.badges) ? body.badges.map(String) : [],
      headline: String(body?.headline || ''),
      extra: String(body?.extra || ''),
    }

    const sourceImage = String(body?.sourceImage || '').trim()
    if (!sourceImage) {
      return NextResponse.json({ success: false, error: 'Pick a product photo first' }, { status: 400 })
    }

    const prompt = buildPosterPrompt(fields)

    // Data URLs arrive already-decoded from an upload; everything else is a
    // remote marketplace photo that has to be fetched
    let imageBytes: Uint8Array
    if (sourceImage.startsWith('data:')) {
      const b64 = sourceImage.split(',')[1] || ''
      imageBytes = Uint8Array.from(Buffer.from(b64, 'base64'))
    } else {
      imageBytes = await loadSourceImage(sourceImage)
    }

    const { image, warnings } = await generateImage({
      model: modelId,
      // Passing the photo alongside the text is what makes this an EDIT of the
      // real product rather than a fresh invention that merely resembles it
      prompt: { text: prompt, images: [imageBytes] },
      // 4:5 portrait is the standard feed format and matches the reference poster
      aspectRatio: '4:5',
    })

    return NextResponse.json({
      success: true,
      model: modelId,
      modelLabel: model.label,
      // base64 straight back to the browser - posters are download-only, so
      // there is nothing to persist
      image: `data:${image.mediaType || 'image/png'};base64,${image.base64}`,
      warnings: warnings?.map((w) => ('message' in w ? w.message : String(w.type))) ?? [],
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Poster generation failed'
    console.error('poster-generate error:', raw)

    // Provider errors are opaque; translate the common ones into something
    // that tells the user what to actually do next
    let msg = raw
    if (/aspect|ratio|size/i.test(raw)) msg = `${raw} - try a different model.`
    else if (/quota|billing|credit|insufficient/i.test(raw)) msg = 'AI Gateway credit exhausted for this model.'
    else if (/not found|unsupported|invalid model/i.test(raw)) msg = `${raw} - this model may not accept image input.`
    else if (/moderation|safety|policy/i.test(raw)) msg = 'The model refused this image or wording. Try rephrasing.'

    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}

// GET -> selectable models, so the UI keeps no second copy of the list
export async function GET() {
  return NextResponse.json({
    success: true,
    models: POSTER_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note })),
    defaultModel: DEFAULT_POSTER_MODEL,
  })
}
