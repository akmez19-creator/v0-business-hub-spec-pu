import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildPosterPrompt, posterAspectRatio, type PosterFields } from '@/lib/product-master/poster-models'
import {
  GEMINI_POSTER_MODEL,
  OPENAI_POSTER_MODEL,
  generatePosterImage,
  posterModelOrThrow,
  resolveImageBytes,
  translatePosterError,
} from '@/lib/product-master/poster-engine'

// Two posters plus two captions, all in one request
export const maxDuration = 300

/**
 * One button -> a complete, ready-to-publish post.
 *
 * Produces the poster AND its description, and does it twice: once entirely
 * through Gemini, once entirely through ChatGPT. Both complete options come
 * back so the user picks the better one rather than being handed whichever
 * provider happened to be wired in.
 *
 * The four generations run in PARALLEL. Run sequentially this would be four
 * slow image/text calls back to back; in parallel the request costs roughly the
 * slowest single call.
 *
 * Each side is settled independently: if ChatGPT is out of credit but Gemini
 * works, the Gemini option is still returned rather than the whole request
 * failing. A half-broken result is far more useful than an error page.
 */

const COPY_SYSTEM =
  'You are a top-tier social commerce copywriter for a Mauritius-based delivery e-commerce brand selling household gadgets. ' +
  'Prices are in Mauritian Rupees written like "Rs 675". Delivery is offered across the island, cash on delivery. ' +
  'Your captions are DETAILED and BEAUTIFUL - never thin or generic. Every post must:\n' +
  '- Open with a scroll-stopping hook that names the deal or the dream outcome\n' +
  '- Sell with 4-6 benefit lines, each starting with a fitting emoji as a bullet, each line a concrete benefit or use case\n' +
  '- Include a highlighted price line and a delivery line ("Fast delivery all over Mauritius")\n' +
  '- Add one urgency or trust line when stock info is available\n' +
  '- Close with a warm, clear call to action to order via inbox or WhatsApp\n' +
  'OUTPUT FORMAT - follow exactly, it is parsed by the UI:\n' +
  'HOOK: <one attention line with 1-2 emojis>\n' +
  'BODY: <4-6 emoji-bulleted benefit lines, then the price line, delivery line, and urgency/trust line>\n' +
  'CTA: <one warm action line>\n' +
  'HASHTAGS: <6-10 hashtags space separated>\n' +
  'Plain text only, no markdown. Never invent a price, discount or offer that is not given to you.'

