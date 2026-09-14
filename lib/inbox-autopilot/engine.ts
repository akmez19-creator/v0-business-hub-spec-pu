import 'server-only'
import { scopeIdentity, type AutopilotJob, type AutopilotScope, type BusinessKey } from './contract'
import type { TrustedContext } from './context'
import { buildReplyPlan, catalogueFingerprint, knownStaffIssue, type CatalogueProduct, type ReplyDecision } from './policy'
import type { AutopilotDb, createAutopilotStore } from './store'

type Store = Pick<ReturnType<typeof createAutopilotStore>, 'getConfig' | 'isBlockedScope' | 'claimJobs' | 'beginSend' |
  'finishSend' | 'markSendUnknown' | 'markNeedsReview' | 'markFailed' | 'escalateToStaff'>
export type EngineDependencies = {
  store: Store
  loadContext(scope: AutopilotScope, db?: AutopilotDb): Promise<TrustedContext>
  /** Existing database-only catalogue; db must be reused for the final transaction check. */
  catalogue(scope: AutopilotScope, db?: AutopilotDb): Promise<CatalogueProduct[]>
  classify(context: TrustedContext, products: CatalogueProduct[]): Promise<ReplyDecision>
  /** Messenger requires a fresh complete provider comparison. Never called inside the send transaction. */
  verifyFreshness(scope: AutopilotScope, context: TrustedContext): Promise<{ ok: true; expiresAt?: number } | { ok: false; reason: string }>
  /** Messenger routing only after a send plan is approved. Requires current controls and exact app ownership readback. */
  prepareOwnership(scope: AutopilotScope, expectedVersion: number): Promise<{ ok: true; checkedAt: number } | { ok: false; reason: string }>
  /** Validate and capture the exact provider/scope before reserving. Preparing must not send. */
  prepareSend(scope: AutopilotScope): Promise<(text: string) => Promise<{ messageId: string; savedLocally: boolean }>>
  /** Best-effort exact echo settlement after durable send acknowledgement; never changes its outcome or retries it. */
  afterAcknowledged?(scope: AutopilotScope): Promise<void>
  now?: () => Date
  /** Lower values support isolated fixtures; runtime cannot raise the bounded timeouts. */
  timeouts?: { classifyMs?: number; sendMs?: number; freshnessMs?: number; ownershipMs?: number }
}
export type EngineResult = { jobId: string; state: 'sent' | 'needs_review' | 'failed' | 'unknown'; reason: string }
function timeoutLimit(value: number | undefined, maximum: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : maximum
}
async function bounded<T>(run: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([Promise.resolve().then(run), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('operation_timeout')), milliseconds) })]) }
  finally { if (timer) clearTimeout(timer) }
}
const sameScope = (a: AutopilotScope, b: TrustedContext['scope']) => a.channel === b.channel && a.businessKey === b.businessKey &&
  (a.channel === 'messenger' && b.channel === 'messenger' ? a.pageId === b.pageId && a.psid === b.psid :
    a.channel === 'whatsapp' && b.channel === 'whatsapp' && a.phoneNumberId === b.phoneNumberId && a.waId === b.waId)

