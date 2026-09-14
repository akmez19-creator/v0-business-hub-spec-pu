export const AUTOPILOT_BUSINESSES = {
  made_by_moris: { code: 'MBM', name: 'Made By Moris', pageId: '308584892331429', phoneNumberId: '1090043534186338' },
  destockage: { code: 'DBM', name: 'Destockage By Moris', pageId: '471644012696537', phoneNumberId: '968962882975955' },
} as const
export type BusinessKey = keyof typeof AUTOPILOT_BUSINESSES
export type AutopilotScope = { businessKey: BusinessKey } & (
  { channel: 'messenger'; pageId: string; psid: string } |
  { channel: 'whatsapp'; phoneNumberId: string; waId: string }
)
export type JobState = 'queued' | 'processing' | 'needs_review' | 'sending' | 'sent' | 'failed' | 'unknown'
export type AutopilotConfig = {
  businessKey: BusinessKey; name: string; version: number; enabled: boolean
  deliveryDate: string | null; maxDailyReplies: number; repliesToday: number; reservedToday: number
  freeDelivery: true; enabledAt: string | null; lastRunAt: string | null; reason: string | null
}
export type AutopilotJob = {
  id: string; businessKey: BusinessKey; scope: AutopilotScope; conversationKey: string
  customerName: string | null; inboundMessageId: string; state: JobState; reason: string | null
  configVersion: number; contextFingerprint: string; leaseToken: string | null; leaseExpiresAt: string | null
  sendToken: string | null; providerMessageId: string | null; draftText: string | null; updatedAt: string
}
export type ConfigPatch = { enabled?: boolean; deliveryDate?: string | null; maxDailyReplies?: number }
export const AUTOPILOT_LIMITS = { defaultDailyReplies: 30, maxDailyReplies: 500, leaseSeconds: 120, maxJobs: 50 } as const
export class AutopilotError extends Error {
  constructor(public code: string, public status = 400) { super(code) }
}
export function businessOf(key: unknown) {
  if (key !== 'made_by_moris' && key !== 'destockage') throw new AutopilotError('unknown_business')
  return AUTOPILOT_BUSINESSES[key]
}
export function scopeIdentity(scope: AutopilotScope) {
  const business = businessOf(scope?.businessKey)
  const owner = scope.channel === 'messenger' ? scope.pageId : scope.channel === 'whatsapp' ? scope.phoneNumberId : ''
  const customer = scope.channel === 'messenger' ? scope.psid : scope.channel === 'whatsapp' ? scope.waId : ''
  if (!/^\d{5,30}$/.test(owner ?? '') || !/^\d{5,30}$/.test(customer ?? '') ||
    owner !== (scope.channel === 'messenger' ? business.pageId : business.phoneNumberId))
    throw new AutopilotError('invalid_business_scope', 403)
  return { business, owner, customer, conversationKey: `${scope.channel}:${owner}:${customer}` }
}
export function assertFingerprint(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) throw new AutopilotError('invalid_context_fingerprint')
}
export function assertMessageId(value: string) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u001f]/.test(value))
    throw new AutopilotError('invalid_message_identity')
}
export function validateConfigPatch(patch: ConfigPatch) {
  if (!patch || Object.keys(patch).some(k => !['enabled', 'deliveryDate', 'maxDailyReplies'].includes(k)))
    throw new AutopilotError('invalid_config_patch')
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new AutopilotError('invalid_enabled')
  if (patch.maxDailyReplies !== undefined && (!Number.isInteger(patch.maxDailyReplies) || patch.maxDailyReplies < 1 || patch.maxDailyReplies > AUTOPILOT_LIMITS.maxDailyReplies))
    throw new AutopilotError('invalid_daily_limit')
  if (patch.deliveryDate !== undefined && patch.deliveryDate !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(patch.deliveryDate) || !Number.isFinite(Date.parse(patch.deliveryDate)) || new Date(patch.deliveryDate).toISOString().slice(0,10) !== patch.deliveryDate))
    throw new AutopilotError('invalid_delivery_date')
}
