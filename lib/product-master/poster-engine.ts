/**
 * Poster image generation, extracted from app/api/product-master/poster-generate
 * so the one-button "generate post" flow can reuse it instead of growing a
 * second, subtly-different copy of the same provider handling.
 *
 * All of the awkward provider knowledge lives here: Gemini returning images as
 * files rather than return values, OpenAI's per-model input_fidelity support,
 * SVG-wrapped product photos, and the error translation that turns opaque
 * provider failures into something a user can act on.
 */

import { generateImage, generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { MODEL_BY_ID, type PosterModel } from './poster-models'

export type PosterProvider = 'gateway' | 'google' | 'openai'

/**
 * Pull the real photo out of an SVG wrapper.
 *
 * Over half of the product images in this catalogue are SVG files that do
 * nothing but wrap a single base64 JPEG/PNG in an <image> tag. Image models
 * reject SVG outright, so sending one through fails with an opaque provider
 * error. The embedded raster is the actual photo, so extract and use that.
 * Returns null when the SVG is genuine vector art with nothing to extract.
 */
export function extractEmbeddedRaster(bytes: Uint8Array): Uint8Array | null {
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

/**
 * Fetch the source product photo and hand it to the model as raw bytes.
 *
 * Marketplace CDNs frequently refuse requests without a browser User-Agent, and
 * passing a URL the provider then fails to fetch produces a confusing
 * provider-side error. Fetching here means a bad image URL fails clearly.
 */
export async function loadSourceImage(src: string): Promise<Uint8Array> {
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

/** Turn a data URL or remote URL into bytes. */
export async function resolveImageBytes(sourceImage: string): Promise<Uint8Array> {
  if (sourceImage.startsWith('data:')) {
    const b64 = sourceImage.split(',')[1] || ''
    return Uint8Array.from(Buffer.from(b64, 'base64'))
  }
  return loadSourceImage(sourceImage)
}

/** Sniff the real format from magic bytes - OpenAI rejects a wrong MIME type. */
export function sniffImageType(bytes: Uint8Array): { mime: string; ext: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mime: 'image/png', ext: 'png' }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return { mime: 'image/gif', ext: 'gif' }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return { mime: 'image/webp', ext: 'webp' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

/**
 * Generate with Gemini using Google directly rather than the AI Gateway.
 *
 * Gemini's image models are not `generateImage` models - they are ordinary
 * chat models that emit an image when asked for the IMAGE response modality,
 * so the picture arrives in `files` rather than as a return value.
 */
export async function generateWithGemini(
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
        imageConfig: { aspectRatio },
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
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

/**
 * Generate with OpenAI directly rather than through the AI Gateway.
 *
 * The images/edits endpoint is used rather than images/generations because the
 * poster must be built around the real product photo. `input_fidelity: high`
 * is what stops the model quietly redrawing the product into a lookalike.
 */
export async function generateWithOpenAI(
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
    throw new Error(json?.error?.message || `OpenAI returned ${res.status}`)
  }

  const b64 = json?.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no image. Try rewording, or pick another model.')

  return { dataUrl: `data:image/png;base64,${b64}`, warnings: [] }
}

/** Dispatch to the right provider for the chosen model. */
export async function generatePosterImage(
  model: PosterModel,
  prompt: string,
  imageBytes: Uint8Array,
  aspect: string,
): Promise<{ dataUrl: string; warnings: string[] }> {
  if (model.provider === 'google') return generateWithGemini(model.id, prompt, imageBytes, aspect)
  if (model.provider === 'openai') return generateWithOpenAI(model.id, prompt, imageBytes, aspect)

  const { image, warnings } = await generateImage({
    model: model.id,
    prompt: { text: prompt, images: [imageBytes] },
    aspectRatio: aspect as `${number}:${number}`,
  })
  return {
    dataUrl: `data:${image.mediaType || 'image/png'};base64,${image.base64}`,
    warnings: warnings?.map((w) => ('message' in w ? w.message : String(w.type))) ?? [],
  }
}

/**
 * Translate an opaque provider error into something that tells the user what
 * to actually do next, naming the correct billing account.
 */
export function translatePosterError(raw: string, activeProvider: PosterProvider): string {
  if (/quota|billing|credit|insufficient|exceeded|rate.?limit|429/i.test(raw)) {
    if (activeProvider === 'google') {
      // Google reports "limit: 0" for image models on the free tier - the
      // allowance is zero rather than merely used up, so waiting will not help
      return /limit: 0/i.test(raw)
        ? 'Your Google API key is on the free tier, which allows zero image generations. Enable billing on the key\u2019s Google Cloud project at aistudio.google.com/apikey to use Gemini, or pick a non-Gemini model.'
        : 'Google API quota reached for this model. Wait a minute and retry, or pick another model.'
    }
    if (activeProvider === 'openai') {
      return /rate.?limit|429/i.test(raw)
        ? 'OpenAI rate limit hit. Wait a moment and retry, or pick another model.'
        : 'Your OpenAI account is out of credit. Top up at platform.openai.com/settings/organization/billing, paste a new OPENAI_API_KEY, or pick a Gemini model.'
    }
    return 'AI Gateway credit exhausted for this model. Try a Gemini model, which bills Google instead.'
  }
  if (/aspect|ratio|size/i.test(raw)) return `${raw} - try a different model.`
  if (/api key|permission|unauthenticated|401|403/i.test(raw)) {
    if (activeProvider === 'google')
      return 'Google rejected the API key. Check GOOGLE_AI_API_KEY is valid and has the Generative Language API enabled.'
    if (activeProvider === 'openai')
      return 'OpenAI rejected the API key. Paste a current OPENAI_API_KEY into the project settings, or pick a Gemini model.'
    return raw
  }
  if (activeProvider === 'openai' && /must be verified|organization/i.test(raw))
    return 'Your OpenAI organisation is not verified for image models. Verify it at platform.openai.com/settings/organization/general, or pick a Gemini model.'
  if (/not found|unsupported|invalid model/i.test(raw)) return `${raw} - this model may not accept image input.`
  if (/moderation|safety|policy/i.test(raw)) return 'The model refused this image or wording. Try rephrasing.'
  return raw
}

/** Default image model per side of the Gemini-vs-ChatGPT comparison. */
export const GEMINI_POSTER_MODEL = 'gemini-3-pro-image'
export const OPENAI_POSTER_MODEL = 'gpt-image-2'

export function posterModelOrThrow(id: string): PosterModel {
  const m = MODEL_BY_ID.get(id)
  if (!m) throw new Error(`Unknown poster model: ${id}`)
  return m
}
