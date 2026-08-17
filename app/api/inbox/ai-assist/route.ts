/**
 * Reads a conversation and returns BOTH a draft reply and the order fields the
 * customer has already given, so opening a lead pre-fills the Quick Order form
 * instead of the agent re-reading the thread and retyping it.
 *
 * Nothing here sends or saves anything - the agent approves every action. The
 * model is deliberately not trusted with the final values either: whatever it
 * returns for product and locality is re-matched against the real catalogue
 * below, because a hallucinated locality becomes a real failed delivery.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  computeDefaultDeliveryDate,
  extractPhone,
  priceFor,
  type Holiday,
  type QuickOrderProduct,
} from '@/lib/orders/quick-order'

// The AI SDK must not run on the edge runtime.
export const runtime = 'nodejs'

/**
 * Billed to the project's own OpenAI key rather than the AI Gateway.
 *
 * The Gateway's free tier rejects the stronger models outright and 429s the
 * rest, which in an inbox means the draft silently fails exactly when an agent
 * is working through a queue of leads.
 */
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

/**
 * gpt-4.1 was chosen by comparison, not by default: on a real Kreol thread the
 * cheaper models returned fluent-looking nonsense ("Mo krwar ou krwar 2"),
 * which would be sent to a customer. Do not downgrade without re-testing Kreol.
 */
const MODEL = 'gpt-4.1'

type Turn = { from?: string; text?: string }

/** Strip accents, punctuation and spacing so "Riviere-du-Rempart" matches "riviere du rempart". */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Resolve a free-text guess to a real catalogue entry.
 *
 * Returns null rather than a wrong-but-close answer: an unmatched field shows
 * as empty in the form, which the agent notices, whereas a confidently wrong
 * locality silently routes the parcel to the wrong contractor.
 */
