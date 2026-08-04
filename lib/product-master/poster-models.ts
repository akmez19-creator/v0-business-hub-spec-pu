/**
 * Image models offered by Poster Studio.
 *
 * Two different billing routes are represented here, which is the whole point
 * of the `provider` field:
 *
 * - 'gateway' models bill against Vercel AI Gateway credit.
 * - 'google' models call Google directly with GOOGLE_AI_API_KEY and bill
 *   against the Google account instead.
 *
 * Keeping both means an exhausted balance on one side does not take Poster
 * Studio down entirely - the other route is still available.
 *
 * IDs were taken from each provider's live model list rather than from memory;
 * stale image model IDs are a common source of silent 404s. The Gemini IDs
 * below were confirmed present on this project's key.
 */

export type PosterModel = {
  id: string
  label: string
  /** Honest summary of what this model is good and bad at */
  note: string
  /** Whether the model accepts a source photo to edit */
  supportsImageInput: boolean
  /** Which credit pool and code path this model uses */
  provider: 'gateway' | 'google'
}

export const POSTER_MODELS: PosterModel[] = [
  {
    id: 'gemini-3-pro-image',
    label: 'Gemini Nano Banana Pro',
    note: 'Google\u2019s best text renderer \u2014 the strongest choice for exact prices and spelling. Billed to Google, not AI Gateway.',
    supportsImageInput: true,
    provider: 'google',
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    note: 'Faster, cheaper Gemini. Good posters, slightly weaker dense text. Billed to Google.',
    supportsImageInput: true,
    provider: 'google',
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    note: 'Original Nano Banana. Cheapest Gemini option. Billed to Google.',
    supportsImageInput: true,
    provider: 'google',
  },
  {
    id: 'openai/gpt-image-2',
    label: 'ChatGPT (GPT Image 2)',
    note: 'Closest to generating posters in ChatGPT. Best at readable text.',
    supportsImageInput: true,
    provider: 'gateway',
  },
  {
    id: 'openai/gpt-image-1.5',
    label: 'ChatGPT (GPT Image 1.5)',
    note: 'Previous ChatGPT image model. Use if GPT Image 2 output looks off.',
    supportsImageInput: true,
    provider: 'gateway',
  },
  {
    id: 'bytedance/seedream-5.0-pro',
    label: 'Seedream 5 Pro',
    note: 'Strong at bold promo layouts and keeping the product identical.',
    supportsImageInput: true,
    provider: 'gateway',
  },
  {
    id: 'bytedance/seedream-4.5',
    label: 'Seedream 4.5',
    note: 'Cheaper Seedream. Good product fidelity, slightly weaker text.',
    supportsImageInput: true,
    provider: 'gateway',
  },
  {
    id: 'bfl/flux-kontext-max',
    label: 'FLUX Kontext Max',
    note: 'Best at preserving your exact product photo. Weakest at dense text.',
    supportsImageInput: true,
    provider: 'gateway',
  },
  {
    id: 'recraft/recraft-v4.1-pro',
    label: 'Recraft v4.1 Pro',
    note: 'Built for marketing posters and reliable typography.',
    supportsImageInput: true,
    provider: 'gateway',
  },
]

/**
 * Nano Banana Pro leads because poster text accuracy is the thing users
 * actually complain about, and it is the best of these at rendering exact
 * prices and spelling.
 */
export const DEFAULT_POSTER_MODEL = 'gemini-3-pro-image'

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
