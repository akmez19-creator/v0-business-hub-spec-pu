import { NextResponse } from 'next/server'
import { generateImage, generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_POSTER_MODEL,
  MODEL_BY_ID,
  POSTER_MODELS,
  buildPosterPrompt,
  posterAspectRatio,
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

/**
 * Generate with Gemini using Google directly rather than the AI Gateway.
 *
 * Gemini's image models are not `generateImage` models - they are ordinary
 * chat models that emit an image when asked for the IMAGE response modality,
 * so the picture arrives in `files` rather than as a return value.
 *
 * Going direct is deliberate: it bills the Google account instead of Gateway
 * credit, so Poster Studio keeps working when the Gateway balance is spent.
 */
async function generateWithGemini(
  modelId: string,
  prompt: string,
  imageBytes: Uint8Array,
  aspectRatio: string,
): Promise<{ dataUrl: string; warnings: string[] }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    throw new Error(
      'GOOGLE_AI_API_KEY is not set, so the Gemini models cannot be used. Pick a non-Gemini model, or add the key.',
    )
  }

  const google = createGoogleGenerativeAI({ apiKey })

  const result = await generateText({
    model: google(modelId),
    providerOptions: {
      google: {
        // Without IMAGE here the model replies with a written description of
        // the poster instead of the poster itself
        responseModalities: ['TEXT', 'IMAGE'],
        // Taller for packed sales sheets, standard 4:5 for a simple hero shot
        imageConfig: { aspectRatio },
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          // The real product photo, so this is an edit of the actual item
          // rather than an invention that merely resembles it
          { type: 'file', mediaType: 'image/jpeg', data: imageBytes },
        ],
      },
    ],
  })

  const file = result.files?.find((f) => f.mediaType?.startsWith('image/'))
  if (!file) {
    // Usually a safety refusal, where the model explains itself in text
    const said = result.text?.trim()
    throw new Error(
      said
        ? `Gemini returned no image. It said: ${said.slice(0, 200)}`
        : 'Gemini returned no image. Try rewording, or pick another model.',
    )
  }

  return {
    dataUrl: `data:${file.mediaType || 'image/png'};base64,${file.base64}`,
    warnings: [],
  }
}

/** Sniff the real format from magic bytes - OpenAI rejects a wrong MIME type. */
function sniffImageType(bytes: Uint8Array): { mime: string; ext: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mime: 'image/png', ext: 'png' }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return { mime: 'image/gif', ext: 'gif' }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

/**
 * Generate with OpenAI directly rather than through the AI Gateway.
 *
 * Billing is the reason: this bills the user's own OPENAI_API_KEY, so Poster
 * Studio keeps working when Gateway credit is spent and topping up is just a
 * matter of pasting in a fresh key.
 *
 * The images/edits endpoint is used rather than images/generations because the
 * poster must be built around the real product photo. `input_fidelity: high`
 * is what stops the model quietly redrawing the product into a lookalike.
 */
async function generateWithOpenAI(
  modelId: string,
  prompt: string,
  imageBytes: Uint8Array,
  aspectRatio: string,
): Promise<{ dataUrl: string; warnings: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set, so the ChatGPT models cannot be used. Add the key, or pick a Gemini model.',
    )
  }

  // gpt-image only offers square and two 2:3-ish rectangles, so both poster
  // shapes map onto the tall one
  const size = aspectRatio === '1:1' ? '1024x1024' : '1024x1536'
  const { mime, ext } = sniffImageType(imageBytes)

  const form = new FormData()
  form.append('model', modelId)
  form.append('prompt', prompt)
  form.append('size', size)
  form.append('quality', 'high')
  // Preserves the product's exact appearance instead of reinterpreting it.
  // Verified against the live API: gpt-image-1.5 accepts this, gpt-image-2
  // rejects the whole request with invalid_input_fidelity_model.
  if (modelId !== 'gpt-image-2') form.append('input_fidelity', 'high')
  form.append('image', new Blob([new Uint8Array(imageBytes)], { type: mime }), `product.${ext}`)

  const send = (body: FormData) =>
    fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(280_000),
    })

  let res = await send(form)
  let json = await res.json().catch(() => null)

  // Which models accept input_fidelity shifts as OpenAI ships new ones, and
  // that single optional flag failing should not cost the user a poster
  if (!res.ok && /input_fidelity/i.test(json?.error?.message || json?.error?.param || '')) {
    const retry = new FormData()
    for (const [k, v] of form.entries()) if (k !== 'input_fidelity') retry.append(k, v)
    res = await send(retry)
    json = await res.json().catch(() => null)
  }

  if (!res.ok) {
    const detail = json?.error?.message || `OpenAI returned ${res.status}`
    throw new Error(detail)
  }

  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image. Try rewording, or pick another model.')

  return { dataUrl: `data:image/png;base64,${b64}`, warnings: [] }
}

