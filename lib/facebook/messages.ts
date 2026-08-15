import { fbGet, fbWrite, FbGraphError } from './graph'
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
}

export async function listConversations(page: FbPage, limit = 40): Promise<InboxConversation[]> {
  const url =
    `${GRAPH}/${page.id}/conversations` +
    `?fields=id,snippet,updated_time,unread_count,message_count,participants` +
    `&limit=${limit}&access_token=${encodeURIComponent(page.access_token)}`

  let json: { data?: RawConversation[] }
  try {
    json = await fbGet<{ data?: RawConversation[] }>(url, { cacheTtl: LIST_TTL_MS })
  } catch (e) {
    asPermissionError(e)
  }

  const now = Date.now()
  return (json.data ?? []).map((c) => {
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
    }
  })
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
