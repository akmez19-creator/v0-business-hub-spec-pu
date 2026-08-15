import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCapabilities } from '@/lib/facebook/capabilities'
import { listContacts, listMessages, markRead, sendText, whatsappToken } from '@/lib/whatsapp/store'
import { listWhatsAppNumbers } from '@/lib/whatsapp/accounts'

/**
 * WhatsApp conversations, served from Postgres rather than Graph.
 *
 * The Cloud API cannot list past conversations, so this channel reads what the
 * webhook has stored. An empty list therefore means "nothing has arrived since
 * the webhook was connected", which the UI states explicitly rather than
 * implying the customer has never written.
 */

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function GET(request: Request) {
  try {
    if (!(await requireUser())) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const waId = new URL(request.url).searchParams.get('waId')

    // A single thread was asked for.
    if (waId) {
      const messages = await listMessages(waId)
      await markRead(waId)
      return NextResponse.json({ success: true, messages })
    }

    const token = whatsappToken()
    const caps = token ? await getCapabilities(token) : null
    const channel = caps?.channels.whatsapp

    // Numbers come from Meta, not an env var: the business runs four of them.
    let numbers: Awaited<ReturnType<typeof listWhatsAppNumbers>> = []
    if (token && channel?.available) {
      try {
        numbers = await listWhatsAppNumbers(token)
      } catch (e) {
        console.log('[v0] whatsapp number discovery failed:', e instanceof Error ? e.message : e)
      }
    }
    const usable = numbers.filter((n) => n.usable)
    const contacts = await listContacts()

    return NextResponse.json({
      success: true,
      capability: channel ?? null,
      numbers,
      // Scope granted AND at least one Cloud API number. These fail for
      // different reasons, so the UI reports them separately.
      canSend: Boolean(token) && (channel?.available ?? false) && usable.length > 0,
      signatureVerified: Boolean(process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
      hasVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      contacts,
      webhookPath: '/api/webhooks/whatsapp',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load WhatsApp'
    console.log('[v0] whatsapp list failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (!(await requireUser())) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { waId, message } = (await request.json()) as { waId?: string; message?: string }
    const text = (message ?? '').trim()
    if (!waId || !text) {
      return NextResponse.json({ success: false, error: 'waId and message are required' }, { status: 400 })
    }
    if (!whatsappToken()) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp is not configured: no access token.' },
        { status: 400 },
      )
    }

    const res = await sendText(waId, text)
    return NextResponse.json({ success: true, id: res.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'WhatsApp send failed'
    console.log('[v0] whatsapp send failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
