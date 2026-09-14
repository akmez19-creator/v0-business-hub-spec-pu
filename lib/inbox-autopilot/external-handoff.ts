import 'server-only'
import { createHash } from 'node:crypto'
import { assertMessageId, scopeIdentity, type AutopilotScope } from './contract'
import type { AutopilotConnect, AutopilotDb } from './store'

export type HandoffSource = 'meta_messenger' | 'meta_whatsapp' | 'green_whatsapp'
export type HandoffReference = {
  scope: AutopilotScope
  source: HandoffSource
  sourceEventId: string
  nativeMessageId: string
}
/** Server-owned adapters must read verified persisted provenance, never browser
 * assertions. Preserve native event IDs and original provider occurrence time.
 */
export type HandoffEvidence = HandoffReference & {
  acceptance: 'verified_live_webhook' | 'verified_recent_green_journal' | 'history' | 'unverified'
  historical: boolean
  imported: boolean
  direction: 'in' | 'out'
  eventKind: 'message' | 'status' | 'account'
  occurredAt: string
  timestampPrecision: 'second' | 'millisecond'
  /** Original database-owned verification time, not the current poll time. */
  firstVerifiedAt?: string
}
export type JournalWindow = { activatedAt: string; maxAgeSeconds: number }
export type ExactProviderIdentity = HandoffReference & {
  proof: 'verified_exact_native_id_link'
  providerMessageId: string
}
export type GreenNativeIdentity = HandoffReference & {
  proof: 'verified_green_native_send'; provider: 'green-api'; attemptId: string
  instanceId: string; chatId: string; bindingVersion: number; providerMessageId: string
}
export type GreenNativePending = HandoffReference & {
  proof: 'verified_green_native_pending'; provider: 'green-api'; attemptId: string
  instanceId: string; chatId: string; bindingVersion: number
}
export type HandoffResult = {
  status: 'ignored' | 'duplicate' | 'proven_bot' | 'stale_after_resume' | 'already_held' | 'held' | 'pending_identity' | 'not_pending'
  reason: 'not_live_outgoing' | 'invalid_evidence' | 'journal_window_closed' | 'receipt_already_processed' | 'exact_bot_message' |
    'older_than_explicit_resume' | 'conversation_already_held' | 'outgoing_source_unconfirmed' | 'outgoing_identity_pending' | 'no_pending_receipt'
  cancelledJobs: number
  releasedTemporaryHold?: boolean
}
export type HandoffDependencies = {
  connect: AutopilotConnect
  /** Database reads only, using this transaction. Verify immutable signature/
   * journal payload and binding/account provenance plus every reference field.
   * Call observe again on duplicate ingestion deliveries if handoff once failed.
   */
  loadPersistedEvidence(db: AutopilotDb, reference: HandoffReference): Promise<HandoffEvidence | null>
  /** Mandatory for journal acceptance: activation and age policy are DB-owned. */
  loadJournalWindow?(db: AutopilotDb, scope: AutopilotScope): Promise<JournalWindow | null>
  /** Optional exact ID mapping read from verified provenance. No text/time match,
   * undocumented conversion, app-ID exemption, provider call or browser input.
   */
  loadExactProviderIdentity?(db: AutopilotDb, reference: HandoffReference): Promise<ExactProviderIdentity | null>
  /** Separate transport namespace. Read exact current binding, immutable outgoing
   * event and native accepted attempt. Never translate this into a Meta job ID. */
  loadGreenNativeIdentity?(db: AutopilotDb, reference: HandoffReference): Promise<GreenNativeIdentity | null>
  /** A possible in-flight native attempt is NOT evidence this message is ours.
   * It permits only a temporary hold pending exact accepted native identity. */
  loadGreenNativePending?(db: AutopilotDb, reference: HandoffReference): Promise<GreenNativePending | null>
}

