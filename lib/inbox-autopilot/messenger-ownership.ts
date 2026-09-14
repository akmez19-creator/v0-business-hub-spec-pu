import 'server-only'
import { scopeIdentity, type AutopilotScope } from './contract'

type MessengerScope = Extract<AutopilotScope, { channel: 'messenger' }>
export const AKMEZ_MESSENGER_APP_ID = '1284520097159203'
export type OwnershipApproval = { approvedReply: true; expectedVersion: number }
export type OwnershipResult = { ok: true; disposition: 'already_owned' | 'acquired'; checkedAt: number } |
  { ok: false; reason: 'messenger_control_not_approved' | 'messenger_control_paused' | 'messenger_control_unverified' |
    'messenger_takeover_not_allowed' | 'messenger_control_rejected' | 'messenger_control_rate_limited' |
    'messenger_control_unavailable' | 'messenger_takeover_unconfirmed'; takeAttempted: boolean; code?: number; subcode?: number }
export type OwnershipDependencies = {
  getPage(pageId: string): Promise<{ id: string; access_token: string } | null>
  /** Read current server config, exact expected version and exact conversation takeover. No browser assertion. */
  controlsAllow(scope: MessengerScope, expectedVersion: number): Promise<boolean>
  /** Separate, verified Page-routing permission. No default permission or automatic routing change. */
  takeoverAllowed?(scope: MessengerScope): Promise<boolean>
  fetch?: typeof fetch
  now?: () => number
}
type Reason = Extract<OwnershipResult, { ok: false }>['reason']
class OwnershipError extends Error {
  constructor(public reason: Reason, public code?: number, public subcode?: number) { super(reason) }
}
const safeCode = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647 ? value : undefined
type OwnershipRequestPhase = 'initial_owner_read' | 'take_request' | 'owner_readback'
function recordOwnershipRejection(phase: OwnershipRequestPhase, status: unknown, code: unknown, subcode: unknown) {
  try {
    const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
    const numericCode = safeCode(code), numericSubcode = safeCode(subcode)
    console.log(JSON.stringify({ event: 'inbox_autopilot_ownership_rejected', schema: 1, phase,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(numericCode !== undefined ? { code: numericCode } : {}),
      ...(numericSubcode !== undefined ? { subcode: numericSubcode } : {}) }))
  } catch { /* Logging must never change ownership decisions, requests or retries. */ }
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
function appId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) value = String(value)
  return typeof value === 'string' && /^\d{5,30}$/.test(value) ? value : null
}

