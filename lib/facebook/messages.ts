import { getAdRefs } from '@/lib/messenger/ad-refs'
import { findNotice, resolveCommentOrigins } from './comment-origin'
import { fbGet, fbWrite, FbGraphError } from './graph'
import { getProductMatcher } from '@/lib/products/catalogue'
import { getCampaignsForAds, productFromAdName } from './post-ads'
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
  /** Canonical catalogue product, when the label resolved. */
  productId?: string | null
  productCategory?: string | null
  campaignId?: string | null
  campaignName?: string | null
  /** True when the ad this thread came from is still running. */
  campaignActive?: boolean
  /**
   * True when the customer spoke last, i.e. the thread is waiting on YOU.
   * This is the single most commercially useful signal in the inbox.
   */
  lastFromCustomer?: boolean
  /**
   * When this chat was last seen in the Meta Business Suite "Done" folder.
   * Effective only while it is not older than `updatedTime`: a newer customer
   * message reopens the chat, exactly as Business Suite does.
   */
  doneAt?: string | null
}

export type InboxMessage = {
  id: string
  text: string
  createdTime: string
  /** True when the Page sent it, false when the customer did. */
  fromPage: boolean
  fromName: string
  attachments: { type: string; url: string | null; title?: string | null }[]
}

/**
 * Distinguishes "you have not granted the messaging permission yet" from every
 * other Graph failure. Facebook reports the missing scope as a generic #200,
 * which is indistinguishable from a genuine role problem unless we look at the
 * message text - so the UI can render setup instructions instead of an error.
 */
export class MessagingPermissionError extends Error {
  code: number | undefined
  subcode: number | undefined
  fbtraceId: string | undefined
  constructor(message: string, details?: FbGraphError) {
    super(message)
    this.name = 'MessagingPermissionError'
    this.code = details?.code
    this.subcode = details?.subcode
    this.fbtraceId = details?.fbtraceId
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
    // Never reply from another business when an explicit selection is stale.
    return pages.find((p) => p.id === pageId) ?? null
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
  messages?: { data?: { message?: string; created_time?: string; from?: { id?: string } }[] }
}

export async function listConversations(page: FbPage, limit = 40): Promise<InboxConversation[]> {
  // messages{} rides along on the same call so we can spot the "X commented
  // on your post" notice without a second round trip per thread. Graph
  // returns messages newest-first, so the FIRST notice found is the latest
  // one - which is exactly the product the customer is asking about now.
  const url =
    `${GRAPH}/${page.id}/conversations` +
    `?fields=id,snippet,updated_time,unread_count,message_count,participants,` +
    // `from` rides along on the SAME call - it is what tells us whether the
    // thread is waiting on us, with no extra request per conversation.
    `${encodeURIComponent('messages.limit(15){message,created_time,from}')}` +
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
    // Graph returns messages newest-first, so [0] is the latest. If it did not
    // come from the Page, the customer spoke last and we owe them a reply.
    const newest = c.messages?.data?.[0]
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
      lastFromCustomer: newest?.from?.id ? newest.from.id !== page.id : false,
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
    const matchProduct = await getProductMatcher()
    for (const c of conversations) {
      const ref = c.customer?.id ? refs.get(c.customer.id) : undefined
      if (!ref) continue
      c.adId = ref.adId
      c.adName = ref.adName
      c.product = productFromAdName(ref.adName)
      c.productSource = 'ad-click'
      const match = matchProduct(c.product)
      c.productId = match?.productId ?? null
      c.productCategory = match?.category ?? null
    }

    // Campaign + live status for whatever ads ended up attached.
    const adIds = conversations.map((c) => c.adId).filter((id): id is string => Boolean(id))
    if (adIds.length > 0) {
      const campaigns = await getCampaignsForAds(adIds)
      for (const c of conversations) {
        const campaign = c.adId ? campaigns.get(c.adId) : undefined
        if (!campaign) continue
        c.campaignId = campaign.campaignId
        c.campaignName = campaign.campaignName
        c.campaignActive = campaign.active
      }
    }
  } catch (error) {
    // Attribution is decoration; never let it take down the inbox.
    console.log('[v0] inbox: ad attribution lookup failed', error)
  }

