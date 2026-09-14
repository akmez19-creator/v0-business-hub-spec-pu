import { randomUUID } from 'node:crypto'
import type { GreenBinding, GreenEvent } from './contract'
import { currentHistoryText, normaliseHistory } from './normalise'
import { GreenReadClient, GreenClientError, GREEN_CLIENT_LIMITS, isGreenChatId, type GreenRecord } from './client'

export const GREEN_RECONCILIATION_LIMITS = Object.freeze({
  runMs: 50_000, leaseMs: 90_000, overlapMinutes: 10, maxWindowMinutes: 1440, historyChats: 5, storedQuotedEvents: 25,
})

/** Implement these operations with a database lease and atomic enabled/version checks.
 * ingest must enforce the same active binding version, not merely trust prior isCurrent.
 * Checkpoints describe a journal sweep, never complete conversation coverage.
 */
export interface GreenReconciliationPort {
  acquire(binding: GreenBinding, runId: string, expiresAt: string): Promise<boolean>
  isCurrent(binding: GreenBinding, runId: string): Promise<boolean>
  readCheckpoint(binding: GreenBinding): Promise<string | null>
  existingEventKeys(binding: GreenBinding, eventKeys: string[]): Promise<string[]>
  ingest(binding: GreenBinding, event: GreenEvent): Promise<{ duplicate: boolean; stored: boolean; quarantined: boolean; reprocessed?: boolean }>
  recoverableQuotedEvents?(binding: GreenBinding, limit: number): Promise<{ events: GreenEvent[]; hasMore: boolean }>
  commitCheckpoint(binding: GreenBinding, runId: string, startedAt: string): Promise<boolean>
  recordResult(binding: GreenBinding, runId: string, result: GreenReconciliationResult): Promise<void>
  release(binding: GreenBinding, runId: string): Promise<void>
  historyCandidates?(binding: GreenBinding, limit: number): Promise<string[]>
}
export interface GreenReconciliationClient {
  verifyAccount(): Promise<unknown>
  journal(direction: 'in' | 'out', minutes: number): Promise<GreenRecord[]>
  history(chatId: string, count?: number): Promise<GreenRecord[]>
}
export interface GreenReconciliationResult {
  state: 'completed' | 'partial' | 'busy' | 'paused' | 'failed'
  reason: string | null
  phoneNumberId: string
  startedAt: string
  journalRows: number
  historyRows: number
  historyChats: number
  stored: number
  duplicates: number
  quarantined: number
  checkpointCommitted: boolean
  outsideRecoveryWindow: boolean
  truncated: boolean
  historyDeferred: boolean
  reprocessedStoredEvents: number
  storedRecoveryDeferred: boolean
  coverage: 'unknown'
}
type Options = {
  signal?: AbortSignal
  now?: () => number
  // Injection is for isolated tests; production uses the bounded read-only client.
  clientFactory?: (binding: GreenBinding, signal: AbortSignal) => GreenReconciliationClient
}
class Stopped extends Error { constructor(readonly code: 'CANCELLED' | 'RUN_TIMEOUT' | 'CONTROL_CHANGED') { super(code) } }

export function reconciliationWindow(checkpoint: string | null, now: number) {
  if (checkpoint === null) return { minutes: 1440, outsideRecoveryWindow: false }
  const previous = Date.parse(checkpoint)
  if (!Number.isFinite(previous) || previous > now) throw new Error('CHECKPOINT_INVALID')
  const elapsed = (now - previous) / 60_000
  return { minutes: Math.max(10, Math.min(1440, Math.ceil(elapsed) + 10)), outsideRecoveryWindow: elapsed > 1440 }
}

function missingText(row: GreenRecord): boolean {
  return ['textMessage', 'extendedTextMessage', 'quotedMessage'].includes(String(row.typeMessage)) &&
    (typeof currentHistoryText(row) !== 'string' || !(currentHistoryText(row) as string).trim()) &&
    row.isDeleted !== true && !row.deletedMessageId
}

/** One bounded sweep, invoked by the server scheduler. No long-lived poller or send work.
 * Push webhooks remain primary; history/journals are an overlapping recovery source.
 */