/** Ownership preparation only: never sends message content, tags, read markers or a retry. */
export function createMessengerOwnership(deps: OwnershipDependencies) {
  const now = deps.now ?? Date.now, fetchImpl = deps.fetch ?? fetch
  async function request(scope: MessengerScope, token: string, take: boolean, phase: OwnershipRequestPhase): Promise<Record<string, any>> {
    const url = new URL(`https://graph.facebook.com/v25.0/${scope.pageId}/${take ? 'take_thread_control' : 'thread_owner'}`)
    if (!take) url.searchParams.set('recipient', scope.psid)
    const response = await fetchImpl(url, { method: take ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${token}`, ...(take ? { 'Content-Type': 'application/json' } : {}) },
      ...(take ? { body: JSON.stringify({ recipient: { id: scope.psid } }) } : {}) })
    const size = Number(response.headers.get('content-length'))
    if (Number.isFinite(size) && size > 65536) throw new OwnershipError('messenger_control_unavailable')
    const reader = response.body?.getReader()
    if (!reader) throw new OwnershipError('messenger_control_unavailable')
    const chunks: Uint8Array[] = []; let bytes = 0
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break
        bytes += part.value.byteLength
        if (bytes > 65536) { await reader.cancel(); throw new OwnershipError('messenger_control_unavailable') }
        chunks.push(part.value)
      }
    } finally { reader.releaseLock() }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!object(data)) throw new OwnershipError('messenger_control_unavailable')
    if (!response.ok || data.error) {
      const code = safeCode(data.error?.code), subcode = safeCode(data.error?.error_subcode)
      const limited = response.status === 429 || code !== undefined && [4,17,32,613,80000,80004].includes(code)
      recordOwnershipRejection(phase, response.status, code, subcode)
      throw new OwnershipError(limited ? 'messenger_control_rate_limited' : 'messenger_control_rejected', code, subcode)
    }
    return data
  }
  function owner(data: Record<string, any>): { appId: string | null } | null {
    // The observed exact empty envelope leaves ownership unknown. It is never
    // proof of ownership; the existing approved take still requires explicit
    // Akmez app-ID readback before preparation can succeed.
    if (Array.isArray(data.data) && data.data.length === 0 && Object.keys(data).length === 1) return { appId: null }
    if (!Array.isArray(data.data) || data.data.length !== 1 || data.paging?.next || !object(data.data[0]?.thread_owner)) return null
    const record = data.data[0].thread_owner
    // A well-formed owner object without app_id is unknown, never proof that
    // Akmez owns the thread. Explicit routing authorization may still permit
    // one take request, followed by a required exact app-ID readback.
    if (!Object.prototype.hasOwnProperty.call(record, 'app_id')) return { appId: null }
    const id = appId(record.app_id)
    return id ? { appId: id } : null
  }
  return {
    async prepare(scope: AutopilotScope, approval: OwnershipApproval): Promise<OwnershipResult> {
      let takeAttempted = false
      try {
        scopeIdentity(scope)
        if (scope.channel !== 'messenger' || approval?.approvedReply !== true || !Number.isSafeInteger(approval.expectedVersion) || approval.expectedVersion < 1)
          return { ok: false, reason: 'messenger_control_not_approved', takeAttempted }
        const started = now()
        const fresh = () => Number.isFinite(now()) && now() - started <= 30000 && now() >= started
        const permitted = async () => fresh() && await deps.controlsAllow(scope, approval.expectedVersion) === true && fresh()
        if (!await permitted()) return { ok: false, reason: 'messenger_control_paused', takeAttempted }
        const page = await deps.getPage(scope.pageId)
        if (!page || page.id !== scope.pageId || typeof page.access_token !== 'string' || !page.access_token) return { ok: false, reason: 'messenger_control_unavailable', takeAttempted }
        const previous = owner(await request(scope, page.access_token, false, 'initial_owner_read'))
        if (!previous) return { ok: false, reason: 'messenger_control_unverified', takeAttempted }
        if (!await permitted()) return { ok: false, reason: 'messenger_control_paused', takeAttempted }
        if (previous.appId === AKMEZ_MESSENGER_APP_ID) return { ok: true, disposition: 'already_owned', checkedAt: now() }
        if (!deps.takeoverAllowed || await deps.takeoverAllowed(scope) !== true) return { ok: false, reason: 'messenger_takeover_not_allowed', takeAttempted }
        // Read controls immediately before the only mutation; never acquire for a
        // paused conversation or an obsolete policy version.
        if (!await permitted()) return { ok: false, reason: 'messenger_control_paused', takeAttempted }
        takeAttempted = true
        const taken = await request(scope, page.access_token, true, 'take_request')
        if (taken.success !== true) return { ok: false, reason: 'messenger_takeover_unconfirmed', takeAttempted }
        if (!await permitted()) return { ok: false, reason: 'messenger_control_paused', takeAttempted }
        const current = owner(await request(scope, page.access_token, false, 'owner_readback'))
        if (current?.appId !== AKMEZ_MESSENGER_APP_ID) return { ok: false, reason: 'messenger_takeover_unconfirmed', takeAttempted }
        if (!await permitted()) return { ok: false, reason: 'messenger_control_paused', takeAttempted }
        return { ok: true, disposition: 'acquired', checkedAt: now() }
      } catch (error) {
        if (error instanceof OwnershipError) return { ok: false, reason: error.reason, takeAttempted,
          ...(error.code !== undefined ? { code: error.code } : {}), ...(error.subcode !== undefined ? { subcode: error.subcode } : {}) }
        return { ok: false, reason: takeAttempted ? 'messenger_takeover_unconfirmed' : 'messenger_control_unavailable', takeAttempted }
      }
    },
  }
}
