import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCapabilities } from '@/lib/facebook/capabilities'
import { hasWhatsAppConfig, listContacts, listMessages, markRead, sendText } from '@/lib/whatsapp/store'

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
    const configured = hasWhatsAppConfig()

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    const caps = token ? await getCapabilities(token) : null
    const channel = caps?.channels.whatsapp

    // A single thread was asked for.
    if (waId) {
      const messages = await listMessages(waId)
      await markRead(waId)
      return NextResponse.json({ success: true, messages })
    }

    const contacts = await listContacts()

    return NextResponse.json({
      success: true,
      configured,
      capability: channel ?? null,
      // Both must be true before a message can ever appear, and they fail for
      // different reasons - report them separately.
      canSend: configured && (channel?.available ?? false),
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
    if (!hasWhatsAppConfig()) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp is not configured. Set WHATSAPP_PHONE_NUMBER_ID and a token.' },
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