/** Parse the labelled sections, tolerating a model that skips the labels. */
export function parsePostCopy(text: string) {
  const section = (label: string) => {
    const m = text.match(
      new RegExp(`\\*{0,2}${label}\\*{0,2}:\\s*([\\s\\S]*?)(?=\\n\\*{0,2}(?:HOOK|BODY|CTA|HASHTAGS)\\*{0,2}:|$)`, 'i'),
    )
    return m ? m[1].trim() : ''
  }
  const post = {
    hook: section('HOOK'),
    body: section('BODY'),
    cta: section('CTA'),
    hashtags: section('HASHTAGS'),
    raw: text.trim(),
  }
  if (!post.hook && !post.body && !post.cta && !post.hashtags) {
    // No labels found: first line is the hook, trailing hashtag lines are the
    // hashtags, everything between is the body
    const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
    const isTags = (l: string) => l.startsWith('#') || /^(#\S+\s*)+$/.test(l)
    let tagStart = lines.length
    while (tagStart > 1 && isTags(lines[tagStart - 1])) tagStart--
    post.hook = lines[0] ?? ''
    post.body = lines.slice(1, tagStart).join('\n')
    post.hashtags = lines.slice(tagStart).join(' ')
  }
  return post
}

async function geminiCopy(system: string, prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({ model: google('gemini-2.5-flash'), system, prompt })
  return text
}

async function openaiCopy(system: string, prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI returned ${res.status}`)
  const text = json?.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI returned no caption')
  return String(text)
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const productId: string = String(body?.productId || '')
    let productName: string = String(body?.productName || '').slice(0, 200)
    let priceNow: string = String(body?.priceNow || '')
    const sourceImage = String(body?.sourceImage || '').trim()
    const tone: string = ['energetic', 'friendly', 'professional', 'funny'].includes(body?.tone)
      ? body.tone
      : 'energetic'
    const language: string = ['en', 'fr', 'kreol_mix'].includes(body?.language) ? body.language : 'en'
    const extra: string = String(body?.extra || '').slice(0, 500)

    // ── Ground the copy in the real inventory record ──
    let inventoryFacts = ''
    if (productId) {
      const admin = createAdminClient()
      const { data: p } = await admin
        .from('products')
        .select('name, description, price, quantity, category, sold_out')
        .eq('id', productId)
        .single()
      if (p) {
        productName = productName || p.name
        if (!priceNow && p.price != null) priceNow = String(p.price)
        const facts: string[] = []
        if (p.category) facts.push(`Category: ${p.category}`)
        if (p.description) facts.push(`Inventory description: ${String(p.description).slice(0, 600)}`)
        if ((p.quantity ?? 0) > 0) facts.push(`In stock: ${p.quantity} units available now`)
        if (p.sold_out) facts.push('MARKED SOLD OUT - write a waitlist/back-soon angle')
        inventoryFacts = facts.join('\n')
      }
    }

    if (!productName) {
      return NextResponse.json({ success: false, error: 'productName is required' }, { status: 400 })
    }
    if (!sourceImage) {
      return NextResponse.json({ success: false, error: 'Pick a product photo first' }, { status: 400 })
    }

    const fields: PosterFields = {
      productName,
      priceNow,
      priceWas: String(body?.priceWas || ''),
      currency: String(body?.currency || 'Rs'),
      features: Array.isArray(body?.features) ? body.features.map(String) : [],
      badges: Array.isArray(body?.badges) ? body.badges.map(String) : [],
      headline: String(body?.headline || ''),
      extra,
      tagline: String(body?.tagline || ''),
      cta: String(body?.cta || ''),
      urgency: String(body?.urgency || ''),
      lifestyleShots: body?.lifestyleShots !== false,
      layout: body?.layout === 'hero' ? 'hero' : 'packed',
    }

    // Reuses the same English-locked poster brief as Poster Studio, including
    // the rules that strip foreign text off supplier photos.
    const posterPrompt = buildPosterPrompt(fields)
    const aspect = posterAspectRatio(fields.layout)
    const imageBytes = await resolveImageBytes(sourceImage)

    const langLabel =
      language === 'fr'
        ? 'French'
        : language === 'kreol_mix'
          ? 'a natural Mauritian mix of English/French with a touch of Kreol'
          : 'English'
    const copyPrompt =
      `Write a Facebook post caption in ${langLabel}, tone: ${tone}.\n` +
      `Product: ${productName}${priceNow ? ` - price Rs ${priceNow}` : ''}.` +
      (inventoryFacts ? `\n\nInventory facts (use these, do not invent specs):\n${inventoryFacts}` : '') +
      (priceNow ? '' : '\n\nNo price supplied - do NOT state any price.') +
      (extra ? `\n\nExtra instructions: ${extra}` : '')

    // All four calls in flight at once. allSettled, not all: one provider being
    // out of credit must not discard the other provider's finished work.
    const [gImg, gCopy, oImg, oCopy] = await Promise.allSettled([
      generatePosterImage(posterModelOrThrow(GEMINI_POSTER_MODEL), posterPrompt, imageBytes, aspect),
      geminiCopy(COPY_SYSTEM, copyPrompt),
      generatePosterImage(posterModelOrThrow(OPENAI_POSTER_MODEL), posterPrompt, imageBytes, aspect),
      openaiCopy(COPY_SYSTEM, copyPrompt),
    ])

    const side = (
      label: string,
      provider: 'google' | 'openai',
      img: PromiseSettledResult<{ dataUrl: string; warnings: string[] }>,
      copy: PromiseSettledResult<string>,
    ) => ({
      label,
      provider,
      image: img.status === 'fulfilled' ? img.value.dataUrl : null,
      imageError:
        img.status === 'rejected'
          ? translatePosterError(img.reason instanceof Error ? img.reason.message : String(img.reason), provider)
          : null,
      post: copy.status === 'fulfilled' ? parsePostCopy(copy.value) : null,
      copyError:
        copy.status === 'rejected'
          ? translatePosterError(copy.reason instanceof Error ? copy.reason.message : String(copy.reason), provider)
          : null,
    })

    const options = [
      side('Gemini', 'google', gImg, gCopy),
      side('ChatGPT', 'openai', oImg, oCopy),
    ]

    // Only a total wipeout is an error. Anything else returns what worked.
    if (options.every((o) => !o.image && !o.post)) {
      return NextResponse.json(
        { success: false, error: options[0].imageError || options[0].copyError || 'Generation failed', options },
        { status: 502 },
      )
    }

    return NextResponse.json({ success: true, options, generatedAt: new Date().toISOString() })
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Generation failed'
    console.error('generate-post error:', raw)
    return NextResponse.json({ success: false, error: raw }, { status: 500 })
  }
}
