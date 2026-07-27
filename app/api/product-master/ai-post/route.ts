import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Detect offer/bundle mentions (B1G1, bundles, free delivery, discounts) in
// inventory text so the AI can lead with them instead of inventing offers.
function extractOffers(text: string): string[] {
  const offers: string[] = []
  const t = text.toLowerCase()
  if (/b1g1|buy\s*1\s*get\s*1|buy\s*one\s*get\s*one|1\s*\+\s*1/.test(t)) offers.push('Buy 1 Get 1 Free')
  if (/b2g1|buy\s*2\s*get\s*1/.test(t)) offers.push('Buy 2 Get 1 Free')
  if (/bundle|combo|pack of|set of|duo|trio/.test(t)) offers.push('Bundle / combo deal')
  if (/free\s*deliver/.test(t)) offers.push('Free delivery')
  const disc = text.match(/(\d{1,2})\s*%\s*(?:off|discount)/i)
  if (disc) offers.push(`${disc[1]}% off`)
  const wasNow = text.match(/rs\.?\s*(\d[\d,]*)\s*(?:instead of|was|au lieu de)\s*rs\.?\s*(\d[\d,]*)/i)
  if (wasNow) offers.push(`Promo price Rs ${wasNow[1]} (was Rs ${wasNow[2]})`)
  return offers
}

// AI post generation for Product Master: turns a product + post type + tone
// into ready-to-paste social copy (hook / body / CTA / hashtags). Reads the
// real inventory record (description, price, stock, offers) so copy is
// grounded in facts - especially offers like Buy1Get1 or bundles.
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
    const productId: string = String(body?.productId || '')
    let productName: string = String(body?.productName || '').slice(0, 200)
    let productPrice: string = body?.productPrice ? String(body.productPrice).slice(0, 40) : ''
    const postType: string = ['fb_ad', 'reel_caption', 'description'].includes(body?.postType)
      ? body.postType
      : 'fb_ad'
    const tone: string = ['energetic', 'friendly', 'professional', 'funny'].includes(body?.tone)
      ? body.tone
      : 'energetic'
    const language: string = ['en', 'fr', 'kreol_mix'].includes(body?.language) ? body.language : 'en'
    const extra: string = String(body?.extra || '').slice(0, 500)

    // ---- Ground the copy in the real inventory record + post history ----
    let inventoryFacts = ''
    let offers: string[] = []
    let pastHooks: string[] = []
    if (productId) {
      const admin = createAdminClient()
      const [{ data: p }, { data: pastPosts }] = await Promise.all([
        admin
          .from('products')
          .select('name, description, price, quantity, category, sold_out')
          .eq('id', productId)
          .single(),
        // AI knowledge centre: previous posts for this product inform the new
        // one - reuse what worked, never repeat the same hook twice
        admin
          .from('product_posts')
          .select('content')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(5),
      ])
      pastHooks = (pastPosts ?? [])
        .map((r) => (r.content as { hook?: string })?.hook || '')
        .filter(Boolean)
      if (p) {
        productName = p.name
        if (p.price != null) productPrice = `Rs ${p.price}`
        const facts: string[] = []
        if (p.category) facts.push(`Category: ${p.category}`)
        if (p.description) facts.push(`Inventory description: ${String(p.description).slice(0, 600)}`)
        if ((p.quantity ?? 0) > 0) facts.push(`In stock: ${p.quantity} units available now`)
        if (p.sold_out) facts.push('MARKED SOLD OUT - write a waitlist/back-soon angle, do NOT push immediate orders')
        inventoryFacts = facts.join('\n')
        offers = extractOffers(`${p.name} ${p.description || ''}`)
      }
    }
    // Offers can also come from the marketer's extra instructions
    offers = [...new Set([...offers, ...extractOffers(extra)])]

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
        (inventoryFacts ? `\n\nInventory facts (use these, do not invent specs):\n${inventoryFacts}` : '') +
        (offers.length > 0
          ? `\n\nACTIVE OFFERS - lead with these, they are the main selling angle: ${offers.join('; ')}`
          : '\n\nNo special offer is running. Do NOT invent discounts, B1G1, or bundle deals.') +
        (pastHooks.length > 0
          ? `\n\nHooks already used for this product (write something DIFFERENT):\n${pastHooks.map((h) => `- ${h}`).join('\n')}`
          : '') +
        (extra ? `\n\nExtra instructions from the marketer: ${extra}` : ''),
    })

    // Parse the labeled sections; tolerate missing labels
    const section = (label: string) => {
      const m = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:HOOK|BODY|CTA|HASHTAGS):|$)`, 'i'))
      return m ? m[1].trim() : ''
    }

    const post = {
      hook: section('HOOK'),
      body: section('BODY'),
      cta: section('CTA'),
      hashtags: section('HASHTAGS'),
      raw: text.trim(),
    }

    // Persist to product_posts so posts are managed and attributed to the
    // product across all pages, and feed future generations as knowledge
    let savedId: string | null = null
    if (productId) {
      const admin = createAdminClient()
      const { data: saved } = await admin
        .from('product_posts')
        .insert({
          product_id: productId,
          product_name: productName,
          post_type: postType,
          tone,
          language,
          content: post,
          offers_used: offers,
          created_by: user.id,
        })
        .select('id')
        .single()
      savedId = saved?.id ?? null
    }

    return NextResponse.json({
      success: true,
      post,
      postId: savedId,
      offersUsed: offers,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('ai-post error:', error)
    return NextResponse.json({ success: false, error: 'Generation failed' }, { status: 500 })
  }
}
