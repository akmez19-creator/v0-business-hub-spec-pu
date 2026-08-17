import { getAdRefs } from '@/lib/messenger/ad-refs'
import { findNotice, resolveCommentOrigins } from './comment-origin'
import { fbGet, fbWrite, FbGraphError } from './graph'
import { productFromAdName } from './post-ads'
import { getManageablePages, type FbPage } from './pages'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Messenger reads are near-real-time by nature, so they use a much shorter TTL
 * than the ads dashboard. The shared client still protects the app-wide quota:
 * if Facebook throttles us, a slightly stale thread beats an empty inbox.
 */
const LIST_TTL_MS = 30 * 1000
const THREAD_TTL_MS = 15 * 1000

/** Facebook's standard window for replying to a customer without a tag. */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000

export type InboxParticipant = { id: string; name?: string; email?: string }

export type InboxConversation = {
  id: string
  snippet: string
  updatedTime: string
  unreadCount: number
  messageCount: number
  /** The customer (i.e. the participant that is not the Page). */
  customer: InboxParticipant | null
  /** True when the last activity is older than the 24h reply window. */
  outsideWindow: boolean
  /**
   * The Page that owns this conversation. Carried on every row - not just
   * inferred from the current selection - because the combined view mixes
   * Pages, and a reply must go out as the Page that received the message.
   */
  pageId: string
  pageName: string
  /**
   * Ad this conversation started from, joined in from `messenger_ad_refs`.
   * Only ever set for threads that arrived AFTER the page webhook was
   * subscribed: Graph cannot backfill this, so older threads stay null.
   */
  adId?: string | null
  adName?: string | null
  /**
   * Product the thread is about. Either EXACT (from the ad-click webhook) or
   * INFERRED by matching a comment private-reply notice to its post -
   * `productSource` says which, so the UI never overstates certainty.
   */
  product?: string | null
  productSource?: 'ad-click' | 'comment' | null
  /** Post the customer commented on, when the thread began as a reply. */
  postId?: string | null
}

export type InboxMessage = {
  id: string
  text: string
  createdTime: string
  /** True when the Page sent it, false when the customer did. */
  fromPage: boolean
  fromName: string
  attachments: { type: string; url: string | null }[]
}

/**
 * Distinguishes "you have not granted the messaging permission yet" from every
 * other Graph failure. Facebook reports the missing scope as a generic #200,
 * which is indistinguishable from a genuine role problem unless we look at the
 * message text - so the UI can render setup instructions instead of an error.
 */
export class MessagingPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessagingPermissionError'
  }
}

function asPermissionError(e: unknown): never {
  const err = e as FbGraphError
  const msg = err?.message ?? String(e)
  if (err?.code === 200 || /pages_messaging|appropriate role/i.test(msg)) {
    throw new MessagingPermissionError(msg)
  }
  throw e
}

/** Every Page this token can manage, for the inbox's Page switcher. */
export async function getInboxPages(): Promise<FbPage[]> {
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return []
  return getManageablePages(token)
}

/**
 * The Page whose inbox we serve.
 *
 * Ad-account discovery surfaces every Page the user has a role on - six here -
 * and getManageablePages sorts them alphabetically, so falling back to
 * pages[0] silently picked an unrelated Page. Resolution order is now
 * explicit: the Page the caller asked for, then a configured override, then a
 * Page actually granted to the app, and only then alphabetical order.
 */
export async function getInboxPage(pageId?: string): Promise<FbPage | null> {
  const pages = await getInboxPages()
  if (pages.length === 0) return null
  if (pageId) {
    // An unknown id is a stale selection, not a reason to serve someone
    // else's inbox, so fall through to the defaults rather than guessing.
    const asked = pages.find((p) => p.id === pageId)
    if (asked) return asked
  }
  const configured = process.env.FACEBOOK_INBOX_PAGE_ID
  return (
    pages.find((p) => p.id === configured) ??
    pages.find((p) => p.direct) ??
    pages[0]
  )
}

