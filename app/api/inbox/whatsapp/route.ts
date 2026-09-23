import { NextResponse } from 'next/server'
import { requireWhatsAppInboxUser, validateWhatsAppScope, WhatsAppScopeError } from '@/lib/whatsapp/number-scope'
import { getCapabilities } from '@/lib/facebook/capabilities'
import { listContacts, listContactsForScopes, listMessages, listWaitingContacts, markRead, sendMedia, sendText, whatsappToken, type OutboundWaMedia } from '@/lib/whatsapp/store'
import { validOutboundMedia } from '@/lib/inbox/outbound-media'
import { listWhatsAppNumbers } from '@/lib/whatsapp/accounts'
import { pauseForHumanReply } from '@/lib/inbox-autopilot/runtime'
import { loadStars } from '@/lib/inbox/thread-stars'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * WhatsApp conversations, served from Postgres rather than Graph.
 *
 * The Cloud API cannot list past conversations, so this channel reads what the
 * webhook has stored. An empty list therefore means "nothing has arrived since
 * the webhook was connected", which the UI states explicitly rather than
 * implying the customer has never written.
 */

/**
 * Adds the conversations the newest-100 page missed: customers still waiting,
 * and threads someone starred.
 *
 * The 100 newest is a page size, not a day's work. Measured 23 Sep 2026 it
 * reached back only 2h44m, so a customer who wrote in the morning silently
 * dropped off the list before anyone answered - 390 waiting customers hidden,
 * 135 with unread messages - which is what "messages disappear" looked like.
 * A star is an agent flagging something unresolved, and the two that existed
 * sat at rank 764 and 1290. Both widenings mirror the Messenger cache.
 *
 * Skipped while a search is active - then the list is the search result, and a
 * widened row must not reappear as something the query did not match. Returns
 * the original list on any failure: a widener, never a gate.
 */
async function withMissedContacts(
  contacts: Awaited<ReturnType<typeof listContacts>>,
  search: string | undefined,
  phoneNumberId: string | null,
) {
  if (search?.trim()) return contacts
  const merged = [...contacts]
  const seen = new Set(contacts.map((c) => `${c.phoneNumberId}:${c.waId}`))
  const add = (rows: Awaited<ReturnType<typeof listContacts>>) => {
    for (const row of rows) {
      const key = `${row.phoneNumberId}:${row.waId}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(row)
    }
  }

  // Waiting customers first: the reason a thread vanishes mid-conversation.
  try {
    add(await listWaitingContacts(600, phoneNumberId ?? undefined))
  } catch (e) {
    console.log('[v0] waiting whatsapp widening failed:', e instanceof Error ? e.message : e)
  }

  try {
    const stars = await loadStars(createAdminClient())
    const missing = [...stars.keys()]
      .map((key) => key.split(':'))
      .filter((parts) => parts[0] === 'whatsapp' && parts[1] && parts[2])
      .map((parts) => ({ phoneNumberId: parts[1], waId: parts[2] }))
      .filter((scope) => !seen.has(`${scope.phoneNumberId}:${scope.waId}`))
      // Honour the number filter the caller asked for.
      .filter((scope) => !phoneNumberId || scope.phoneNumberId === phoneNumberId)
    // listContactsForScopes applies the same can_read check, so a number the
    // user may not read stays unreadable even when someone starred it.
    if (missing.length) add(await listContactsForScopes(missing))
  } catch (e) {
    console.log('[v0] starred whatsapp widening failed:', e instanceof Error ? e.message : e)
  }

  return merged
}

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
      const {messages,readVersion,hasMore,nextCursor} = await listMessages(waId, phoneNumberId!, 100, before ?? undefined)
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
    const contacts = await withMissedContacts(
      await listContacts(100, q, phoneNumberId ?? undefined),
      q,
      phoneNumberId,
    )

    // Number/scope discovery costs ~6 Graph calls (businesses, owned + client
    // WABAs, phone_numbers and subscribed_apps per WABA, debug_token) and the
    // answers change maybe monthly. The in-memory cache cannot help because
    // each serverless instance starts cold, so polling it every 30s burned
    // over a thousand calls a day against the app's rate limit. It is now
    // opt-in: the client asks once per page load, not on every refresh.
    if (!params.has('meta')) {
      return NextResponse.json({ success: true, contacts, ...envFlags })
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

    const { waId, phoneNumberId, message, media } = (await request.json()) as {
      waId?: string; phoneNumberId?: string; message?: string; media?: OutboundWaMedia | null
    }
    validateWhatsAppScope(waId,phoneNumberId)
    const text = typeof message==='string'?message.trim():''
    const attachment = validOutboundMedia(media)
    if (media && !attachment) return NextResponse.json({ success: false, error: 'The attachment is not one this inbox prepared.' }, { status: 400 })
    if (!waId || (!text && !attachment)) {
      return NextResponse.json({ success: false, error: 'waId and a message or attachment are required' }, { status: 400 })
    }
    if (!whatsappToken()) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp is not configured: no access token.' },
        { status: 400 },
      )
    }

    await pauseForHumanReply(user.id,'whatsapp',phoneNumberId!,waId)
    const res = attachment ? await sendMedia(waId, phoneNumberId!, attachment, text) : await sendText(waId, phoneNumberId!, text)
    return NextResponse.json({ success: true, ...res })
  } catch (e) {
    if(e instanceof WhatsAppScopeError) return NextResponse.json({success:false,error:e.message},{status:e.status})
    const message = e instanceof Error ? e.message : 'WhatsApp send failed'
    console.log('[v0] whatsapp send failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