/** One finite leased job. Ingestion, customer discovery, scheduling and authorization stay in the runtime/store. */
export function createAutopilotEngine(deps: EngineDependencies) {
  const now = () => (deps.now ?? (() => new Date()))()
  const proofCurrent = (expiresAt: number | null) => expiresAt === null ||
    Number.isFinite(expiresAt) && expiresAt > now().getTime() && expiresAt <= now().getTime() + 5000
  async function verifyMessenger(scope: AutopilotScope, context: TrustedContext): Promise<{ ok: true; expiresAt: number | null } | { ok: false; reason: string }> {
    if (scope.channel !== 'messenger') return { ok: true, expiresAt: null }
    try {
      if (typeof deps.verifyFreshness !== 'function') return { ok: false, reason: 'history_messenger_freshness_unavailable' }
      const checked = await bounded(() => deps.verifyFreshness(scope, context), timeoutLimit(deps.timeouts?.freshnessMs, 30000))
      if (!checked || checked.ok !== true) {
        const reason = checked && 'reason' in checked && typeof checked.reason === 'string' && /^messenger_[a-z_]{1,60}$/.test(checked.reason)
          ? checked.reason : 'messenger_freshness_unavailable'
        return { ok: false, reason: 'history_' + reason }
      }
      if (typeof checked.expiresAt !== 'number' || !proofCurrent(checked.expiresAt)) return { ok: false, reason: 'history_messenger_freshness_expired' }
      return { ok: true, expiresAt: checked.expiresAt }
    } catch { return { ok: false, reason: 'history_messenger_freshness_unavailable' } }
  }
  async function prepareMessengerOwnership(scope: AutopilotScope, expectedVersion: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (scope.channel !== 'messenger') return { ok: true }
    try {
      if (typeof deps.prepareOwnership !== 'function') return { ok: false, reason: 'messenger_control_unavailable' }
      const current = await deps.store.getConfig(scope.businessKey)
      if (!current.enabled || current.reason || !current.deliveryDate || current.version !== expectedVersion || await deps.store.isBlockedScope(scope))
        return { ok: false, reason: 'messenger_control_paused' }
      if (current.reservedToday >= current.maxDailyReplies || current.repliesToday >= current.maxDailyReplies)
        return { ok: false, reason: 'daily_reply_limit' }
      const ownership = await bounded(() => deps.prepareOwnership(scope, expectedVersion), timeoutLimit(deps.timeouts?.ownershipMs, 30000))
      if (!ownership || ownership.ok !== true) {
        const reason = ownership && 'reason' in ownership && typeof ownership.reason === 'string' && /^messenger_(?:control|takeover)_[a-z_]{1,50}$/.test(ownership.reason)
          ? ownership.reason : 'messenger_control_unavailable'
        return { ok: false, reason }
      }
      const checkedAt = ownership.checkedAt, currentTime = now().getTime()
      if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt > currentTime || currentTime - checkedAt > 5000)
        return { ok: false, reason: 'messenger_control_unverified' }
      return { ok: true }
    } catch { return { ok: false, reason: 'messenger_control_unavailable' } }
  }
  async function processJob(job: AutopilotJob): Promise<EngineResult> {
    let sendToken: string | null = null
    let beginAttempted = false
    let stage = 'context'
    const result = (state: EngineResult['state'], reason: string): EngineResult => ({ jobId: job.id, state, reason })
    const review = async (reason: string) => {
      if (job.leaseToken) await deps.store.markNeedsReview(job.id, job.leaseToken, reason)
      return result('needs_review', reason)
    }
    try {
      scopeIdentity(job.scope)
      if (job.businessKey !== job.scope.businessKey || job.state !== 'processing' || !job.leaseToken || job.sendToken ||
        !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= now().getTime() || !Number.isFinite(Date.parse(job.leaseExpiresAt))) return result('needs_review', 'lease_unavailable')
      const config = await deps.store.getConfig(job.businessKey)
      if (!config.enabled || config.reason || !config.deliveryDate || config.version !== job.configVersion || await deps.store.isBlockedScope(job.scope)) return review('business_paused_or_config_changed')
      if (config.reservedToday >= config.maxDailyReplies || config.repliesToday >= config.maxDailyReplies) return review('daily_reply_limit')
      const context = await deps.loadContext(job.scope)
      if (!sameScope(job.scope, context.scope)) return review('history_scope_mismatch')
      if (!context.eligible) return review('history_'+(context.reasons[0]??'needs_review').toLowerCase())
      if (context.fingerprint !== job.contextFingerprint || context.latestInbound?.id !== job.inboundMessageId) return review('context_changed')
      const initialFreshness = await verifyMessenger(job.scope, context)
      if (!initialFreshness.ok) return review(initialFreshness.reason)
      const knownIssue=knownStaffIssue(context)
      if(knownIssue){
        const held=await deps.store.escalateToStaff(job.id,job.leaseToken,knownIssue,context.fingerprint,async(db,lockedJob)=>{
          const fresh=await deps.loadContext(job.scope,db)
          return{...fresh,eligible:lockedJob.id===job.id&&sameScope(job.scope,fresh.scope)&&fresh.eligible&&fresh.fingerprint===context.fingerprint&&fresh.latestInbound?.id===job.inboundMessageId&&knownStaffIssue(fresh)===knownIssue}
        })
        return result('needs_review',held.ok?knownIssue:held.reason)
      }
      stage = 'catalogue'
      const products = await deps.catalogue(job.scope)
      // No model call is made before the current controls, cap, scope and readable context pass.
      stage = 'classification'
      const decision = await bounded(() => deps.classify(context, products), timeoutLimit(deps.timeouts?.classifyMs, 30000))
      const plan = buildReplyPlan(decision, context, products, config.deliveryDate, now())
      if(plan.action==='review'&&(plan.reason==='customer_issue'||plan.reason==='exchange_or_change_request')){
        const kind=plan.reason
        const held=await deps.store.escalateToStaff(job.id,job.leaseToken,kind,context.fingerprint,async(db,lockedJob)=>{
          const fresh=await deps.loadContext(job.scope,db)
          if(lockedJob.id!==job.id||!sameScope(job.scope,fresh.scope)||!fresh.eligible||fresh.fingerprint!==context.fingerprint||fresh.latestInbound?.id!==job.inboundMessageId)return{...fresh,eligible:false}
          const current=buildReplyPlan(decision,fresh,products,config.deliveryDate!,now())
          return{...fresh,eligible:current.action==='review'&&current.reason===kind}
        })
        return result('needs_review',held.ok?kind:held.reason)
      }
      if (plan.action !== 'send') return review(plan.reason)
      if (!plan.text.trim() || plan.text.length > 4000) return review('invalid_send_plan')
      stage = 'provider_preparation'
      const send = await deps.prepareSend(job.scope)
      if (typeof send !== 'function') return review('provider_configuration_unavailable')
      if (Date.parse(job.leaseExpiresAt) - now().getTime() < 2500) return review('lease_unavailable')
      // Acquire routing only for this approved reply, outside the send transaction.
      // Unconfirmed takes are held for review, never an automatic retry path.
      const ownership = await prepareMessengerOwnership(job.scope, job.configVersion)
      if (!ownership.ok) return review(ownership.reason)
      if (Date.parse(job.leaseExpiresAt) - now().getTime() < 2500) return review('lease_unavailable')
      const finalFreshness = await verifyMessenger(job.scope, context)
      if (!finalFreshness.ok) return review(finalFreshness.reason)
      if (Date.parse(job.leaseExpiresAt) - now().getTime() < 2500) return review('lease_unavailable')
      beginAttempted = true
      const started = await deps.store.beginSend({ jobId: job.id, leaseToken: job.leaseToken, expectedVersion: config.version,
        expectedContextFingerprint: context.fingerprint, draftText: plan.text,
        ...(plan.reason==='order_ready_for_staff'?{staffTask:{kind:'order_ready_for_staff' as const,evidence:plan.evidence,catalogueFingerprint:plan.catalogueFingerprint,deliveryDate:config.deliveryDate}}:{}),
        recheck: async (db, lockedJob) => {
          if (!proofCurrent(finalFreshness.expiresAt)) return { eligible: false, fingerprint: context.fingerprint, latestInbound: null }
          if (lockedJob.id !== job.id || lockedJob.inboundMessageId !== job.inboundMessageId || scopeIdentity(lockedJob.scope).conversationKey !== scopeIdentity(job.scope).conversationKey || lockedJob.businessKey !== job.businessKey) return { eligible: false, fingerprint: context.fingerprint, latestInbound: null }
          const fresh = await deps.loadContext(job.scope, db)
          if (!sameScope(job.scope, fresh.scope) || !fresh.eligible || fresh.fingerprint !== context.fingerprint || fresh.latestInbound?.id !== job.inboundMessageId) return { ...fresh, eligible: false }
          const currentProducts = await deps.catalogue(job.scope, db)
          if (catalogueFingerprint(currentProducts) !== plan.catalogueFingerprint) return { ...fresh, eligible: false }
          const checkedPlan = buildReplyPlan(decision, fresh, currentProducts, config.deliveryDate!, now())
          return { ...fresh, eligible: proofCurrent(finalFreshness.expiresAt) && checkedPlan.action === 'send' && checkedPlan.text === plan.text && checkedPlan.reason === plan.reason && JSON.stringify(checkedPlan.evidence)===JSON.stringify(plan.evidence) }
        } })
      if (!started.ok) return result('needs_review', started.reason)
      sendToken = started.sendToken
      if (!proofCurrent(finalFreshness.expiresAt)) {
        // The durable intent must never be reset/retried, even when this process
        // knows it withheld the transport because the provider proof expired.
        await deps.store.markSendUnknown(job.id, sendToken, 'messenger_freshness_expired_before_send')
        return result('unknown', 'messenger_freshness_expired_before_send')
      }
      // Exactly one transport invocation follows a durable intent. A timeout does not
      // cancel remote acceptance: leave unknown and never retry from this engine.
      const sent = await bounded(() => send(plan.text), timeoutLimit(deps.timeouts?.sendMs, 20000))
      if (!sent || typeof sent.messageId !== 'string' || !sent.messageId || sent.messageId.length > 2048 || /[\u0000-\u001f]/.test(sent.messageId)) throw new Error('provider_acceptance_missing')
      const reason = sent.savedLocally === true ? plan.reason : 'sent_local_save_pending'
      const completed = await deps.store.finishSend(job.id, sendToken, sent.messageId, reason)
      if (!completed.ok) {
        await deps.store.markSendUnknown(job.id, sendToken, 'send_confirmation_persistence_failed')
        return result('unknown', 'send_confirmation_persistence_failed')
      }
      try { await deps.afterAcknowledged?.(job.scope) } catch { /* A saved send outcome is final. */ }
      return result('sent', reason)
    } catch (error) {
      if (sendToken) {
        await deps.store.markSendUnknown(job.id, sendToken, 'provider_outcome_unknown').catch(() => {})
        return result('unknown', 'provider_outcome_unknown')
      }
      if (beginAttempted) {
        // A failed acknowledgement of beginSend may hide a committed intent. No
        // provider call is made and no unsafe attempt is reset into the queue.
        return result('unknown', 'send_intent_acknowledgement_missing')
      }
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const reason = ['reply_service_rate_limited','reply_service_billing'].includes(code) ? code :
        stage === 'classification' ? 'reply_generation_failed' : stage === 'catalogue' ? 'catalogue_unavailable' :
        stage === 'provider_preparation' ? 'provider_configuration_unavailable' : 'pre_send_failed'
      if (job.leaseToken) await deps.store.markFailed(job.id, job.leaseToken, reason).catch(() => {})
      return result('failed', reason)
    }
  }
  async function runBusiness(businessKey: BusinessKey): Promise<EngineResult[]> {
    const jobs = await deps.store.claimJobs(businessKey, 1)
    // A malformed dependency must not turn a bounded pass into multiple sends.
    if (jobs.length !== 1) return []
    if (jobs[0].businessKey !== businessKey) return []
    return [await processJob(jobs[0])]
  }
  return { processJob, runBusiness }
}
