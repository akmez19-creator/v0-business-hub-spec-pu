import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_POSTER_MODEL,
  MODEL_BY_ID,
  POSTER_MODELS,
  buildPosterPrompt,
  posterAspectRatio,
  type PosterFields,
} from '@/lib/product-master/poster-models'
import {
  generatePosterImage,
  resolveImageBytes,
  translatePosterError,
  type PosterProvider,
} from '@/lib/product-master/poster-engine'

// Poster generation is slow - image models routinely take 30s+
export const maxDuration = 300

/**
 * Single-model poster generation.
 *
 * The provider handling (Gemini's file-based image responses, OpenAI's
 * images/edits endpoint, SVG unwrapping, error translation) now lives in
 * lib/product-master/poster-engine so the one-button generate-post flow shares
 * exactly the same behaviour instead of reimplementing it.
 */
export async function POST(request: Request) {
  // Held outside the try so the catch can name the right billing account.
  // Blaming AI Gateway for a Google quota error sends the user to the wrong
  // dashboard entirely.
  let activeProvider: PosterProvider = 'gateway'

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
    activeProvider = model.provider

    const fields: PosterFields = {
      productName: String(body?.productName || ''),
      priceNow: String(body?.priceNow || ''),
      priceWas: String(body?.priceWas || ''),
      currency: String(body?.currency || 'Rs'),
      features: Array.isArray(body?.features) ? body.features.map(String) : [],
      badges: Array.isArray(body?.badges) ? body.badges.map(String) : [],
      headline: String(body?.headline || ''),
      extra: String(body?.extra || ''),
      tagline: String(body?.tagline || ''),
      cta: String(body?.cta || ''),
      urgency: String(body?.urgency || ''),
      lifestyleShots: body?.lifestyleShots !== false,
      layout: body?.layout === 'hero' ? 'hero' : 'packed',
    }

    const sourceImage = String(body?.sourceImage || '').trim()
    if (!sourceImage) {
      return NextResponse.json({ success: false, error: 'Pick a product photo first' }, { status: 400 })
    }

    const prompt = buildPosterPrompt(fields)
    // A packed sales sheet needs a taller canvas than a single hero shot
    const aspect = posterAspectRatio(fields.layout)
    const imageBytes = await resolveImageBytes(sourceImage)

    const { dataUrl, warnings } = await generatePosterImage(model, prompt, imageBytes, aspect)

    return NextResponse.json({
      success: true,
      model: modelId,
      modelLabel: model.label,
      // base64 straight back to the browser - posters are download-only, so
      // there is nothing to persist
      image: dataUrl,
      warnings,
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Poster generation failed'
    console.error('poster-generate error:', raw)
    return NextResponse.json(
      { success: false, error: translatePosterError(raw, activeProvider) },
      { status: 502 },
    )
  }
}

// GET -> selectable models, so the UI keeps no second copy of the list
export async function GET() {
  return NextResponse.json({
    success: true,
    models: POSTER_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note, provider: m.provider })),
    defaultModel: DEFAULT_POSTER_MODEL,
  })
}