  // Fallback for threads that began as a comment private-reply: the notice
  // carries a comment_id that resolves to the exact post. Only fills gaps -
  // a real ad click still wins, since it needs no lookup at all.
  try {
    const pending = conversations
      .filter((c) => !c.product)
      .map((c) => ({ id: c.id, notice: noticeByConversation.get(c.id) }))
      .filter((t): t is { id: string; notice: string } => Boolean(t.notice))

    if (pending.length > 0) {
      const origins = await resolveCommentOrigins(page, pending)
      for (const c of conversations) {
        const origin = origins.get(c.id)
        if (!origin?.product) continue
        c.postId = origin.postId
        c.adId = origin.ad?.adId ?? null
        c.adName = origin.ad?.adName ?? null
        c.product = origin.product
        c.productSource = 'comment'
        c.productId = origin.productId
        c.productCategory = origin.productCategory
        c.campaignId = origin.ad?.campaignId ?? null
        c.campaignName = origin.ad?.campaignName ?? null
        c.campaignActive = origin.ad?.adStatus === 'ACTIVE'
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
  rateLimited?: boolean
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
      pageStats.push({ id: page.id, name: page.name, unread: null, conversations: 0, error: message,
        rateLimited: r.reason instanceof FbGraphError && r.reason.isRateLimit })
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

/** Resolve a webhook-only customer using the owning Page, not the recent-list cutoff. */
export async function conversationForCustomer(page: FbPage, psid: string): Promise<string | null> {
  const url = `${GRAPH}/${page.id}/conversations?${new URLSearchParams({
    user_id: psid, fields: 'id,participants', limit: '10', access_token: page.access_token,
  })}`
  try {
    const json = await fbGet<{ data?: { id: string; participants?: { data?: InboxParticipant[] } }[] }>(url,
      { cacheTtl: 0, staleWhenLimited: false })
    return json.data?.find((conversation) =>
      conversation.participants?.data?.some((participant) => participant.id === psid))?.id ?? null
  } catch (e) {
    asPermissionError(e)
  }
}

export async function listMessages(
  page: FbPage, conversationId: string, limit = 40, options: { fresh?: boolean } = {},
): Promise<InboxMessage[]> {
  const url =
    `${GRAPH}/${conversationId}` +
    `?fields=messages.limit(${limit}){id,message,created_time,from,attachments}` +
    `&access_token=${encodeURIComponent(page.access_token)}`

  let json: { messages?: { data?: RawMessage[] } }
  try {
    json = await fbGet<{ messages?: { data?: RawMessage[] } }>(url,
      { cacheTtl: options.fresh ? 0 : THREAD_TTL_MS, staleWhenLimited: !options.fresh })
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
 * Send once using the standard RESPONSE path. A generic permission error is
 * not evidence of HUMAN_AGENT approval or eligibility. Never escalate tags or
 * retry a send automatically; a lost response can leave delivery uncertain.
 */
export async function sendReply(
  page: FbPage,
  recipientId: string,
  text: string,
): Promise<{ ok: true; usedHumanAgentTag: boolean; messageId: string | null }> {
  return sendMessengerMessage(page, recipientId, { text }, text)
}

/**
 * A photo or video by public URL. Messenger has no captions, so callers send
 * the text as a second message afterwards.
 */
export async function sendAttachment(
  page: FbPage,
  recipientId: string,
  media: { url: string; kind: 'image' | 'video' },
): Promise<{ ok: true; usedHumanAgentTag: boolean; messageId: string | null }> {
  return sendMessengerMessage(page, recipientId,
    { attachment: { type: media.kind, payload: { url: media.url, is_reusable: false } } }, media.url)
}

/** Meta refused because the customer has not messaged the Page within the last 24 hours. */
export class MessagingWindowClosedError extends Error {
  constructor(message: string, readonly cause: FbGraphError) { super(message) }
}

/**
 * Business Suite's "Message" button on a commenter. A commenter has never
 * messaged the Page, so there is no 24-hour window; instead Meta allows ONE
 * private reply per comment within 7 days, delivered into the same Messenger
 * thread. Text only.
 *
 * MEASURED 15 Sep 2026: the old `/{comment_id}/private_replies` edge is gone
 * in Graph v21 ("nonexisting field", code 100/33) even when the comment reports
 * `can_reply_privately: true`. Private replies now go through the Send API with
 * the comment as the recipient instead of a PSID.
 */
export async function sendPrivateReply(
  page: FbPage,
  commentId: string,
  text: string,
): Promise<{ ok: true; messageId: string | null }> {
  // Bare ids come from the "created this chat because X commented" notice;
  // the comments table stores Graph's composite `{post_id}_{comment_id}`.
  // The Send API accepts both.
  if (!/^\d{5,40}(_\d{5,40})?$/.test(commentId)) throw new Error('The comment this chat was created from could not be identified.')
  const url = `${GRAPH}/${page.id}/messages?access_token=${encodeURIComponent(page.access_token)}`
  const body = new URLSearchParams({
    recipient: JSON.stringify({ comment_id: commentId }),
    message: JSON.stringify({ text }),
  })
  try {
    const res = await fbWrite<{ message_id?: unknown }>(url, { body, retries: 0 })
    const id = typeof res?.message_id === 'string' && res.message_id.trim() && res.message_id.length <= 1024 ? res.message_id : null
    return { ok: true, messageId: id }
  } catch (e) {
    if (!(e instanceof FbGraphError)) throw new Error('The private reply response could not be confirmed. Check the conversation before sending again.')
    const providerMessage = typeof e.message === 'string' ? e.message : ''
    // Meta allows exactly one private reply per comment; a second attempt or an
    // expired comment (7 days) comes back as code 10 with its own subcode.
    const description = /already|once|previously/i.test(providerMessage)
      ? 'Meta allows only one private reply per comment and one was already sent. The customer must message the Page before you can reply again.'
      : /expired|7 days|too old/i.test(providerMessage) || e.subcode === 2018278
      ? 'The 7-day private-reply period for this comment has ended. Reply under the comment publicly or wait for the customer to message.'
      : e.code === 200 || /pages_messaging|appropriate role/i.test(providerMessage)
      ? 'Meta rejected the Messenger permission or Page role for private replies. Check the connection before sending again.'
      : 'Meta rejected the private reply to this comment. Check the comment before sending again.'
    const diagnostics = [e.code === undefined ? null : `code ${e.code}`, e.subcode === undefined ? null : `subcode ${e.subcode}`].filter(Boolean)
    throw new FbGraphError(description + (diagnostics.length ? ` (Meta ${diagnostics.join('; ')}.)` : ''), e.code, { subcode: e.subcode })
  }
}

async function sendMessengerMessage(
  page: FbPage,
  recipientId: string,
  message: Record<string, unknown>,
  /** The submitted content, so a provider trace echoing it is never surfaced. */
  submitted: string,
): Promise<{ ok: true; usedHumanAgentTag: boolean; messageId: string | null }> {
  const text = submitted
  const url = `${GRAPH}/${page.id}/messages?access_token=${encodeURIComponent(page.access_token)}`

  const body = new URLSearchParams({
    recipient: JSON.stringify({ id: recipientId }),
    message: JSON.stringify(message),
    messaging_type: 'RESPONSE',
  })

  // Meta returns the message_id it assigned. Surfacing it lets the caller cache
  // the sent reply under Meta's OWN id, so when the echo of this same message
  // arrives moments later it collides on the primary key and is ignored rather
  // than showing the reply twice.
  const idOf = (r: unknown) => {
    const id = (r as { message_id?: unknown } | undefined)?.message_id
    return typeof id === 'string' && id.trim() && id.length <= 1024 ? id : null
  }

  try {
    const res = await fbWrite(url, { body, retries: 0 })
    const messageId = idOf(res)
    if (!messageId) throw new Error('Unconfirmed Messenger response')
    return { ok: true, usedHumanAgentTag: false, messageId }
  } catch (e) {
    // Do not expose arbitrary error strings: transport errors can contain the
    // token-bearing URL, and provider descriptions can echo submitted content.
    if (!(e instanceof FbGraphError)) {
      throw new Error('The Messenger send response could not be confirmed. Check the conversation before sending again.')
    }
    const code = typeof e.code === 'number' && Number.isSafeInteger(e.code) && e.code >= 0 ? e.code : undefined
    const trace = e.fbtraceId && ![page.access_token, encodeURIComponent(page.access_token), text]
      .filter(Boolean).some((secret) => e.fbtraceId!.includes(secret)) ? e.fbtraceId : undefined
    const diagnostics = [code === undefined ? null : `code ${code}`,
      e.subcode === undefined ? null : `subcode ${e.subcode}`, trace ? `trace ${trace}` : null].filter(Boolean)
    const providerMessage = typeof e.message === 'string' ? e.message : ''
    const missingPermission = code === 200 || /pages_messaging|appropriate role/i.test(providerMessage)
    const windowClosed = e.subcode === 2018278 || /outside.*window|24.*hour/i.test(providerMessage)
    const description = code === undefined
      ? 'The Messenger send response could not be confirmed. Check the conversation before sending again.'
      : missingPermission
      ? 'Meta rejected the Messenger permission or Page role. Check the connection before sending again.'
      : /outside.*window|24.*hour/i.test(providerMessage) || e.subcode === 2018278
        // MEASURED 16 Sep 2026: the app has pages_messaging but NOT human_agent,
        // so the 7-day human-agent window Business Suite uses is not open to us.
        ? 'More than 24 hours since the customer last wrote, so Meta lets only Business Suite reach them now (its 7-day human-agent window). Reply from Business Suite, or wait for their next message. To send from here in future, the app needs the human_agent permission approved by Meta.'
        : /HUMAN_AGENT.*approv|approv.*HUMAN_AGENT/i.test(providerMessage)
          ? 'Meta reported that HUMAN_AGENT approval is missing. No alternative tag was attempted.'
          : code === 190
            ? 'Meta rejected the Messenger connection credentials. Reconnect the authorised account before sending again.'
            : e.isRateLimit
              ? 'Meta temporarily limited Messenger requests. No automatic retry was made.'
              : 'Meta rejected this Messenger reply. Check the original error details before sending again.'
    const safeError = new FbGraphError(description + (diagnostics.length ? ` (Meta ${diagnostics.join('; ')}.)` : ''), code,
      { subcode: e.subcode, fbtraceId: trace })
    if (missingPermission) throw new MessagingPermissionError(safeError.message, safeError)
    if (windowClosed) throw new MessagingWindowClosedError(safeError.message, safeError)
    throw safeError
  }
}