function matchName<T>(guess: string | null | undefined, rows: T[], nameOf: (r: T) => string): T | null {
  if (!guess?.trim()) return null
  const g = normalise(guess)
  if (!g) return null

  const scored = rows.map((r) => ({ row: r, n: normalise(nameOf(r)) }))
  const exact = scored.find((s) => s.n === g)
  if (exact) return exact.row

  const prefix = scored.filter((s) => s.n.startsWith(g) || g.startsWith(s.n))
  if (prefix.length === 1) return prefix[0].row

  const contains = scored.filter((s) => s.n.includes(g) || g.includes(s.n))
  if (contains.length === 1) return contains[0].row

  // Ambiguous or unknown - let the agent choose.
  return null
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = (await request.json()) as {
      messages?: Turn[]
      customerName?: string
      pageName?: string
      channel?: string
      productHint?: string | null
      adName?: string | null
    }

    const turns = Array.isArray(body.messages) ? body.messages : []
    const transcript = turns
      .filter((t) => t && typeof t.text === 'string' && t.text.trim())
      .slice(-25)
      .map(
        (t) =>
          `${t.from === 'business' || t.from === 'agent' || t.from === 'out' ? 'Business' : 'Customer'}: ${t
            .text!.trim()
            .slice(0, 500)}`,
      )
      .join('\n')

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'No conversation to read yet.' },
        { status: 400 },
      )
    }

    // Catalogue + settings, loaded in parallel - all three ground the model.
    const [{ data: products }, { data: localities }, { data: settingsRow }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, bundle_prices, is_b1g1')
        .eq('is_active', true)
        .order('name'),
      supabase.from('localities').select('name').eq('is_active', true).order('name'),
      supabase
        .from('extension_settings')
        .select('ai_reply_prompt, cutoff_time, delivery_day_scheme, holidays')
        .eq('id', 1)
        .single(),
    ])

    const catalogue = (products ?? []) as QuickOrderProduct[]
    const businessContext =
      typeof settingsRow?.ai_reply_prompt === 'string' ? settingsRow.ai_reply_prompt.trim() : ''

    const system = [
      'You are an experienced sales agent for a Mauritian retail and home-delivery business, working the social-media inbox (Facebook Messenger, WhatsApp, and Facebook post comments).',
      'You do two jobs at once: (1) write the single best reply to send now, and (2) extract the order details the customer has already given.',
      '',
      'REPLY RULES:',
      '- Reply in the SAME language the customer used (English, French, or Mauritian Kreol). Match their register; be warm and human, never robotic.',
      '- Answer the latest message directly and move the sale or the delivery forward. If you still need the name, phone, or locality to place the order, ask for exactly what is missing - politely and in one short message.',
      '- Never invent prices, stock levels, or delivery dates. If you were not given a fact, ask for it instead of guessing.',
      '- Return only the message text: no markdown, no bullet points, no surrounding quotes, no signature.',
      '',
      'EXTRACTION RULES:',
      '- Only extract what the customer actually stated. Never guess. Use null for anything not clearly given.',
      '- A Mauritian mobile number is 8 digits starting with 5. Ignore order numbers, prices, and dates.',
      '- For productName, copy the closest name from the product list EXACTLY as written there, or null if the customer named nothing recognisable.',
      '- For locality, return the place name the customer gave, spelled as they wrote it. Do not normalise or invent one.',
      '- readyToOrder is true only when a product, a name, a phone number, and a locality are all present.',
      body.pageName ? `\nThe business page is "${body.pageName}".` : '',
      body.customerName ? `The customer's social profile name is "${body.customerName}".` : '',
      body.productHint ? `This lead came from an ad for "${body.productHint}" - likely, not certain.` : '',
      catalogue.length ? `\nPRODUCT LIST:\n${catalogue.map((p) => p.name).join('\n')}` : '',
      businessContext ? `\nBUSINESS CONTEXT AND TONE:\n${businessContext}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    // nullable(), not optional() - OpenAI strict mode requires every key present.
    const schema = z.object({
      reply: z.string().describe('The message to send to the customer now.'),
      customerName: z.string().nullable(),
      phone: z.string().nullable(),
      phone2: z.string().nullable(),
      locality: z.string().nullable(),
      productName: z.string().nullable(),
      qty: z.number().int().min(1).max(50),
      notes: z.string().nullable().describe('Delivery instructions or special requests only.'),
      intent: z.enum(['price_enquiry', 'ready_to_order', 'delivery_question', 'complaint', 'other']),
      readyToOrder: z.boolean(),
      missing: z.array(z.enum(['product', 'name', 'phone', 'locality'])),
    })

    const { experimental_output: out } = await generateText({
      model: openai(MODEL),
      system,
      messages: [
        {
          role: 'user',
          content: `Conversation so far (newest last):\n\n${transcript}\n\nWrite the reply to send now and extract the order details.`,
        },
      ],
      experimental_output: Output.object({ schema }),
    })

    // Re-ground the model's guesses against the real catalogue.
    const product = matchName(out.productName, catalogue, (p) => p.name)
    const locality = matchName(out.locality, (localities ?? []) as { name: string }[], (l) => l.name)

    // Trust a regex over the model for phone numbers: the transcript is the
    // source of truth and a digit-perfect match matters more than fluency.
    const phone = extractPhone(out.phone ?? '') ?? extractPhone(transcript) ?? null
    const phone2 = extractPhone(out.phone2 ?? '') ?? null

    const qty = Math.min(Math.max(1, out.qty || 1), 50)
    const holidays: Holiday[] = Array.isArray(settingsRow?.holidays) ? settingsRow.holidays : []
    const delivery = computeDefaultDeliveryDate(
      new Date(),
      settingsRow?.cutoff_time || '20:00',
      (settingsRow?.delivery_day_scheme as Record<string, string>) || {},
      holidays,
    )

    return NextResponse.json({
      success: true,
      reply: (out.reply || '').trim(),
      intent: out.intent,
      readyToOrder: out.readyToOrder,
      missing: out.missing ?? [],
      order: {
        customerName: out.customerName?.trim() || body.customerName || '',
        contact1: phone ?? '',
        contact2: phone2 && phone2 !== phone ? phone2 : '',
        region: locality?.name ?? '',
        // Null when nothing matched, so the form shows an empty picker rather
        // than a confidently wrong product.
        productId: product?.id ?? null,
        productName: product?.name ?? '',
        qty,
        amount: product ? priceFor(product, qty) : 0,
        notes: out.notes?.trim() || '',
        deliveryDate: delivery.date,
      },
      // Surfaced in the UI so the agent can see WHY a field is blank.
      unmatched: {
        product: !!out.productName && !product ? out.productName : null,
        locality: !!out.locality && !locality ? out.locality : null,
      },
    })
  } catch (error) {
    console.error('[v0] ai-assist error:', error)
    return NextResponse.json({ success: false, error: 'Failed to analyse conversation' }, { status: 500 })
  }
}