type RawConversation = {
  id: string
  snippet?: string
  updated_time?: string
  unread_count?: number
  message_count?: number
  participants?: { data?: InboxParticipant[] }
  messages?: { data?: { message?: string; created_time?: string }[] }
}

export async function listConversations(page: FbPage, limit = 40): Promise<InboxConversation[]> {
  // messages{} rides along on the same call so we can spot the "X commented
  // on your post" notice without a second round trip per thread. Graph
  // returns messages newest-first, so the FIRST notice found is the latest
  // one - which is exactly the product the customer is asking about now.
  const url =
    `${GRAPH}/${page.id}/conversations` +
    `?fields=id,snippet,updated_time,unread_count,message_count,participants,` +
    `${encodeURIComponent('messages.limit(15){message,created_time}')}` +
    `&limit=${limit}&access_token=${encodeURIComponent(page.access_token)}`

  let json: { data?: RawConversation[] }
  try {
    json = await fbGet<{ data?: RawConversation[] }>(url, { cacheTtl: LIST_TTL_MS })
  } catch (e) {
    asPermissionError(e)
  }

  const now = Date.now()
  const noticeByConversation = new Map<string, string>()
  const conversations: InboxConversation[] = (json.data ?? []).map((c) => {
    const notice = findNotice(c.messages?.data)
    if (notice) noticeByConversation.set(c.id, notice)
    const participants = c.participants?.data ?? []
    // The Page is always a participant; the customer is whoever else is there.
    const customer = participants.find((p) => p.id !== page.id) ?? null
    const updatedTime = c.updated_time ?? new Date(0).toISOString()
    return {
      id: c.id,
      snippet: c.snippet ?? '',
      updatedTime,
      unreadCount: c.unread_count ?? 0,
      messageCount: c.message_count ?? 0,
      customer,
      outsideWindow: now - new Date(updatedTime).getTime() > MESSAGING_WINDOW_MS,
      pageId: page.id,
      pageName: page.name,
    }
  })

  // Attach ad attribution in ONE query, keyed by the customer's PSID - the
  // same id the page webhook stores as `sender.id`. Done here rather than in
  // listAllConversations so the single-Page view gets badges too.
  try {
    const psids = conversations
      .map((c) => c.customer?.id)
      .filter((id): id is string => Boolean(id))
    const refs = await getAdRefs(psids)
    for (const c of conversations) {
      const ref = c.customer?.id ? refs.get(c.customer.id) : undefined
      if (!ref) continue
      c.adId = ref.adId
      c.adName = ref.adName
      c.product = productFromAdName(ref.adName)
      c.productSource = 'ad-click'
    }
  } catch (error) {
    // Attribution is decoration; never let it take down the inbox.
    console.log('[v0] inbox: ad attribution lookup failed', error)
  }

  // Fallback for threads that began as a comment private-reply. Only fills
  // gaps - a real ad click always wins over this inference.
  try {
    const pending = conversations
      .filter((c) => !c.product)
      .map((c) => ({ id: c.id, noticeTime: noticeByConversation.get(c.id) }))
      .filter((t): t is { id: string; noticeTime: string } => Boolean(t.noticeTime))

    if (pending.length > 0) {
      const origins = await resolveCommentOrigins(page, pending)
      for (const c of conversations) {
        const origin = origins.get(c.id)
        if (!origin?.ad?.product) continue
        c.postId = origin.postId
        c.adId = origin.ad.adId
        c.adName = origin.ad.adName
        c.product = origin.ad.product
        c.productSource = 'comment'
      }
    }
  } catch (error) {
    console.log('[v0] inbox: comment-origin lookup failed', error)
  }

  return conversations
}

export type PageStat = {
  id: string
  name: string
  /** Total unread messages, or null when this Page could not be read. */
  unread: number | null
  conversations: number
  /** Populated only when the Page failed, so the UI can say which and why. */
  error?: string
}

/**
 * Every Page's conversations merged into one recency-sorted list.
 *
 * Uses allSettled rather than all: with six Pages, one losing its role or
 * hitting a throttle would otherwise blank the entire inbox. A failed Page is
 * reported in `pages` with a null unread count and simply contributes no rows.
 */
