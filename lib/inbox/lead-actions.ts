/**
 * One conversation contract for all three channels.
 *
 * Messenger, WhatsApp and comments each have their own transcript endpoint,
 * their own message shape and their own way of addressing a reply. The Leads
 * workspace shows them side by side, so the differences are resolved here
 * once instead of being branched on in the components.
 */

import type { UnifiedThread } from './unified'

/** A transcript line, after the per-channel shapes have been flattened. */
export type LeadMessage = {
  id: string
  text: string
  createdAt: string | null
  /** True when the business sent it - drives which side the bubble sits on. */
  fromBusiness: boolean
  /** Non-text payloads, already resolved to something renderable. */
  attachments: { type: string; url: string | null }[]
}

/**
 * Where to read this thread's history.
 *
 * Comments return null: a comment is a single post reply, not a thread, so
 * there is nothing to fetch and the UI renders the comment body itself.
 */
export function transcriptUrl(thread: UnifiedThread): string | null {
  switch (thread.channel) {
    case 'messenger':
      return (
        `/api/inbox/messages?id=${encodeURIComponent(thread.nativeId)}` +
        (thread.pageId ? `&pageId=${encodeURIComponent(thread.pageId)}` : '')
      )
    case 'whatsapp':
      return `/api/inbox/whatsapp?waId=${encodeURIComponent(thread.nativeId)}`
    default:
      return null
  }
}

type RawMessenger = {
  id: string
  text?: string
  createdTime?: string
  fromPage?: boolean
  attachments?: { type: string; url: string | null }[]
}

type RawWhatsApp = {
  id: string
  direction: 'in' | 'out'
  type: string
  body: string | null
  mediaId: string | null
  mediaMime: string | null
  createdAt: string
}

/** Flatten whichever payload the channel returned into LeadMessage[]. */
export function normaliseMessages(
  thread: UnifiedThread,
  payload: { messages?: unknown[] } | undefined,
): LeadMessage[] {
  const rows = payload?.messages ?? []

  if (thread.channel === 'whatsapp') {
    return (rows as RawWhatsApp[]).map((m) => ({
      id: m.id,
      text: m.body ?? '',
      createdAt: m.createdAt,
      fromBusiness: m.direction === 'out',
      // WhatsApp media is a private id, not a URL: it needs the auth-gated
      // proxy, because lookaside.fbsbx.com 401s without a bearer token.
      attachments:
        m.type !== 'text' && m.mediaId
          ? [{ type: m.mediaMime ?? m.type, url: `/api/inbox/whatsapp/media/${m.mediaId}` }]
          : [],
    }))
  }

  return (rows as RawMessenger[]).map((m) => ({
    id: m.id,
    text: m.text ?? '',
    createdAt: m.createdTime ?? null,
    fromBusiness: Boolean(m.fromPage),
    attachments: m.attachments ?? [],
  }))
}

/**
 * The transcript in the shape the AI endpoint wants.
 *
 * A comment has no history, so its own text becomes the single customer turn -
 * otherwise the model would be asked to reply to an empty conversation.
 */
export function toTurns(
  thread: UnifiedThread,
  messages: LeadMessage[],
): { from: 'customer' | 'business'; text: string }[] {
  if (thread.channel === 'comment') {
    return thread.snippet ? [{ from: 'customer', text: thread.snippet }] : []
  }
  return messages
    .filter((m) => m.text.trim())
    .map((m) => ({ from: m.fromBusiness ? 'business' : 'customer', text: m.text }))
}

export type SendResult = {
  success: boolean
  error?: string
  /** Messenger only: the reply went out under the human agent tag. */
  usedHumanAgentTag?: boolean
}

/**
 * Send a reply on whichever channel the lead came in on.
 *
 * Each channel is addressed differently: Messenger by PSID as a specific Page,
 * WhatsApp by wa_id (the number replies from the contact's own phone_number_id
 * server-side), and a comment by its own comment id.
 */
export async function sendLeadReply(thread: UnifiedThread, text: string): Promise<SendResult> {
  const body = text.trim()
  if (!body) return { success: false, error: 'Message is empty' }
  if (!thread.recipientId) {
    return { success: false, error: 'This lead has no address to reply to.' }
  }

  const post = async (url: string, payload: Record<string, unknown>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return (await res.json()) as SendResult
  }

  switch (thread.channel) {
    case 'messenger':
      return post('/api/inbox/send', {
        recipientId: thread.recipientId,
        text: body,
        pageId: thread.pageId ?? undefined,
      })
    case 'whatsapp':
      return post('/api/inbox/whatsapp', { waId: thread.recipientId, message: body })
    default:
      if (!thread.pageId) return { success: false, error: 'This comment has no Page attached.' }
      return post('/api/inbox/comments', {
        action: 'reply',
        commentId: thread.recipientId,
        pageId: thread.pageId,
        message: body,
      })
  }
}