type Identity = ReturnType<typeof scopeIdentity>
type Receipt = Record<string, any>
type Generation = { version: number | null; temporary: boolean; potentialJobId: string | null; potentialGreenAttemptId: string | null }
const sources = new Set<HandoffSource>(['meta_messenger', 'meta_whatsapp', 'green_whatsapp'])
const sameScope = (a: AutopilotScope, b: AutopilotScope) => {
  const aa = scopeIdentity(a), bb = scopeIdentity(b)
  return a.businessKey === b.businessKey && a.channel === b.channel && aa.owner === bb.owner && aa.customer === bb.customer
}
function validateReference(reference: HandoffReference): Identity {
  const identity = scopeIdentity(reference?.scope)
  if (!sources.has(reference.source) || (reference.source === 'meta_messenger') !== (reference.scope.channel === 'messenger'))
    throw new Error('invalid_handoff_source')
  assertMessageId(reference.sourceEventId)
  assertMessageId(reference.nativeMessageId)
  return identity
}
function timestamp(value: unknown): number | null {
  const at = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) ? at : null
}
function version(value: unknown): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('handoff_control_version_invalid')
  return n
}
function sameReference(a: HandoffReference, b: HandoffReference): boolean {
  try {
    return sameScope(a.scope, b.scope) && a.source === b.source && a.sourceEventId === b.sourceEventId && a.nativeMessageId === b.nativeMessageId
  } catch { return false }
}
export function handoffReceiptKey(reference: HandoffReference): string {
  const { business, owner, customer } = validateReference(reference)
  return createHash('sha256').update(JSON.stringify([1, reference.source, business.code,
    reference.scope.channel, owner, customer, reference.sourceEventId])).digest('hex')
}
/** Different events in the same provider second cannot be reliably ordered.
 * Exact replays are suppressed by the receipt, including after a manual Resume.
 */
export function occurredBeforeResume(occurredAt: string, precision: HandoffEvidence['timestampPrecision'], resumedAt: unknown): boolean {
  const occurred = timestamp(occurredAt), resumed = timestamp(resumedAt)
  if (occurred === null || resumed === null || !['second', 'millisecond'].includes(precision)) return false
  return occurred + (precision === 'second' ? 1000 : 1) <= resumed
}
export function journalWithinWindow(evidence: HandoffEvidence, window: JournalWindow | null, now: number): boolean {
  if (!window || evidence.source !== 'green_whatsapp' || evidence.acceptance !== 'verified_recent_green_journal' ||
    !Number.isInteger(window.maxAgeSeconds) || window.maxAgeSeconds < 1 || window.maxAgeSeconds > 900) return false
  const occurred = timestamp(evidence.occurredAt), verified = timestamp(evidence.firstVerifiedAt), activated = timestamp(window.activatedAt)
  if (occurred === null || verified === null || activated === null || !Number.isFinite(now)) return false
  const oldest = now - window.maxAgeSeconds * 1000
  return activated <= now && occurred >= activated && occurred >= oldest && occurred <= now &&
    verified >= activated && verified >= oldest && verified <= now && verified >= occurred - 60000
}
function evidenceValid(reference: HandoffReference, evidence: HandoffEvidence, now: number): boolean {
  if (!sameReference(reference, evidence)) return false
  const at = timestamp(evidence.occurredAt)
  return at !== null && at <= now + 60000 && ['second', 'millisecond'].includes(evidence.timestampPrecision) &&
    (evidence.timestampPrecision !== 'second' || at % 1000 === 0)
}

/** Ordered, independent post-ingestion transactions only. Never call while an
 * ingestion transaction already owns the GREEN binding lock.
 * This helper never sends, takes provider control, creates orders, enables a
 * business, resets unknown jobs or infers that an agent is currently typing.
 */