export async function listAllConversations(
  pages: FbPage[],
  // Must match the single-Page limit. Depth costs nothing extra - it is one
  // request per Page either way - and a shallower merged fetch made the
  // dropdown's unread counts change when you switched views.
  limit = 40,
): Promise<{ conversations: InboxConversation[]; pageStats: PageStat[]; allFailed: boolean }> {
  const settled = await Promise.allSettled(pages.map((p) => listConversations(p, limit)))

  const conversations: InboxConversation[] = []
  const pageStats: PageStat[] = []
  let failures = 0

  settled.forEach((r, i) => {
    const page = pages[i]
    if (r.status === 'fulfilled') {
      conversations.push(...r.value)
      pageStats.push({
        id: page.id,
        name: page.name,
        unread: r.value.reduce((n, c) => n + c.unreadCount, 0),
        conversations: r.value.length,
      })
    } else {
      failures++
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.log('[v0] inbox: page failed', page.name, message)
      pageStats.push({ id: page.id, name: page.name, unread: null, conversations: 0, error: message })
    }
  })

  // Attribution is attached inside listConversations, so it applies to the
  // single-Page view too - not just this merged one.
  conversations.sort((a, b) => new Date(b.updatedTime).getTime() - new Date(a.updatedTime).getTime())
  pageStats.sort((a, b) => a.name.localeCompare(b.name))

  return { conversations, pageStats, allFailed: pages.length > 0 && failures === pages.length }
}

type RawMessage = {
  id: string
  message?: string
  created_time?: string
  from?: { id: string; name?: string }
  attachments?: { data?: { mime_type?: string; image_data?: { url?: string }; file_url?: string }[] }
}

export async function listMessages(page: FbPage, conversationId: string, limit = 40): Promise<InboxMessage[]> {
  const url =
    `${GRAPH}/${conversationId}` +
    `?fields=messages.limit(${limit}){id,message,created_time,from,attachments}` +
    `&access_token=${encodeURIComponent(page.access_token)}`

  let json: { messages?: { data?: RawMessage[] } }
  try {
    json = await fbGet<{ messages?: { data?: RawMessage[] } }>(url, { cacheTtl: THREAD_TTL_MS })
  } catch (e) {
    asPermissionError(e)
  }

  const rows = json.messages?.data ?? []
  // Graph returns newest first; a chat transcript reads oldest first.
  return rows
    .map((m) => ({
      id: m.id,
      text: m.message ?? '',
      createdTime: m.created_time ?? '',
      fromPage: m.from?.id === page.id,
      fromName: m.from?.name ?? 'Unknown',
      attachments: (m.attachments?.data ?? []).map((a) => ({
        type: a.mime_type ?? 'file',
        url: a.image_data?.url ?? a.file_url ?? null,
      })),
    }))
    .reverse()
}

/**
 * Reply to a customer.
 *
 * Facebook only allows a free-form reply within 24h of the customer's last
 * message. Past that, an untagged send is rejected outright, so we retry once
 * with HUMAN_AGENT (the tag that exists precisely for a person answering
 * later). If that is also rejected the account lacks the tag, and the caller
 * gets the real reason rather than a silent failure.
 */
export async function sendReply(
  page: FbPage,
  recipientId: string,
  text: string,
): Promise<{ ok: true; usedHumanAgentTag: boolean }> {
  const url = `${GRAPH}/${page.id}/messages?access_token=${encodeURIComponent(page.access_token)}`

  const send = async (tag?: string) => {
    const body = new URLSearchParams({
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text }),
      messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
      ...(tag ? { tag } : {}),
    })
    // Writes are never cached and already retry on throttling.
    return fbWrite(url, { body })
  }

  try {
    await send()
    return { ok: true, usedHumanAgentTag: false }
  } catch (e) {
    const err = e as FbGraphError
    // 10 = outside allowed window / policy violation for untagged sends
    if (err?.code === 10 || /outside.*window|24.*hour|message tag/i.test(err?.message ?? '')) {
      await send('HUMAN_AGENT')
      return { ok: true, usedHumanAgentTag: true }
    }
    asPermissionError(e)
  }
}
