export const GREEN_SCOPES = [
  { key: 'destockage', env: 'DESTOCKAGE', phoneNumberId: '968962882975955', businessPhone: '23052500684', pageId: '471644012696537' },
  { key: 'made_by_moris', env: 'MADE_BY_MORIS', phoneNumberId: '1090043534186338', businessPhone: '23059406784', pageId: '308584892331429' },
] as const
export type GreenScope = typeof GREEN_SCOPES[number]
export type GreenBinding = GreenScope & { instanceId: string; apiUrl: string; apiToken: string; webhookToken: string; accountId: string; enabled: boolean; version: number }
export type GreenOrigin = 'webhook' | 'history' | 'journal'
export type NormalizedObservation = { providerMessageId: string; providerChatId: string; waId: string | null; direction: 'in' | 'out'; kind: 'text' | 'unsupported' | 'deleted'; text: string | null; providerAcceptedAt: string | null; edited: boolean; eventType: string; profileName?:string|null }
export type GreenEvent = { eventKey: string; eventType: string; receivedAt: string; providerTimestamp: string | null; payloadHash: string; observation: NormalizedObservation | null; quarantineReason: string | null; raw: unknown; origin: GreenOrigin }
export const GREEN_REASONS = ['OBSERVATION_MODE','COVERAGE_UNKNOWN','NOT_CONFIGURED','PAUSED','CONNECTION_UNVERIFIED','ORIGINAL_CONTENT_MISSING','UNSUPPORTED_CONTENT','HISTORY_TRUNCATED','PROVIDER_CONFLICT','PENDING_RECONCILIATION','NO_READABLE_CONTEXT','PROVIDER_CONTEXT_UNALIGNED'] as const
export type GreenBlockReason = typeof GREEN_REASONS[number]
export class GreenError extends Error {
  constructor(public code: string, public status = 400) { super(code); this.name = 'GreenError' }
}
export function greenFail(code: string, status = 400): never { throw new GreenError(code,status) }
export function greenScope(phoneNumberId: unknown): GreenScope {
  const scope = GREEN_SCOPES.find(s => s.phoneNumberId === phoneNumberId)
  if (!scope) greenFail('BUSINESS_NOT_CONFIGURED',403)
  return scope
}
export function validCustomer(waId: unknown): waId is string { return typeof waId === 'string' && /^\d{5,20}$/.test(waId) }
export function customerFromChat(chatId: string): string | null {
  const match = /^(\d{5,20})@c\.us$/.exec(chatId)
  return match?.[1] ?? null
}
export type GreenMessageView = { id: string; source: 'green-api'; providerInstanceId: string; providerChatId: string; providerMessageId: string; direction: 'in'|'out'; kind:'text'|'unsupported'|'deleted'; text:string|null; providerAcceptedAt:string|null; sentAt:null; observedAt:string; edited:boolean; conflicted:boolean; canonicalReceiptMatch:'unverified' }
export type GreenReadiness = { allowed:false; canDraft:boolean; reasons:GreenBlockReason[]; draftReasons:GreenBlockReason[]; contextVersion:number; unresolvedOriginalCount:number; unsupportedOriginalCount:number; canonicalHasMore:boolean; providerConflictCount:number; pendingProviderCount:number; providerUnalignedCount:number; coverage:'unknown'; mode:'observation' }
