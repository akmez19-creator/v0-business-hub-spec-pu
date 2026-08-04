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

export type PosterLayout = 'packed' | 'hero'

export type PosterFields = {
  productName: string
  priceNow: string
  priceWas: string
  currency: string
  features: string[]
  badges: string[]
  headline: string
  extra: string
  /** Small supporting line under the product name */
  tagline?: string
  /** Button text, e.g. "ORDER NOW!" */
  cta?: string
  /** Scarcity strip along the bottom */
  urgency?: string
  /** Add a row of in-use photos of the same product across the bottom */
  lifestyleShots?: boolean
  layout?: PosterLayout
}

/**
 * A packed sales sheet stacks far more vertically than a single hero shot, so
 * it gets a taller canvas. Squeezing eight zones into 4:5 is what forces a
 * model to start dropping them.
 */
export function posterAspectRatio(layout: PosterLayout | undefined): '3:4' | '4:5' {
  return layout === 'hero' ? '4:5' : '3:4'
}

/** Digits only, so "Rs 1,299" and "1299.00" both compare correctly. */
function parseMoney(v: string): number | null {
  const n = Number(String(v).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Work out the discount to advertise.
 *
 * Returns nothing unless the old price is genuinely higher than the new one.
 * The two price fields are easy to fill in the wrong order, and a struck-out
 * "was" price BELOW the asking price would render a poster that is both
 * nonsensical and misleading, so in that case the old price is dropped
 * entirely rather than shown.
 */
export function priceCheck(f: Pick<PosterFields, 'priceNow' | 'priceWas'>): {
  now: number | null
  was: number | null
  savings: number | null
  percent: number | null
  invertedPrices: boolean
} {
  const now = parseMoney(f.priceNow)
  const was = parseMoney(f.priceWas)
  const usable = now !== null && was !== null && was > now
  return {
    now,
    was,
    savings: usable ? Math.round(was! - now!) : null,
    percent: usable ? Math.round(((was! - now!) / was!) * 100) : null,
    invertedPrices: now !== null && was !== null && was <= now,
  }
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
  const layout: PosterLayout = f.layout ?? 'packed'
  const cur = f.currency || 'Rs'
  const { savings, percent } = priceCheck(f)
  const features = f.features.filter((x) => x.trim())
  const badges = f.badges.filter((x) => x.trim())

  // Only advertise an old price when it is actually higher than the new one
  const showWas = savings !== null
  const L: string[] = []

  L.push(
    layout === 'packed'
      ? 'Create a dense, professional retail promotional flyer in tall portrait format, in the style of a Facebook Marketplace / island e-commerce sales poster.'
      : 'Create a bold promotional poster in portrait format for social media.',
    '',
    'THE PRODUCT PHOTO:',
    'The supplied image is the EXACT product being sold. Cut it out cleanly from its background and place it in the layout. Reproduce it faithfully: identical shape, colour, material, texture and details. Do not redesign, restyle, recolour or substitute it.',
  )

  if (layout === 'packed') {
    L.push(
      '',
      'CRITICAL LAYOUT REQUIREMENT:',
      'This is an information-dense sales sheet, NOT a minimal poster. Every zone listed below must be present and filled. Use the FULL canvas edge to edge with no large empty background areas. Think of a printed supermarket promo leaflet: many stacked panels, each doing a job.',
      '',
      'ZONES, top to bottom:',
      '',
      '1. TOP-LEFT CORNER: the main headline inside an explosive red and yellow starburst badge, tilted slightly, with a thin ribbon banner beneath it reading "LIMITED TIME OFFER!".',
      '2. TOP-RIGHT CORNER: small stacked glossy badges for the delivery and service promises, each a rounded rectangle with a tiny icon (delivery van, plane, shield) and short bold uppercase text.',
      '3. UPPER CENTRE: the product name in very large heavy condensed uppercase black type, on a white or light panel so it stays readable.',
      '4. LEFT MIDDLE: the price block, the loudest element on the whole poster. A small "SPECIAL PROMO" cap label at the top, then the old price struck through with a red diagonal line, then the words "NOW ONLY", then the new price in gigantic bold white numerals inside a bright red rounded panel, then a small yellow starburst savings badge.',
      '5. RIGHT MIDDLE: the cut-out product photo, large, with a soft drop shadow, overlapping the price block slightly so the composition feels layered.',
      '6. MIDDLE-LOWER: a vertical list of feature rows. Each row is a small circular gold-rimmed icon on the left, then a short bold uppercase title, then one line of smaller grey supporting text under the title.',
    )

    if (f.lifestyleShots !== false) {
      L.push(
        '7. LOWER: a horizontal strip of three smaller rounded photographs showing the SAME product being used in three realistic everyday situations. Each photo has a small dark caption bar along its bottom edge with two or three words on it.',
      )
    }

    L.push(
      '8. BOTTOM BAR: a full-width dark strip containing the urgency line on the left in bold yellow and white type, and a large glossy orange rounded call-to-action button on the right with a shopping-cart icon.',
      '',
      'STYLE: vivid red, orange and yellow promotional palette on white and dark navy panels. Glossy 3D badges, starbursts, ribbons, confetti, strong drop shadows, thick black outlines on headline type. Heavy condensed uppercase sans-serif throughout. High saturation, high contrast, loud and commercial.',
    )
  } else {
    L.push(
      '',
      'STYLE: energetic retail sale flyer. Deep red and black background with gold and yellow highlights, starburst and confetti accents, glossy badges and ribbons, strong drop shadows. Heavy condensed uppercase sans-serif headlines. The product large and central.',
    )
  }

  L.push('', 'EXACT TEXT TO RENDER (copy these strings character for character):')
  if (f.headline.trim()) L.push(`- Headline badge: "${f.headline.trim()}"`)
  if (f.productName.trim()) L.push(`- Product name: "${f.productName.trim()}"`)
  if (f.tagline?.trim()) L.push(`- Small tagline under the product name: "${f.tagline.trim()}"`)

  if (f.priceNow.trim()) {
    L.push(
      '',
      'PRICE BLOCK (this must appear - it is the single most important part of the poster):',
      `- New price, gigantic: "${cur} ${f.priceNow.trim()}"`,
    )
    if (showWas) {
      L.push(
        `- Old price above it, smaller, struck through with a red line, labelled "WAS": "${cur} ${f.priceWas.trim()}"`,
        `- Savings badge: "YOU SAVE ${cur} ${savings}!"`,
      )
      if (percent !== null && percent >= 10) {
        L.push(`- A small round corner sticker reading "-${percent}%".`)
      }
    }
  }

  if (features.length) {
    L.push('', 'FEATURE ROWS (icon + title, in this order):')
    features.forEach((x) => L.push(`- "${x.trim()}"`))
  }

  if (badges.length) {
    L.push('', 'BADGES / RIBBONS:')
    badges.forEach((x) => L.push(`- "${x.trim()}"`))
  }

  if (layout === 'packed') {
    const cta = f.cta?.trim() || 'ORDER NOW!'
    const urgency = f.urgency?.trim() || "DON'T MISS OUT! STOCK IS LIMITED"
    L.push('', 'BOTTOM BAR:', `- Urgency text: "${urgency}"`, `- Button text: "${cta}"`)
  }

  if (f.extra.trim()) L.push('', `ALSO INCLUDE: ${f.extra.trim()}`)

  L.push(
    '',
    'RULES:',
    '- Render ONLY the text listed above. Do not invent extra words, prices, percentages, phone numbers, claims or placeholder text.',
    '- Spelling must be exact and every price digit must match exactly.',
    '- Do not omit any listed element, especially the price block.',
    '- All text must be large, high-contrast and legible on a phone screen.',
    '- No watermarks, no signatures, no stock-photo logos, no lorem ipsum.',
  )

  return L.join('\n')
}
