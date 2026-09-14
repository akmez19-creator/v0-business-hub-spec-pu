import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import {
  deliveryDayLabel,
  offerLabel,
  priceFor,
  upcomingDeliveryDates,
  type Holiday,
  type QuickOrderProduct,
} from '@/lib/orders/quick-order'

// Do NOT use the edge runtime with the AI SDK.
export const runtime = 'nodejs'

/**
 * Uses the project's own OpenAI key. Routing through the AI Gateway made this
 * fail with a 429 on the free tier, so the extension's "AI reply" button would
 * intermittently do nothing. Keep this in step with /api/inbox/ai-assist.
 */
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Validate the extension's bearer token and return the Supabase user + client.
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const accessToken = authHeader.replace('Bearer ', '')

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user }, error } = await adminSupabase.auth.getUser(accessToken)
  if (error || !user) return null
  return { user, supabase: adminSupabase }
}

interface ChatTurn {
  from?: string
  text?: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getUserFromToken(request)
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }

    const body = await request.json()
    const turns: ChatTurn[] = Array.isArray(body.messages) ? body.messages : []
    const customerName: string = typeof body.customerName === 'string' ? body.customerName.slice(0, 80) : ''
    const pageName: string = typeof body.pageName === 'string' ? body.pageName.slice(0, 120) : ''

    // Build a clean transcript. Cap length so we never send an unbounded prompt.
    const transcript = turns
      .filter(t => t && typeof t.text === 'string' && t.text.trim())
      .slice(-20)
      .map(t => `${(t.from === 'business' || t.from === 'agent') ? 'Business' : 'Customer'}: ${t.text!.trim().slice(0, 500)}`)
      .join('\n')

    if (!transcript) {
      return NextResponse.json({ success: false, error: 'No customer message found to reply to.' }, { status: 400, headers: corsHeaders })
    }

    // Same grounding as /api/inbox/ai-assist: the owner's instruction, the live
    // catalogue with real prices, and the delivery days that can honestly be
    // offered. Without these the extension button could only talk in generalities.
    const [{ data: settingsRow }, { data: products }] = await Promise.all([
      auth.supabase
        .from('extension_settings')
        .select('ai_reply_prompt, cutoff_time, delivery_day_scheme, holidays')
        .eq('id', 1)
        .single(),
      auth.supabase
        .from('products')
        .select('id, name, price, bundle_prices, is_b1g1')
        .eq('is_active', true)
        .order('name'),
    ])
    const businessContext: string = typeof settingsRow?.ai_reply_prompt === 'string' ? settingsRow.ai_reply_prompt.trim() : ''
    const catalogue = (products ?? []) as QuickOrderProduct[]
    const priceList = catalogue
      .map(p => {
        const one = priceFor(p, 1)
        const offer = offerLabel(p)
        return `${p.name}: Rs ${one}${offer ? ` (${offer})` : ''}`
      })
      .join('\n')
    const holidays: Holiday[] = Array.isArray(settingsRow?.holidays) ? settingsRow.holidays : []
    const deliveryOptions = upcomingDeliveryDates(
      new Date(),
      settingsRow?.cutoff_time || '20:00',
      (settingsRow?.delivery_day_scheme as Record<string, string>) || {},
      holidays,
    )
    const deliveryFacts = deliveryOptions.map(d => `${deliveryDayLabel(d)} (${d})`).join(', ')

    const system = [
      'You are a customer-service agent replying to a customer message in a social-media inbox (Facebook/Instagram/WhatsApp) for a Mauritian retail/delivery business.',
      'Write ONE concise, friendly, professional reply that directly answers the latest customer message and moves the sale or delivery forward.',
      'Reply in the SAME language the customer used (English, French, or Mauritian Kreol). Keep it natural and human, not robotic.',
      'Talk about the specific product the customer asked about, using its exact name and price from the PRICE LIST. Do not invent prices, stock, or delivery dates you were not given. If information is missing, politely ask for it.',
      'Do not use markdown, bullet points, or quotation marks around the whole message. Return only the message text the agent will send.',
      pageName ? `The business page is "${pageName}".` : '',
      customerName ? `The customer's name is "${customerName}"; you may greet them by first name if natural.` : '',
      priceList ? `\nPRICE LIST (unit price for one; offers as noted):\n${priceList}` : '',
      `\nDELIVERY DAYS AVAILABLE (the only dates you may offer; the first is the default): ${deliveryFacts}. If the customer asks for a different day, say the team will confirm.`,
      businessContext ? `\nBusiness context and tone to follow:\n${businessContext}` : '',
    ].filter(Boolean).join('\n')

    const { text } = await generateText({
      model: openai('gpt-4.1'),
      system,
      messages: [
        {
          role: 'user',
          content: `Here is the recent conversation (newest last):\n\n${transcript}\n\nWrite the best reply to send now.`,
        },
      ],
    })

    return NextResponse.json({ success: true, reply: (text || '').trim() }, { headers: corsHeaders })
  } catch (error) {
    console.error('AI reply error:', error)
    return NextResponse.json({ success: false, error: 'Failed to generate reply' }, { status: 500, headers: corsHeaders })
  }
}
