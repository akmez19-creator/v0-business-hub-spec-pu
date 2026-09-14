import type { OrderDraft } from './quick-order-panel'
import type { UnifiedThread } from '@/lib/inbox/unified'
import { whatsappConversationKey } from '@/lib/inbox/whatsapp-identity'

export type AssistResult = {
  success: boolean
  error?: string
  reply?: string
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
  unmatched: AssistResult['unmatched']
  sending: boolean
}

export function newLeadSession(): LeadSession {
  return {
    draft: '', draftVersion: 0, draftTouched: false, draftOrigin: 'manual',
    order: { customerName: '', contact1: '', contact2: '', region: '', productId: null, qty: 1, notes: '', deliveryDate: '' },
    orderTouched: {}, orderOperation: { saving: false, created: null, previousCreated: null, business: '' },
    assisting: false, assisted: false, assistRequest: 0, assistError: null,
    unmatched: null, sending: false,
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

export function beginAnotherOrder(state: OrderOperation): OrderOperation {
  return state.saving || !state.created ? state : { ...state, previousCreated: state.created, created: null }
}

/** An answer belongs to one request; edits made while it ran always win. */
export function applyAssistResult(state: LeadSession, request: number, draftVersion: number, force: boolean, result: AssistResult): LeadSession {
  if (state.assistRequest !== request) return state
  const next = { ...state, assisting: false, assistError: result.success ? null : result.error || 'Could not draft a reply' }
  if (!result.success) return next
  if (state.draftVersion === draftVersion && (force || !state.draftTouched)) {
    next.draft = result.reply ?? ''
    next.draftOrigin = 'ai'
  }
  next.unmatched = result.unmatched ?? null
  if (result.order) {
    next.order = { ...state.order }
    for (const key of Object.keys(result.order) as (keyof OrderDraft)[]) {
      if (!state.orderTouched[key]) Object.assign(next.order, { [key]: result.order[key] })
    }
  }
  return next
}

export function completeSend(state: LeadSession, sentText: string, draftVersion: number): LeadSession {
  if (state.draftVersion !== draftVersion || state.draft !== sentText) return { ...state, sending: false }
  return { ...state, sending: false, draft: '', draftVersion: state.draftVersion + 1, draftTouched: true, draftOrigin: 'manual' }
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