export async function reconcileGreenBinding(binding: GreenBinding, port: GreenReconciliationPort, options: Options = {}): Promise<GreenReconciliationResult> {
  const now = options.now ?? Date.now
  const startedMs = now(), startedAt = new Date(startedMs).toISOString(), runId = randomUUID()
  const result: GreenReconciliationResult = { state: 'paused', reason: null, phoneNumberId: binding.phoneNumberId,
    startedAt, journalRows: 0, historyRows: 0, historyChats: 0, stored: 0, duplicates: 0, quarantined: 0,
    checkpointCommitted: false, outsideRecoveryWindow: false, truncated: false, historyDeferred: false, reprocessedStoredEvents: 0, storedRecoveryDeferred: false, coverage: 'unknown' }
  if (!binding.enabled || options.signal?.aborted) { result.reason = binding.enabled ? 'CANCELLED' : 'DISABLED'; return result }
  const controller = new AbortController()
  let timedOut = false, acquired = false
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, GREEN_RECONCILIATION_LIMITS.runMs)
  const gate = async () => {
    if (controller.signal.aborted || now() - startedMs >= GREEN_RECONCILIATION_LIMITS.runMs) {
      throw new Stopped(timedOut || now() - startedMs >= GREEN_RECONCILIATION_LIMITS.runMs ? 'RUN_TIMEOUT' : 'CANCELLED')
    }
    if (!await port.isCurrent(binding, runId)) throw new Stopped('CONTROL_CHANGED')
    if (controller.signal.aborted) throw new Stopped(timedOut ? 'RUN_TIMEOUT' : 'CANCELLED')
  }
  const save = async (rows: GreenRecord[], origin: 'history' | 'journal', observedAt: string) => {
    await gate()
    const events = rows.map(row => normaliseHistory(binding, row, observedAt, origin))
    const keys = [...new Set(events.map(event => event.eventKey))]
    const existing = new Set(keys.length ? await port.existingEventKeys(binding, keys) : [])
    await gate()
    for (const event of events) {
      // A timed-out initial sweep resumes by skipping durable events in one indexed
      // lookup, rather than spending its next entire time budget on the same prefix.
      if (existing.has(event.eventKey)) { result.duplicates++; continue }
      await gate()
      const saved = await port.ingest(binding, event)
      result.stored += Number(saved.stored)
      result.duplicates += Number(saved.duplicate)
      result.quarantined += Number(saved.quarantined)
      existing.add(event.eventKey)
    }
  }
  try {
    acquired = await port.acquire(binding, runId, new Date(startedMs + GREEN_RECONCILIATION_LIMITS.leaseMs).toISOString())
    if (!acquired) { result.state = 'busy'; result.reason = 'LEASE_BUSY'; return result }
    await gate()
    if (port.recoverableQuotedEvents) {
      const recovery = await port.recoverableQuotedEvents(binding, GREEN_RECONCILIATION_LIMITS.storedQuotedEvents)
      if (recovery.events.length > GREEN_RECONCILIATION_LIMITS.storedQuotedEvents) throw new Error('STORED_RECOVERY_BUDGET_INVALID')
      result.storedRecoveryDeferred = recovery.hasMore || recovery.events.length > 0
      for (let index = 0; index < recovery.events.length; index++) {
        await gate()
        const saved = await port.ingest(binding, recovery.events[index])
        result.reprocessedStoredEvents += Number(saved.reprocessed === true)
        result.stored += Number(saved.stored)
        result.duplicates += Number(saved.duplicate)
        result.quarantined += Number(saved.quarantined)
        result.storedRecoveryDeferred = recovery.hasMore || index + 1 < recovery.events.length
      }
      await gate()
    }
    const checkpoint = await port.readCheckpoint(binding)
    const window = reconciliationWindow(checkpoint, startedMs)
    result.outsideRecoveryWindow = window.outsideRecoveryWindow
    const client = options.clientFactory?.(binding, controller.signal) ?? new GreenReadClient(binding, { signal: controller.signal })
    await client.verifyAccount()
    await gate()
    const incoming = await client.journal('in', window.minutes)
    await gate()
    const outgoing = await client.journal('out', window.minutes)
    await gate()
    await client.verifyAccount() // Detect a changed account before committing any fetched messages.
    await gate()
    const observedAt = new Date(now()).toISOString()
    result.journalRows = incoming.length + outgoing.length
    result.truncated = incoming.length >= GREEN_CLIENT_LIMITS.journalRows || outgoing.length >= GREEN_CLIENT_LIMITS.journalRows
    await save(incoming, 'journal', observedAt)
    await save(outgoing, 'journal', observedAt)
    // Selection from raw chat IDs is only for fetching. The normalizer remains responsible
    // for authoritative phone mapping; no LID is ever converted to a phone here.
    const wanted = [...new Set([...incoming, ...outgoing].filter(missingText).map(row => row.chatId).filter(isGreenChatId))]
    if (port.historyCandidates) {
      await gate()
      const pending = await port.historyCandidates(binding, GREEN_RECONCILIATION_LIMITS.historyChats + 1)
      for (const chatId of pending) if (isGreenChatId(chatId) && !wanted.includes(chatId)) wanted.push(chatId)
    }
    result.historyDeferred = wanted.length > GREEN_RECONCILIATION_LIMITS.historyChats
    for (const chatId of wanted.slice(0, GREEN_RECONCILIATION_LIMITS.historyChats)) {
      await gate()
      const rows = await client.history(chatId, GREEN_CLIENT_LIMITS.historyCount)
      await gate()
      await client.verifyAccount()
      await gate()
      result.historyChats++
      result.historyRows += rows.length
      await save(rows, 'history', new Date(now()).toISOString())
    }
    await gate()
    if (!result.truncated) result.checkpointCommitted = await port.commitCheckpoint(binding, runId, startedAt)
    if (!result.truncated && !result.checkpointCommitted) throw new Stopped('CONTROL_CHANGED')
    result.state = result.truncated || result.outsideRecoveryWindow || result.historyDeferred || result.storedRecoveryDeferred || result.quarantined > 0 ? 'partial' : 'completed'
    result.reason = result.truncated ? 'JOURNAL_TRUNCATED' : result.outsideRecoveryWindow ? 'OUTSIDE_RECOVERY_WINDOW' :
      result.historyDeferred ? 'HISTORY_DEFERRED' : result.storedRecoveryDeferred ? 'STORED_RECOVERY_DEFERRED' : result.quarantined ? 'QUARANTINED_EVENTS' : null
  } catch (error) {
    result.state = error instanceof Stopped ? 'paused' : 'failed'
    result.reason = error instanceof Stopped || error instanceof GreenClientError ? error.code : 'RECONCILIATION_FAILED'
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    controller.abort()
    if (acquired) {
      try { await port.recordResult(binding, runId, result) }
      catch { result.state = 'failed'; result.reason = 'RESULT_RECORD_FAILED' }
      try { await port.release(binding, runId) }
      catch { result.state = 'failed'; result.reason = 'LEASE_RELEASE_FAILED' }
    }
  }
  return result
}
