import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'

// AI post generation for Product Master: turns a product + post type + tone
// into ready-to-paste social copy (hook / body / CTA / hashtags). Uses the
// same AI gateway pattern as the ads briefing route.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const productName: string = String(body?.productName || '').slice(0, 200)
    const productPrice: string = body?.productPrice ? String(body.productPrice).slice(0, 40) : ''
    const postType: string = ['fb_ad', 'reel_caption', 'description'].includes(body?.postType)
      ? body.postType
      : 'fb_ad'
    const tone: string = ['energetic', 'friendly', 'professional', 'funny'].includes(body?.tone)
      ? body.tone
      : 'energetic'
    const language: string = ['en', 'fr', 'kreol_mix'].includes(body?.language) ? body.language : 'en'
    const extra: string = String(body?.extra || '').slice(0, 500)

    if (!productName) {
      return NextResponse.json({ success: false, error: 'productName is required' }, { status: 400 })
    }

    const typeLabel =
      postType === 'fb_ad'
        ? 'a Facebook ad post (short, scroll-stopping, conversion focused)'
        : postType === 'reel_caption'
          ? 'an Instagram/Facebook reel caption (punchy, hooks in first line)'
          : 'a product description for a catalog page (clear, benefit-led)'

    const langLabel =
      language === 'fr'
        ? 'French'
        : language === 'kreol_mix'
          ? 'a natural Mauritian mix of English/French with a touch of Kreol - the way local FB ads read'
          : 'English'

    const { text } = await generateText({
      model: 'openai/gpt-5.4-mini',
      system:
        'You write social commerce copy for a Mauritius-based delivery e-commerce brand selling household gadgets. ' +
        'Prices are in Mauritian Rupees written like "Rs 675". Delivery is offered across the island, cash on delivery. ' +
        'OUTPUT FORMAT - follow exactly, it is parsed by the UI:\n' +
        'HOOK: <one attention line>\n' +
        'BODY: <2-5 short lines selling the product, one idea per line>\n' +
        'CTA: <one action line, e.g. order via inbox / WhatsApp>\n' +
        'HASHTAGS: <5-8 hashtags space separated>\n' +
        'Plain text only, no markdown. Emojis welcome where natural.',
      prompt:
        `Write ${typeLabel} in ${langLabel}, tone: ${tone}.\n` +
        `Product: ${productName}${productPrice ? ` - price ${productPrice}` : ''}.` +
        (extra ? `\nExtra instructions from the marketer: ${extra}` : ''),
    })

    // Parse the labeled sections; tolerate missing labels
    const section = (label: string) => {
      const m = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:HOOK|BODY|CTA|HASHTAGS):|$)`, 'i'))
      return m ? m[1].trim() : ''
    }

    return NextResponse.json({
      success: true,
      post: {
        hook: section('HOOK'),
        body: section('BODY'),
        cta: section('CTA'),
        hashtags: section('HASHTAGS'),
        raw: text.trim(),
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('ai-post error:', error)
    return NextResponse.json({ success: false, error: 'Generation failed' }, { status: 500 })
  }
}
