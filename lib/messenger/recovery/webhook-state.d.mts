type StoredMessage = { mid: string; page_id: string; psid: string; direction: string; body: string | null; attachments: unknown; created_at: string | Date; raw: unknown; is_echo: boolean; app_id: string | null }
type IncomingMessage = { mid: string; pageId: string; psid: string; direction: string; body: string | null; attachments?: unknown; createdAt: string; raw?: unknown; isEcho?: boolean; appId?: string | null }
export function firstRecoveryWebhook(stored: StoredMessage, incoming: IncomingMessage, observedAt: string): null | {
  body: string | null; attachments: unknown; createdAt: string; isEcho: boolean; appId: string | null; recoveredCreatedAt: string; raw: unknown
}
export function recoveredInboundIsUnread(createdAt: string, readThrough: string | null, lastOutgoingAt: string | Date | null): boolean
