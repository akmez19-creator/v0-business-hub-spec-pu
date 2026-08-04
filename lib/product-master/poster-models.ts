/**
 * Image models offered by Poster Studio.
 *
 * All of these run through the Vercel AI Gateway, which is already connected,
 * so none of them needs a new API key. IDs were taken from the live gateway
 * model list rather than from memory - stale image model IDs are a common
 * source of silent 404s.
 */

export type PosterModel = {
  id: string
  label: string
  /** Honest summary of what this model is good and bad at */
  note: string
  /** Whether the model accepts a source photo to edit */
  supportsImageInput: boolean
}

export const POSTER_MODELS: PosterModel[] = [
  {
    id: 'openai/gpt-image-2',
    label: 'ChatGPT (GPT Image 2)',
    note: 'Closest to generating posters in ChatGPT. Best at readable text.',
    supportsImageInput: true,
  },
  {
    id: 'openai/gpt-image-1.5',
    label: 'ChatGPT (GPT Image 1.5)',
    note: 'Previous ChatGPT image model. Use if GPT Image 2 output looks off.',
    supportsImageInput: true,
  },
  {
    id: 'bytedance/seedream-5.0-pro',
    label: 'Seedream 5 Pro',
    note: 'Strong at bold promo layouts and keeping the product identical.',
    supportsImageInput: true,
  },
  {
    id: 'bytedance/seedream-4.5',
    label: 'Seedream 4.5',
    note: 'Cheaper Seedream. Good product fidelity, slightly weaker text.',
    supportsImageInput: true,
  },
  {
    id: 'bfl/flux-kontext-max',
    label: 'FLUX Kontext Max',
    note: 'Best at preserving your exact product photo. Weakest at dense text.',
    supportsImageInput: true,
  },
  {
    id: 'recraft/recraft-v4.1-pro',
    label: 'Recraft v4.1 Pro',
    note: 'Built for marketing posters and reliable typography.',
    supportsImageInput: true,
  },
]

export const DEFAULT_POSTER_MODEL = 'openai/gpt-image-2'

export const MODEL_BY_ID = new Map(POSTER_MODELS.map((m) => [m.id, m]))

export type PosterFields = {
  productName: string
  priceNow: string
  priceWas: string
  currency: string
  features: string[]
  badges: string[]
  headline: string
  extra: string
}

/**
 * Builds the poster instruction.
 *
 * The product photo is passed to the model separately as an image input; this
 * text tells it to treat that photo as the exact product rather than as loose
 * inspiration, which is the difference between an ad for your product and an ad
 * for something that merely resembles it.
 */
export function buildPosterPrompt(f: PosterFields): string {
  const lines: string[] = []

  lines.push(
    'Create a bold, high-converting e-commerce promotional poster in portrait 4:5 format for social media.',
    'The supplied image is the EXACT product being sold. Reproduce it faithfully - same shape, colour, material and details. Do not redesign, restyle or substitute it.',
  )

  lines.push(
    '',
    'STYLE: energetic retail sale flyer. Deep red and black background with gold and yellow highlights, starburst and confetti accents, glossy badges and ribbons, strong drop shadows. Heavy condensed uppercase sans-serif headlines. Clean, uncluttered composition with the product large and central.',
  )

  lines.push('', 'TEXT TO RENDER (spell every word exactly as written):')
  if (f.headline.trim()) lines.push(`- Main headline: "${f.headline.trim()}"`)
  if (f.productName.trim()) lines.push(`- Product name: "${f.productName.trim()}"`)

  if (f.priceNow.trim()) {
    lines.push(`- Current price, very large and prominent: "${f.currency} ${f.priceNow.trim()}"`)
    if (f.priceWas.trim()) {
      lines.push(
        `- Old price shown smaller with a red strike-through line: "${f.currency} ${f.priceWas.trim()}"`,
        '- Place the old price directly above the current price so the discount reads instantly.',
      )
    }
  }

  const features = f.features.filter((x) => x.trim())
  if (features.length) {
    lines.push('- Feature list down one side, each with a small circular icon:')
    features.forEach((x) => lines.push(`  * "${x.trim()}"`))
  }

  const badges = f.badges.filter((x) => x.trim())
  if (badges.length) {
    lines.push('- Corner badges / ribbons:')
    badges.forEach((x) => lines.push(`  * "${x.trim()}"`))
  }

  if (f.extra.trim()) lines.push(`- Also include: ${f.extra.trim()}`)

  lines.push(
    '',
    'RULES:',
    '- Render ONLY the text listed above. Do not invent extra words, prices, claims or lorem ipsum.',
    '- Spelling must be exact. Every price digit must match exactly.',
    '- All text must be large, high-contrast and legible on a phone screen.',
    '- No watermarks, no signatures, no stock-photo logos.',
  )

  return lines.join('\n')
}
