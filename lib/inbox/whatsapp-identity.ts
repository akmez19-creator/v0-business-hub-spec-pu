export type WhatsAppIdentity = { waId: string; phoneNumberId?: string | null }

/** The server authorizes this pair; the client never infers its business from a name. */
export function whatsappIdentity(value: WhatsAppIdentity): { waId: string; phoneNumberId: string } | null {
  return typeof value.waId === 'string' && /^\d{5,20}$/.test(value.waId) &&
    typeof value.phoneNumberId === 'string' && /^\d{5,30}$/.test(value.phoneNumberId)
    ? { waId: value.waId, phoneNumberId: value.phoneNumberId } : null
}

export function whatsappConversationKey(value: WhatsAppIdentity): string {
  const identity = whatsappIdentity(value)
  return identity ? `whatsapp:${identity.phoneNumberId}:${identity.waId}`
    : `whatsapp:unscoped:${encodeURIComponent(value.waId)}`
}

export function whatsappTranscriptKey(value: WhatsAppIdentity): string | null {
  const identity = whatsappIdentity(value)
  return identity ? `/api/inbox/whatsapp?waId=${encodeURIComponent(identity.waId)}&phoneNumberId=${encodeURIComponent(identity.phoneNumberId)}` : null
}

export function whatsappReplyUnavailable(value: WhatsAppIdentity & { canSend?: boolean }): string | null {
  if (!whatsappIdentity(value)) return 'Choose a conversation with a confirmed business number before replying. Your draft is kept here.'
  if (value.canSend === false) return 'This business number is read-only in Akmez. Your draft is kept here.'
  if (value.canSend !== true) return 'Sending availability is not confirmed. Refresh this conversation before replying.'
  return null
}
