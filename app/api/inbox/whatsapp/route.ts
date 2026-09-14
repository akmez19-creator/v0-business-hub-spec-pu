import { NextResponse } from 'next/server'
import { requireWhatsAppInboxUser, validateWhatsAppScope, WhatsAppScopeError } from '@/lib/whatsapp/number-scope'
import { getCapabilities } from '@/lib/facebook/capabilities'
import { listContacts, listContactsForScopes, listMessages, markRead, sendText, whatsappToken } from '@/lib/whatsapp/store'
import { listWhatsAppNumbers } from '@/lib/whatsapp/accounts'
import { getGreenContacts } from '@/lib/whatsapp-green/store'
import { hasGreenConversation, isGreenBusiness, overlayGreenContacts } from '@/lib/whatsapp-green/contact-overlay'
import { pauseForHumanReply } from '@/lib/inbox-autopilot/runtime'

/**
 * WhatsApp conversations, served from Postgres rather than Graph.
 *
 * The Cloud API cannot list past conversations, so this channel reads what the
 * webhook has stored. An empty list therefore means "nothing has arrived since
 * the webhook was connected", which the UI states explicitly rather than
 * implying the customer has never written.
 */

export async function GET(request: Request) {
  try {
    await requireWhatsAppInboxUser()

    const params = new URL(request.url).searchParams
    const waId = params.get('waId')
    const phoneNumberId=params.get('phoneNumberId')

    // A single thread was asked for. `before` pages backwards through long
    // histories: a busy customer can run to thousands of messages, and the
    // thread loads the newest page first.
    if (waId) {
      const before = params.get('before')
      validateWhatsAppScope(waId,phoneNumberId)
      let transcript: Awaited<ReturnType<typeof listMessages>>
      try { transcript = await listMessages(waId, phoneNumberId!, 100, before ?? undefined) }
      catch (error) {
        if (!(error instanceof WhatsAppScopeError) || error.status !== 404) throw error
        // Only a proven exact provider scope can supply an empty canonical pane.
        // This does not mark anything read or imply complete canonical history.
        const additional = await getGreenContacts({ phoneNumberId: phoneNumberId!, waId, limit: 1 }).catch(() => [])
        if (!hasGreenConversation(additional, { phoneNumberId: phoneNumberId!, waId })) throw error
        return NextResponse.json({ success: true, messages: [], hasMore: false, nextCursor: null,
          canonicalHistory: 'unavailable', additionalCopiesOnly: true })
      }
      const {messages,readVersion,hasMore,nextCursor} = transcript
      // Paging backwards must not clear the badge - only opening the thread
      // (the first, uncursored request) counts as reading it.
      if (!before) await markRead(waId,phoneNumberId!,readVersion)
      // Folded history copies sit among the canonical rows, so paging comes from the store, not a length check.
      return NextResponse.json({ success: true, messages, hasMore, nextCursor })
    }

    // Env-only flags, free to compute on every poll.
    const envFlags = {
      signatureVerified: Boolean(process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
      hasVerifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      webhookPath: '/api/webhooks/whatsapp',
    }

    // Contacts live in Postgres, so the 30s poll costs no Graph quota.
    // Search runs in the database so it can reach past the newest page.
    const q = params.get('q') ?? undefined
    const [canonicalContacts, additional] = await Promise.all([
      listContacts(100, q, phoneNumberId ?? undefined),
      phoneNumberId && !isGreenBusiness(phoneNumberId) ? Promise.resolve([])
        : getGreenContacts({ q, phoneNumberId: phoneNumberId ?? undefined, limit: 200 }).catch(() => null),
    ])
    let contacts = canonicalContacts
    let additionalCopiesUnavailable = additional === null
    if (additional?.length) {
      try {
        const existing = new Set(canonicalContacts.map(contact => JSON.stringify([contact.phoneNumberId, contact.waId])))
        const missing = additional.filter(contact => !existing.has(JSON.stringify([contact.phoneNumberId, contact.waId])))
          .map(contact => ({ phoneNumberId: contact.phoneNumberId, waId: contact.waId }))
        const hydrated = await listContactsForScopes(missing)
        contacts = overlayGreenContacts([...canonicalContacts, ...hydrated], additional, { q, phoneNumberId: phoneNumberId ?? undefined, limit: 100 })
      } catch { additionalCopiesUnavailable = true }
    }

    // Number/scope discovery costs ~6 Graph calls (businesses, owned + client
    // WABAs, phone_numbers and subscribed_apps per WABA, debug_token) and the
    // answers change maybe monthly. The in-memory cache cannot help because
    // each serverless instance starts cold, so polling it every 30s burned
    // over a thousand calls a day against the app's rate limit. It is now
    // opt-in: the client asks once per page load, not on every refresh.
    if (!params.has('meta')) {
      return NextResponse.json({ success: true, contacts, additionalCopiesUnavailable, ...envFlags })
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

    return NextResponse.json({
      success: true,
      capability: channel ?? null,
      numbers,
      // Scope granted AND at least one Cloud API number. These fail for
      // different reasons, so the UI reports them separately.
      canSend: Boolean(token) && (channel?.available ?? false) && usable.length > 0,
      contacts,
      additionalCopiesUnavailable,
      ...envFlags,
    })
  } catch (e) {
    if(e instanceof WhatsAppScopeError) return NextResponse.json({success:false,error:e.message},{status:e.status})
    const message = e instanceof Error ? e.message : 'Failed to load WhatsApp'
    console.log('[v0] whatsapp list failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user=await requireWhatsAppInboxUser()

    const { waId, phoneNumberId, message } = (await request.json()) as { waId?: string; phoneNumberId?: string; message?: string }
    validateWhatsAppScope(waId,phoneNumberId)
    const text = typeof message==='string'?message.trim():''
    if (!waId || !text) {
      return NextResponse.json({ success: false, error: 'waId and message are required' }, { status: 400 })
    }
    if (!whatsappToken()) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp is not configured: no access token.' },
        { status: 400 },
      )
    }

    await pauseForHumanReply(user.id,'whatsapp',phoneNumberId!,waId)
    const res = await sendText(waId, phoneNumberId!, text)
    return NextResponse.json({ success: true, ...res })
  } catch (e) {
    if(e instanceof WhatsAppScopeError) return NextResponse.json({success:false,error:e.message},{status:e.status})
    const message = e instanceof Error ? e.message : 'WhatsApp send failed'
    console.log('[v0] whatsapp send failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
