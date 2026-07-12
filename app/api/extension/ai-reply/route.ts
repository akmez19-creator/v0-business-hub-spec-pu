import { generateText } from 'ai'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Do NOT use the edge runtime with the AI SDK.
export const runtime = 'nodejs'

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

    // Admin-configured business context (tone, policies, product info)
    const { data: settingsRow } = await auth.supabase
      .from('extension_settings')
      .select('ai_reply_prompt')
      .eq('id', 1)
      .single()
    const businessContext: string = typeof settingsRow?.ai_reply_prompt === 'string' ? settingsRow.ai_reply_prompt.trim() : ''

    const system = [
      'You are a customer-service agent replying to a customer message in a social-media inbox (Facebook/Instagram/WhatsApp) for a Mauritian retail/delivery business.',
      'Write ONE concise, friendly, professional reply that directly answers the latest customer message and moves the sale or delivery forward.',
      'Reply in the SAME language the customer used (English, French, or Mauritian Kreol). Keep it natural and human, not robotic.',
      'Do not invent prices, stock, or delivery dates you were not given. If information is missing, politely ask for it.',
      'Do not use markdown, bullet points, or quotation marks around the whole message. Return only the message text the agent will send.',
      pageName ? `The business page is "${pageName}".` : '',
      customerName ? `The customer's name is "${customerName}"; you may greet them by first name if natural.` : '',
      businessContext ? `\nBusiness context and tone to follow:\n${businessContext}` : '',
    ].filter(Boolean).join(' ')

    const { text } = await generateText({
      model: 'openai/gpt-4o',
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
