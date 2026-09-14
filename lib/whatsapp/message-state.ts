/** Delivery receipts may arrive out of order; receipt time is not send time. */
export function mergeWhatsAppStatus(current: string | null | undefined, incoming?: string | null): string | null {
  if (!incoming) return current ?? null
  if (!current) return incoming
  const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 }
  if (current === 'read' || incoming === 'read') return 'read'
  if (current === 'delivered' || incoming === 'delivered') return 'delivered'
  // A delayed 'sent' event does not prove recovery from a send failure.
  if (current === 'failed' || incoming === 'failed') return 'failed'
  return (rank[incoming] ?? 0) >= (rank[current] ?? 0) ? incoming : current
}

export function timestampMillis(value: unknown): number {
  if (value == null) return 0
  const n = new Date(value as string).getTime()
  return Number.isFinite(n) ? n : 0
}

export function objectValue(value: unknown): Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : {}
}

export function isReceiptOnly(message: { type?: string; body?: string | null; media_id?: string | null } | null): boolean {
  return Boolean(message && message.type === 'external' && !message.body && !message.media_id)
}

export function mergeReceiptRaw(raw: unknown, status: string, at: string, error?: string): Record<string, any> {
  const previous = objectValue(raw)
  const metadata = objectValue(previous._inbox)
  const receipts = objectValue(metadata.receipts)
  const recorded = objectValue(receipts[status])
  // Keep each known receipt's own event timestamp, not its arrival order.
  const receipt = timestampMillis(at) >= timestampMillis(recorded.at)
    ? { at, ...(error ? { error } : {}) } : recorded
  const known = ['sent', 'delivered', 'read', 'failed'].includes(status)
  return { ...previous, _inbox: { ...metadata,
    receipts: { ...receipts, [known ? status : 'other']: known ? receipt : { status, ...receipt } },
  } }
}

export class WhatsAppIdentityError extends Error {
  constructor() { super('WhatsApp message identity does not match its owning number and customer') }
}

export function validateMessageIdentity(
  message: { wa_id: string; phone_number_id?: string | null; direction?: string },
  waId: string, phoneNumberId: string, direction: 'in' | 'out',
) {
  if (!waId || !phoneNumberId || message.wa_id !== waId ||
      (message.phone_number_id && message.phone_number_id !== phoneNumberId) ||
      (message.direction && message.direction !== direction)) throw new WhatsAppIdentityError()
}