export function createExternalHandoff(deps: HandoffDependencies) {
  const scopeArgs = (reference: HandoffReference) => {
    const { business, owner, customer } = validateReference(reference)
    return [business.code, reference.scope.channel, owner, customer]
  }
  async function transaction<T>(reference: HandoffReference, run: (db: AutopilotDb, now: number) => Promise<T>): Promise<T> {
    const { business, owner, customer } = validateReference(reference)
    const db = await deps.connect()
    try {
      await db.query('BEGIN')
      await db.query("SET LOCAL statement_timeout='10s'")
      await db.query("SET LOCAL lock_timeout='3s'")
      const config = (await db.query('SELECT business_code FROM public.inbox_autopilot_config WHERE business_code=$1 FOR UPDATE', [business.code])).rows[0]
      if (config?.business_code !== business.code) throw new Error('handoff_business_unavailable')
      const locks = reference.scope.channel === 'messenger' ? [JSON.stringify([owner, customer])] :
        ['whatsapp:customer:' + customer, JSON.stringify(['whatsapp:conversation', owner, customer]), 'green:binding:' + owner]
      for (const lock of locks) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lock])
      const now = timestamp((await db.query('SELECT clock_timestamp() AS observed_at')).rows[0]?.observed_at)
      if (now === null) throw new Error('handoff_clock_unavailable')
      const result = await run(db, now)
      await db.query('COMMIT')
      return result
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {})
      throw error
    } finally { await db.end().catch(() => {}) }
  }
  async function getControl(db: AutopilotDb, reference: HandoffReference) {
    return (await db.query('SELECT paused,updated_by,updated_at,version FROM public.inbox_autopilot_controls ' +
      'WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 FOR UPDATE', scopeArgs(reference))).rows[0]
  }
  async function getReceipt(db: AutopilotDb, reference: HandoffReference): Promise<Receipt | undefined> {
    const receipt = (await db.query('SELECT business_code,channel,owner_id,customer_id,source,source_event_id,native_message_id,disposition,' +
      'hold_control_version,temporary_hold,potential_job_id,potential_green_attempt_id FROM public.inbox_autopilot_handoff_events WHERE event_key=$1 FOR UPDATE',
    [handoffReceiptKey(reference)])).rows[0]
    if (receipt) {
      const [business, channel, owner, customer] = scopeArgs(reference)
      if (receipt.business_code !== business || receipt.channel !== channel || receipt.owner_id !== owner || receipt.customer_id !== customer ||
        receipt.source !== reference.source || receipt.source_event_id !== reference.sourceEventId ||
        receipt.native_message_id !== reference.nativeMessageId || receipt.disposition === 'received') throw new Error('handoff_receipt_conflict')
    }
    return receipt
  }
  async function providerMessageId(db: AutopilotDb, reference: HandoffReference): Promise<string | null> {
    const identity = await deps.loadExactProviderIdentity?.(db, reference)
    // Saved Autopilot IDs currently identify Meta transport, not a transport-tagged
    // namespace. A coincidentally equal GREEN ID cannot establish bot provenance.
    if (!identity) return reference.source === 'green_whatsapp' ? null : reference.nativeMessageId
    if (!sameReference(reference, identity) || identity.proof !== 'verified_exact_native_id_link') throw new Error('handoff_identity_proof_invalid')
    assertMessageId(identity.providerMessageId)
    return identity.providerMessageId
  }
  function validGreenProof(reference: HandoffReference, proof: GreenNativeIdentity | GreenNativePending): boolean {
    return reference.source === 'green_whatsapp' && reference.scope.channel === 'whatsapp' && sameReference(reference, proof) &&
      proof.provider === 'green-api' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(proof.attemptId) &&
      typeof proof.instanceId === 'string' && /^[1-9]\d{0,19}$/.test(proof.instanceId) && proof.chatId === reference.scope.waId + '@c.us' &&
      Number.isSafeInteger(proof.bindingVersion) && proof.bindingVersion > 0
  }
  async function isProvenBot(db: AutopilotDb, reference: HandoffReference): Promise<boolean> {
    if (reference.source === 'green_whatsapp' && reference.scope.channel === 'whatsapp' && deps.loadGreenNativeIdentity) {
      const proof = await deps.loadGreenNativeIdentity(db, reference)
      if (proof) {
        if (!validGreenProof(reference, proof) || proof.proof !== 'verified_green_native_send' ||
          proof.providerMessageId !== reference.nativeMessageId) throw new Error('handoff_green_identity_invalid')
        const accepted = (await db.query('SELECT attempt_id FROM public.inbox_autopilot_green_sends ' +
          "WHERE business_code=$1 AND phone_number_id=$2 AND wa_id=$3 AND attempt_id=$4 AND instance_id=$5 AND chat_id=$6 AND binding_version=$7 " +
          "AND provider_message_id=$8 AND state='accepted' AND request_token IS NOT NULL AND started_at IS NOT NULL AND accepted_at IS NOT NULL LIMIT 2",
        [scopeIdentity(reference.scope).business.code, reference.scope.phoneNumberId, reference.scope.waId,
          proof.attemptId, proof.instanceId, proof.chatId, proof.bindingVersion, reference.nativeMessageId])).rows
        return accepted.length === 1
      }
    }
    const providerId = await providerMessageId(db, reference)
    if (providerId === null) return false
    const jobs = (await db.query('SELECT id FROM public.inbox_autopilot_jobs ' +
      'WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND provider_message_id=$5 ' +
      "AND state IN ('sending','sent','unknown') AND send_token IS NOT NULL AND send_started_at IS NOT NULL AND reservation_day IS NOT NULL LIMIT 2",
    [...scopeArgs(reference), providerId])).rows
    return jobs.length === 1
  }
  async function potentialBotJob(db: AutopilotDb, reference: HandoffReference): Promise<string | null> {
    const jobs = (await db.query('SELECT id FROM public.inbox_autopilot_jobs ' +
      "WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND state='sending' AND provider_message_id IS NULL " +
      'AND send_token IS NOT NULL AND send_started_at IS NOT NULL AND reservation_day IS NOT NULL AND lease_expires_at>clock_timestamp() LIMIT 2',
    scopeArgs(reference))).rows
    return jobs.length === 1 && typeof jobs[0].id === 'string' ? jobs[0].id : null
  }
  async function potentialGreenAttempt(db: AutopilotDb, reference: HandoffReference): Promise<string | null> {
    if (reference.source !== 'green_whatsapp' || reference.scope.channel !== 'whatsapp') return null
    const proof = await deps.loadGreenNativePending?.(db, reference)
    if (!proof) return null
    if (!validGreenProof(reference, proof) || proof.proof !== 'verified_green_native_pending') throw new Error('handoff_green_pending_invalid')
    const attempts = (await db.query('SELECT attempt_id FROM public.inbox_autopilot_green_sends ' +
      "WHERE business_code=$1 AND phone_number_id=$2 AND wa_id=$3 AND attempt_id=$4 AND instance_id=$5 AND chat_id=$6 AND binding_version=$7 " +
      "AND state='sending' AND provider_message_id IS NULL AND request_token IS NOT NULL AND started_at>clock_timestamp()-interval '120 seconds' AND started_at<=clock_timestamp() LIMIT 2",
    [scopeIdentity(reference.scope).business.code, reference.scope.phoneNumberId, reference.scope.waId,
      proof.attemptId, proof.instanceId, proof.chatId, proof.bindingVersion])).rows
    return attempts.length === 1 ? proof.attemptId : null
  }
  async function cancelCleanPresend(db: AutopilotDb, reference: HandoffReference): Promise<number> {
    const cancelled = await db.query("UPDATE public.inbox_autopilot_jobs SET state='needs_review',reason='outgoing_source_unconfirmed'," +
      'lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() ' +
      "WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND state IN ('queued','processing') " +
      'AND send_token IS NULL AND send_started_at IS NULL AND reservation_day IS NULL AND provider_message_id IS NULL AND draft_text IS NULL',
    scopeArgs(reference))
    return Number(cancelled.rowCount ?? 0)
  }
  async function hold(db: AutopilotDb, reference: HandoffReference): Promise<number> {
    const updated = await db.query('INSERT INTO public.inbox_autopilot_controls(business_code,channel,owner_id,customer_id,paused,updated_by) ' +
      'VALUES($1,$2,$3,$4,true,NULL) ON CONFLICT(business_code,channel,owner_id,customer_id) ' +
      'DO UPDATE SET paused=true,updated_by=NULL,version=inbox_autopilot_controls.version+1,updated_at=clock_timestamp() RETURNING version',
    scopeArgs(reference))
    if (updated.rows.length !== 1) throw new Error('handoff_control_not_held')
    return version(updated.rows[0].version)
  }
  async function settle(db: AutopilotDb, reference: HandoffReference, disposition: HandoffResult['status'], generation: Generation) {
    const updated = await db.query('UPDATE public.inbox_autopilot_handoff_events SET disposition=$2,hold_control_version=$3,' +
      'temporary_hold=$4,potential_job_id=$5,potential_green_attempt_id=$6,processed_at=clock_timestamp() WHERE event_key=$1 AND disposition=\'received\'',
    [handoffReceiptKey(reference), disposition, generation.version, generation.temporary, generation.potentialJobId, generation.potentialGreenAttemptId])
    if (updated.rowCount !== 1) throw new Error('handoff_receipt_not_settled')
  }
  async function finishPending(db: AutopilotDb, reference: HandoffReference, disposition: 'proven_bot' | 'held') {
    const updated = await db.query('UPDATE public.inbox_autopilot_handoff_events SET disposition=$2,processed_at=clock_timestamp() ' +
      "WHERE event_key=$1 AND disposition='pending_identity'", [handoffReceiptKey(reference), disposition])
    if (updated.rowCount !== 1) throw new Error('handoff_pending_not_settled')
  }
  async function releaseIfEntireGenerationIsBot(db: AutopilotDb, reference: HandoffReference, generation: unknown): Promise<boolean> {
    if (generation == null) return false
    const expectedVersion = version(generation), control = await getControl(db, reference)
    if (!control || control.paused !== true || control.updated_by !== null || version(control.version) !== expectedVersion) return false
    const events = (await db.query('SELECT disposition,temporary_hold FROM public.inbox_autopilot_handoff_events ' +
      'WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND hold_control_version=$5 FOR UPDATE',
    [...scopeArgs(reference), expectedVersion])).rows
    if (!events.length || !events.some(event => event.temporary_hold === true) || events.some(event => event.disposition !== 'proven_bot')) return false
    const released = await db.query('UPDATE public.inbox_autopilot_controls SET paused=false,version=version+1,updated_at=clock_timestamp() ' +
      'WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND version=$5 AND paused=true AND updated_by IS NULL',
    [...scopeArgs(reference), expectedVersion])
    return released.rowCount === 1
  }
  return {
    async observe(reference: HandoffReference): Promise<HandoffResult> {
      return transaction(reference, async (db, now) => {
        const evidence = await deps.loadPersistedEvidence(db, reference)
        if (!evidence || !evidenceValid(reference, evidence, now)) return { status: 'ignored', reason: 'invalid_evidence', cancelledJobs: 0 }
        if (evidence.historical !== false || evidence.imported !== false || evidence.direction !== 'out' || evidence.eventKind !== 'message' ||
          !['verified_live_webhook', 'verified_recent_green_journal'].includes(evidence.acceptance))
          return { status: 'ignored', reason: 'not_live_outgoing', cancelledJobs: 0 }
        let journal: JournalWindow | null = null
        if (evidence.acceptance === 'verified_recent_green_journal') {
          journal = await deps.loadJournalWindow?.(db, reference.scope) ?? null
          if (!journalWithinWindow(evidence, journal, now)) return { status: 'ignored', reason: 'journal_window_closed', cancelledJobs: 0 }
        }
        const inserted = (await db.query('INSERT INTO public.inbox_autopilot_handoff_events ' +
          '(event_key,business_code,channel,owner_id,customer_id,source,source_event_id,native_message_id,provider_occurred_at,timestamp_precision,' +
          'evidence_acceptance,first_verified_at,journal_activated_at,journal_max_age_seconds,disposition) ' +
          "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'received') ON CONFLICT(event_key) DO NOTHING RETURNING event_key",
        [handoffReceiptKey(reference), ...scopeArgs(reference), reference.source, reference.sourceEventId, reference.nativeMessageId,
          evidence.occurredAt, evidence.timestampPrecision, evidence.acceptance, evidence.firstVerifiedAt ?? null,
          journal?.activatedAt ?? null, journal?.maxAgeSeconds ?? null])).rows.length === 1
        if (!inserted) {
          if (!await getReceipt(db, reference)) throw new Error('handoff_receipt_conflict')
          return { status: 'duplicate', reason: 'receipt_already_processed', cancelledJobs: 0 }
        }
        let result: HandoffResult
        const generation: Generation = { version: null, temporary: false, potentialJobId: null, potentialGreenAttemptId: null }
        if (await isProvenBot(db, reference)) {
          result = { status: 'proven_bot', reason: 'exact_bot_message', cancelledJobs: 0 }
        } else {
          const control = await getControl(db, reference)
          if (control?.paused === false && control.updated_by != null &&
            occurredBeforeResume(evidence.occurredAt, evidence.timestampPrecision, control.updated_at)) {
            result = { status: 'stale_after_resume', reason: 'older_than_explicit_resume', cancelledJobs: 0 }
          } else {
            const potentialGreen = await potentialGreenAttempt(db, reference)
            const potentialMeta = potentialGreen ? null : await potentialBotJob(db, reference)
            const potential = potentialGreen ?? potentialMeta
            generation.potentialJobId = potentialMeta
            generation.potentialGreenAttemptId = potentialGreen
            if (control?.paused === true) {
              // Every unmatched event joins this generation, even if already held.
              // A later exact bot acknowledgement cannot erase this other evidence.
              generation.version = version(control.version)
              result = potential ? { status: 'pending_identity', reason: 'outgoing_identity_pending', cancelledJobs: 0 } :
                { status: 'already_held', reason: 'conversation_already_held', cancelledJobs: 0 }
            } else {
              generation.version = await hold(db, reference)
              generation.temporary = potential !== null
              result = potential ? { status: 'pending_identity', reason: 'outgoing_identity_pending', cancelledJobs: 0 } :
                { status: 'held', reason: 'outgoing_source_unconfirmed', cancelledJobs: await cancelCleanPresend(db, reference) }
            }
          }
        }
        await settle(db, reference, result.status, generation)
        return result
      })
    },
    /** Call after send acknowledgement and in bounded reconciliation. Reads only
     * exact persisted identity proof; no provider calls, send retries or job reset.
     */
    async resolvePending(reference: HandoffReference): Promise<HandoffResult> {
      return transaction(reference, async db => {
        const receipt = await getReceipt(db, reference)
        if (!receipt || receipt.disposition !== 'pending_identity') return { status: 'not_pending', reason: 'no_pending_receipt', cancelledJobs: 0 }
        if (await isProvenBot(db, reference)) {
          await finishPending(db, reference, 'proven_bot')
          const released = await releaseIfEntireGenerationIsBot(db, reference, receipt.hold_control_version)
          return { status: 'proven_bot', reason: 'exact_bot_message', cancelledJobs: 0, releasedTemporaryHold: released }
        }
        const nativePending = receipt.potential_green_attempt_id != null && reference.source === 'green_whatsapp' && reference.scope.channel === 'whatsapp' &&
          (await potentialGreenAttempt(db, reference)) === receipt.potential_green_attempt_id
        const pending = nativePending || (receipt.potential_job_id != null && (await db.query('SELECT id FROM public.inbox_autopilot_jobs ' +
          "WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND id=$5 AND state='sending' AND provider_message_id IS NULL " +
          'AND send_token IS NOT NULL AND send_started_at IS NOT NULL AND reservation_day IS NOT NULL AND lease_expires_at>clock_timestamp()',
        [...scopeArgs(reference), receipt.potential_job_id])).rows.length === 1)
        if (pending) return { status: 'pending_identity', reason: 'outgoing_identity_pending', cancelledJobs: 0 }
        await finishPending(db, reference, 'held')
        const control = await getControl(db, reference)
        const sameGeneration = receipt.hold_control_version != null && control?.paused === true && control.updated_by === null &&
          version(control.version) === version(receipt.hold_control_version)
        return { status: 'held', reason: 'outgoing_source_unconfirmed',
          cancelledJobs: sameGeneration ? await cancelCleanPresend(db, reference) : 0 }
      })
    },
  }
}