export async function POST(request: Request) {
  // Held outside the try so the catch can name the right billing account.
  // Blaming AI Gateway for a Google quota error sends the user to the wrong
  // dashboard entirely.
  let activeProvider: 'gateway' | 'google' | 'openai' = 'gateway'

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

    // Data URLs arrive already-decoded from an upload; everything else is a
    // remote marketplace photo that has to be fetched
    let imageBytes: Uint8Array
    if (sourceImage.startsWith('data:')) {
      const b64 = sourceImage.split(',')[1] || ''
      imageBytes = Uint8Array.from(Buffer.from(b64, 'base64'))
    } else {
      imageBytes = await loadSourceImage(sourceImage)
    }

    // Gemini bills Google directly and returns its image differently, so it
    // takes its own path rather than going through the Gateway
    let posterDataUrl: string
    let posterWarnings: string[]

    if (model.provider === 'google') {
      const out = await generateWithGemini(modelId, prompt, imageBytes, aspect)
      posterDataUrl = out.dataUrl
      posterWarnings = out.warnings
    } else if (model.provider === 'openai') {
      const out = await generateWithOpenAI(modelId, prompt, imageBytes, aspect)
      posterDataUrl = out.dataUrl
      posterWarnings = out.warnings
    } else {
      const { image, warnings } = await generateImage({
        model: modelId,
        // Passing the photo alongside the text is what makes this an EDIT of the
        // real product rather than a fresh invention that merely resembles it
        prompt: { text: prompt, images: [imageBytes] },
        aspectRatio: aspect,
      })
      posterDataUrl = `data:${image.mediaType || 'image/png'};base64,${image.base64}`
      posterWarnings = warnings?.map((w) => ('message' in w ? w.message : String(w.type))) ?? []
    }

    return NextResponse.json({
      success: true,
      model: modelId,
      modelLabel: model.label,
      // base64 straight back to the browser - posters are download-only, so
      // there is nothing to persist
      image: posterDataUrl,
      warnings: posterWarnings,
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Poster generation failed'
    console.error('poster-generate error:', raw)

    // Provider errors are opaque; translate the common ones into something
    // that tells the user what to actually do next
    let msg = raw
    if (/quota|billing|credit|insufficient|exceeded|rate.?limit|429/i.test(raw)) {
      if (activeProvider === 'google') {
        // Google reports "limit: 0" for image models on the free tier - the
        // allowance is zero rather than merely used up, so waiting will not
        // help and only enabling billing will
        msg = /limit: 0/i.test(raw)
          ? 'Your Google API key is on the free tier, which allows zero image generations. Enable billing on the key\u2019s Google Cloud project at aistudio.google.com/apikey to use Gemini, or pick a non-Gemini model.'
          : 'Google API quota reached for this model. Wait a minute and retry, or pick another model.'
      } else if (activeProvider === 'openai') {
        msg = /rate.?limit|429/i.test(raw)
          ? 'OpenAI rate limit hit. Wait a moment and retry, or pick another model.'
          : 'Your OpenAI account is out of credit. Top up at platform.openai.com/settings/organization/billing, paste a new OPENAI_API_KEY, or pick a Gemini model.'
      } else {
        msg = 'AI Gateway credit exhausted for this model. Try a Gemini model, which bills Google instead.'
      }
    } else if (/aspect|ratio|size/i.test(raw)) msg = `${raw} - try a different model.`
    else if (/api key|permission|unauthenticated|401|403/i.test(raw))
      msg =
        activeProvider === 'google'
          ? 'Google rejected the API key. Check GOOGLE_AI_API_KEY is valid and has the Generative Language API enabled.'
          : activeProvider === 'openai'
            ? 'OpenAI rejected the API key. Paste a current OPENAI_API_KEY into the project settings, or pick a Gemini model.'
            : raw
    else if (activeProvider === 'openai' && /must be verified|organization/i.test(raw))
      // gpt-image needs a verified org, and OpenAI's raw wording does not say where to go
      msg =
        'Your OpenAI organisation is not verified for image models. Verify it at platform.openai.com/settings/organization/general, or pick a Gemini model.'
    else if (/not found|unsupported|invalid model/i.test(raw)) msg = `${raw} - this model may not accept image input.`
    else if (/moderation|safety|policy/i.test(raw)) msg = 'The model refused this image or wording. Try rephrasing.'

    return NextResponse.json({ success: false, error: msg }, { status: 502 })
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
