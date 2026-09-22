import type { OrderDraft } from './quick-order-panel'
import type { UnifiedThread } from '@/lib/inbox/unified'
import { whatsappConversationKey } from '@/lib/inbox/whatsapp-identity'

export type AssistResult = {
  success: boolean
  error?: string
  /** ATTACHMENT_UNREAD: the AI could not open the latest customer media; the agent may review and waive. */
  code?: string
  reply?: string
  /** Set when a standby model produced the draft; shown beside the AI label. */
  notice?: string | null
  order?: OrderDraft
  unmatched?: { product: string | null; locality: string | null } | null
}

export type OrderOperation = {
  saving: boolean
  created: { proformaLink: string | null } | null
  previousCreated: { proformaLink: string | null } | null
  business: string
}

export type LeadSession = {
  draft: string
  draftVersion: number
  draftTouched: boolean
  draftOrigin: 'manual' | 'ai' | 'order'
  order: OrderDraft
  orderTouched: Partial<Record<keyof OrderDraft, boolean>>
  orderOperation: OrderOperation
  assisting: boolean
  assisted: boolean
  assistRequest: number
  assistError: string | null
  assistNotice: string | null
  unmatched: AssistResult['unmatched']
  sending: boolean
  /** The server tried to read the latest customer photo/video and could not (expired link, reader down). */
  attachmentsUnread: boolean
  /** A staged photo/video to send with the draft as its caption. */
  attachment: { url: string; kind: 'image' | 'video'; mime: string; label: string } | null
}

export function newLeadSession(): LeadSession {
  return {
    draft: '', draftVersion: 0, draftTouched: false, draftOrigin: 'manual',
    order: { customerName: '', contact1: '', contact2: '', region: '', productId: null, qty: 1, notes: '', deliveryDate: '', salesType: 'sale', sourceDeliveryId: null },
    orderTouched: {}, orderOperation: { saving: false, created: null, previousCreated: null, business: '' },
    assisting: false, assisted: false, assistRequest: 0, assistError: null, assistNotice: null,
    unmatched: null, sending: false, attachmentsUnread: false, attachment: null,
  }
}

/** Graph may later replace a synthetic conversation ID; the customer remains the same. */
export function stableThreadKey(thread: Pick<UnifiedThread, 'key' | 'channel' | 'pageId' | 'recipientId' | 'phoneNumberId'>): string {
  if (thread.channel === 'whatsapp') return whatsappConversationKey({ waId: thread.recipientId ?? '', phoneNumberId: thread.phoneNumberId })
  return thread.channel === 'messenger' && thread.pageId && thread.recipientId
    ? `messenger:${thread.pageId}:${thread.recipientId}`
    : thread.key
}

export function stableMessengerTranscriptUrl(thread: Pick<UnifiedThread, 'channel' | 'pageId' | 'recipientId'>): string | null {
  return thread.channel === 'messenger' && thread.pageId && thread.recipientId
    ? '/api/inbox/messages?id=' + encodeURIComponent('psid:' + thread.recipientId) + '&pageId=' + encodeURIComponent(thread.pageId)
    : null
}

/** Local Mauritian mobile (8 digits starting 5) from a wa_id, or '' if not one. */
function localMobileFromWaId(waId: string | null | undefined): string {
  if (!waId) return ''
  let digits = waId.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('230')) digits = digits.slice(3)
  return /^5\d{7}$/.test(digits) ? digits : ''
}

/**
 * Pre-fill the order from what the thread already tells us: the WhatsApp
 * number as the phone, and the ad's resolved product. Only fills a field that
 * is still empty AND untouched, and deliberately does NOT mark it touched, so
 * the AI draft and the agent both still override it. A no-op returns the same
 * reference so the effect that calls this cannot loop.
 */
export function seedOrderFromThread(state: LeadSession, thread: Pick<UnifiedThread, 'channel' | 'recipientId' | 'productId'>): LeadSession {
  const phone = thread.channel === 'whatsapp' ? localMobileFromWaId(thread.recipientId) : ''
  const next = { ...state.order }
  let changed = false
  if (phone && !state.order.contact1 && !state.orderTouched.contact1) { next.contact1 = phone; changed = true }
  if (thread.productId && !state.order.productId && !state.orderTouched.productId) { next.productId = thread.productId; changed = true }
  return changed ? { ...state, order: next } : state
}

/** What the customer's last delivery recorded fills only EMPTY, untouched fields and never marks them touched,
 * so what the agent types and what the AI reads in THIS conversation both still win. */
export type RecordSeedFields = Partial<Pick<OrderDraft, 'customerName' | 'contact2' | 'region' | 'notes' | 'deliveryDate'>>

export function seedOrderFromRecord(state: LeadSession, fields: RecordSeedFields): LeadSession {
  const next = { ...state.order }
  let changed = false
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const value = fields[key]
    if (value && !state.order[key] && !state.orderTouched[key]) { next[key] = value; changed = true }
  }
  return changed ? { ...state, order: next } : state
}

export function beginAnotherOrder(state: OrderOperation): OrderOperation {
  return state.saving || !state.created ? state : { ...state, previousCreated: state.created, created: null }
}

/** An answer belongs to one request; edits made while it ran always win. */
export function applyAssistResult(state: LeadSession, request: number, draftVersion: number, force: boolean, result: AssistResult): LeadSession {
  if (state.assistRequest !== request) return state
  const next = { ...state, assisting: false, assistError: result.success ? null : result.error || 'Could not draft a reply', assistNotice: result.success ? result.notice ?? null : null }
  if (!result.success) {
    // Drafting no longer waits on unreadable media, so this should not come back;
    // if it ever does, remember the unread media AND keep the error visible,
    // because there is no longer a waiver banner to explain the empty draft.
    if (result.code === 'ATTACHMENT_UNREAD') return { ...next, attachmentsUnread: true }
    return next
  }
  if (state.draftVersion === draftVersion && (force || !state.draftTouched)) {
    next.draft = result.reply ?? ''
    next.draftOrigin = 'ai'
  }
  next.unmatched = result.unmatched ?? null
  if (result.order) {
    next.order = { ...state.order }
    for (const key of Object.keys(result.order) as (keyof OrderDraft)[]) {
      const value = result.order[key]
      // '' / null from the AI means "not said in this conversation", not "clear it":
      // it must not wipe the ad's product or a returning client's recorded details.
      const blank = value === '' || value === null || value === undefined
      if (!state.orderTouched[key] && !(blank && state.order[key])) Object.assign(next.order, { [key]: value })
    }
  }
  return next
}

export function completeSend(state: LeadSession, sentText: string, draftVersion: number): LeadSession {
  // The attachment went out with this send whatever happened to the text since.
  if (state.draftVersion !== draftVersion || state.draft !== sentText) return { ...state, sending: false, attachment: null }
  return { ...state, sending: false, draft: '', draftVersion: state.draftVersion + 1, draftTouched: true, draftOrigin: 'manual', attachment: null }
}

/** Failed refreshes throw so SWR keeps its last successful cached value. */
export async function readInbox(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.success === false) {
    throw new Error(body?.error || (response.status === 401 ? 'Please sign in again to update your inbox.' : 'Inbox could not update. Please retry.'))
  }
  return body
}
