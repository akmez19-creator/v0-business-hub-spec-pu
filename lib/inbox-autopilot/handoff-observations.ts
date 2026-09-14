import 'server-only'
import { assertMessageId, scopeIdentity, type AutopilotScope, type BusinessKey } from './contract'
import { handoffReceiptKey, type HandoffEvidence, type HandoffReference } from './external-handoff'
import type { AutopilotConnect, AutopilotDb } from './store'

export const HANDOFF_RELEASE_KEY = 'inbox:autopilot:handoff:v1'
export type HandoffRelease = { enabled: boolean; activatedAt: string; businessCodes: ['MBM', 'DBM']; journalMaxAgeSeconds: 600 }
export type MetaObservationInput = HandoffReference & {
  source: 'meta_messenger' | 'meta_whatsapp'
  acceptance: 'verified_live_webhook'
  occurredAt: string
  timestampPrecision: 'second' | 'millisecond'
  /** SHA256 of one authenticated event, not an entire variable webhook batch. */
  payloadHash: string
}
export type StoredMetaObservation = HandoffEvidence & {
  source: 'meta_messenger' | 'meta_whatsapp'
  acceptance: 'verified_live_webhook'
  eventKey: string
  payloadHash: string
  firstVerifiedAt: string
  historical: false
  imported: false
  direction: 'out'
  eventKind: 'message'
}
export type ObservationCursor = { firstVerifiedAt: string; eventKey: string }
export type ObservationScan = { enabled: boolean; items: StoredMetaObservation[]; hasMore: boolean; nextCursor: ObservationCursor | null }
export type ObservationDependencies = {
  connect: AutopilotConnect
  /** Read the exact fixed cursor JSON marker; null/disabled means no work.
   * No environment, browser or caller-provided flag is accepted as activation.
   */
  loadRelease(db: AutopilotDb): Promise<HandoffRelease | null>
  /** A server-owned authenticated live-webhook adapter must bind this callback
   * to its already validated immutable outgoing event descriptor. It must verify
   * the exact scope, native ID, original time, event identity and payload hash.
   * Capture precedes canonical ingestion; a canonical message is not evidence
   * of authenticated live delivery. No provider calls or nested transactions.
   * History/status/import branches and browser assertions are never witnesses.
   */
  verifyAuthenticatedWitness(db: AutopilotDb, input: MetaObservationInput): Promise<boolean>
}

const SELECT = 'SELECT event_key,business_code,channel,owner_id,customer_id,source,source_event_id,native_message_id,' +
  'provider_occurred_at,timestamp_precision,payload_hash,evidence_acceptance,first_verified_at::text AS first_verified_at FROM public.inbox_autopilot_handoff_observations'
const iso = (value: unknown): string | null => {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}
function validatedInput(input: MetaObservationInput) {
  const identity = scopeIdentity(input?.scope)
  if (!['meta_messenger', 'meta_whatsapp'].includes(input.source) ||
    (input.source === 'meta_messenger') !== (input.scope.channel === 'messenger') || input.acceptance !== 'verified_live_webhook')
    throw new Error('handoff_observation_source_invalid')
  assertMessageId(input.sourceEventId); assertMessageId(input.nativeMessageId)
  const occurredAt = iso(input.occurredAt)
  if (!occurredAt || !['second', 'millisecond'].includes(input.timestampPrecision) ||
    input.timestampPrecision === 'second' && Date.parse(occurredAt) % 1000 !== 0 || !/^[a-f0-9]{64}$/.test(input.payloadHash))
    throw new Error('handoff_observation_evidence_invalid')
  return { ...identity, occurredAt, eventKey: handoffReceiptKey(input) }
}
function validRelease(value: HandoffRelease | null): HandoffRelease | null {
  if (!value || value.enabled === false) return null
  if (value.enabled !== true || !iso(value.activatedAt) || !Array.isArray(value.businessCodes) ||
    value.businessCodes.length !== 2 || value.businessCodes[0] !== 'MBM' || value.businessCodes[1] !== 'DBM' || value.journalMaxAgeSeconds !== 600)
    throw new Error('handoff_observation_release_invalid')
  return value
}
function releaseStamp(value: HandoffRelease) { return JSON.stringify([value.enabled, iso(value.activatedAt), value.businessCodes, value.journalMaxAgeSeconds]) }
function fromRow(row: Record<string, any>): StoredMetaObservation {
  const businessKey = row.business_code === 'MBM' ? 'made_by_moris' : row.business_code === 'DBM' ? 'destockage' : null
  if (!businessKey) throw new Error('handoff_observation_scope_invalid')
  const scope: AutopilotScope = row.channel === 'messenger' ? { businessKey, channel: 'messenger', pageId: row.owner_id, psid: row.customer_id }
    : row.channel === 'whatsapp' ? { businessKey, channel: 'whatsapp', phoneNumberId: row.owner_id, waId: row.customer_id }
    : (() => { throw new Error('handoff_observation_scope_invalid') })()
  const stored = { scope, source: row.source, sourceEventId: row.source_event_id, nativeMessageId: row.native_message_id,
    occurredAt: iso(row.provider_occurred_at), timestampPrecision: row.timestamp_precision,
    payloadHash: row.payload_hash, acceptance: row.evidence_acceptance } as MetaObservationInput
  // Preserve PostgreSQL's sub-millisecond timestamp in the keyset cursor. A JS
  // Date truncates it and can repeatedly scan the same last row forever.
  const checked = validatedInput(stored), firstVerifiedAt = typeof row.first_verified_at === 'string' && iso(row.first_verified_at)
    ? row.first_verified_at : iso(row.first_verified_at)
  if (checked.eventKey !== row.event_key || !firstVerifiedAt) throw new Error('handoff_observation_record_invalid')
  return { ...stored, source: stored.source, occurredAt: checked.occurredAt, firstVerifiedAt,
    eventKey: checked.eventKey, historical: false, imported: false, direction: 'out', eventKind: 'message' }
}
function sameStored(input: MetaObservationInput, row: StoredMetaObservation): boolean {
  const a = validatedInput(input), b = validatedInput(row)
  return a.eventKey === b.eventKey && input.nativeMessageId === row.nativeMessageId &&
    a.occurredAt === b.occurredAt && input.timestampPrecision === row.timestampPrecision && input.payloadHash === row.payloadHash
}

/** Durable metadata only. No customer bodies, credentials, provider calls, sends,
 * orders, AI, config changes, handoff mutations or independent processed marker.
 * Core receipt settlement is the authoritative acknowledgement of each capture.
 */
export function createHandoffObservations(deps: ObservationDependencies) {
  return {
    async capture(input: MetaObservationInput): Promise<{ status: 'disabled' | 'inserted' | 'duplicate'; eventKey: string }> {
      const { business, owner, customer, occurredAt, eventKey } = validatedInput(input)
      const db = await deps.connect()
      try {
        await db.query('BEGIN')
        await db.query("SET LOCAL statement_timeout='10s'"); await db.query("SET LOCAL lock_timeout='3s'")
        const release = validRelease(await deps.loadRelease(db))
        if (!release) { await db.query('COMMIT'); return { status: 'disabled', eventKey } }
        // Consistent with handoff/send transactions. The signed-event adapter
        // captures before canonical ingestion acquires any of its write locks.
        const config = (await db.query('SELECT business_code FROM public.inbox_autopilot_config WHERE business_code=$1 FOR UPDATE', [business.code])).rows[0]
        if (config?.business_code !== business.code) throw new Error('handoff_observation_business_missing')
        const now = iso((await db.query('SELECT clock_timestamp() AS observed_at')).rows[0]?.observed_at)
        if (!now || Date.parse(release.activatedAt) > Date.parse(now) || Date.parse(occurredAt) > Date.parse(now) + 60000)
          throw new Error('handoff_observation_time_invalid')
        if (Date.parse(occurredAt) < Date.parse(release.activatedAt)) { await db.query('COMMIT'); return { status: 'disabled', eventKey } }
        const keys = input.scope.channel === 'messenger' ? [JSON.stringify([owner, customer])]
          : ['whatsapp:customer:' + customer, JSON.stringify(['whatsapp:conversation', owner, customer]), 'green:binding:' + owner]
        for (const key of keys) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
        if (await deps.verifyAuthenticatedWitness(db, input) !== true) throw new Error('handoff_observation_authenticated_witness_missing')
        const inserted = await db.query('INSERT INTO public.inbox_autopilot_handoff_observations ' +
          '(event_key,business_code,channel,owner_id,customer_id,source,source_event_id,native_message_id,provider_occurred_at,timestamp_precision,payload_hash,evidence_acceptance) ' +
          'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(event_key) DO NOTHING RETURNING event_key',
        [eventKey, business.code, input.scope.channel, owner, customer, input.source, input.sourceEventId, input.nativeMessageId,
          occurredAt, input.timestampPrecision, input.payloadHash, input.acceptance])
        if (inserted.rows.length > 1) throw new Error('handoff_observation_insert_invalid')
        const status = inserted.rows.length === 1 ? 'inserted' : 'duplicate'
        if (status === 'duplicate') {
          const existing = (await db.query(SELECT + ' WHERE event_key=$1 FOR UPDATE', [eventKey])).rows
          if (existing.length !== 1 || !sameStored(input, fromRow(existing[0]))) throw new Error('handoff_observation_identity_conflict')
        }
        const current = validRelease(await deps.loadRelease(db))
        if (!current || releaseStamp(current) !== releaseStamp(release)) throw new Error('handoff_observation_release_changed')
        await db.query('COMMIT')
        return { status, eventKey }
      } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error }
      finally { await db.end().catch(() => {}) }
    },
    /** Caller owns the transaction; this method acquires no new write locks. */
    async read(db: AutopilotDb, reference: HandoffReference): Promise<StoredMetaObservation | null> {
      const identity = scopeIdentity(reference.scope)
      if (reference.source !== 'meta_messenger' && reference.source !== 'meta_whatsapp') return null
      const release = validRelease(await deps.loadRelease(db))
      if (!release) return null
      const eventKey = handoffReceiptKey(reference)
      const rows = (await db.query(SELECT + ' WHERE event_key=$1 AND business_code=$2 AND channel=$3 AND owner_id=$4 AND customer_id=$5',
        [eventKey, identity.business.code, reference.scope.channel, identity.owner, identity.customer])).rows
      if (!rows.length) return null
      if (rows.length !== 1) throw new Error('handoff_observation_record_invalid')
      const row = fromRow(rows[0])
      if (row.nativeMessageId !== reference.nativeMessageId || row.sourceEventId !== reference.sourceEventId || row.source !== reference.source)
        throw new Error('handoff_observation_reference_conflict')
      if (Date.parse(row.firstVerifiedAt) < Date.parse(release.activatedAt) || Date.parse(row.occurredAt) < Date.parse(release.activatedAt)) return null
      return row
    },
    /** Read-only keyset scan. Advance the returned cursor even for pending-identity
     * receipts, then wrap after the end. Repeatedly reading only the first page
     * would starve new captures behind unresolved older pending identities.
     */
    async scan(db: AutopilotDb, businessKey: BusinessKey, limit: number, cursor: ObservationCursor | null = null): Promise<ObservationScan> {
      const businessCode = businessKey === 'made_by_moris' ? 'MBM' : businessKey === 'destockage' ? 'DBM' : null
      if (!businessCode || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('handoff_observation_scan_invalid')
      if (cursor && (!iso(cursor.firstVerifiedAt) || !/^[a-f0-9]{64}$/.test(cursor.eventKey))) throw new Error('handoff_observation_cursor_invalid')
      const release = validRelease(await deps.loadRelease(db))
      if (!release) return { enabled: false, items: [], hasMore: false, nextCursor: null }
      const rows = (await db.query('SELECT o.event_key,o.business_code,o.channel,o.owner_id,o.customer_id,o.source,o.source_event_id,o.native_message_id,' +
        'o.provider_occurred_at,o.timestamp_precision,o.payload_hash,o.evidence_acceptance,o.first_verified_at::text AS first_verified_at ' +
        'FROM public.inbox_autopilot_handoff_observations o WHERE o.business_code=$1 ' +
        'AND ($2::timestamptz IS NULL OR (o.first_verified_at,o.event_key)>($2::timestamptz,$3::text)) ' +
        'AND o.first_verified_at>=$5::timestamptz AND o.provider_occurred_at>=$5::timestamptz ' +
        'AND (NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_handoff_events h WHERE h.event_key=o.event_key) ' +
        "OR EXISTS(SELECT 1 FROM public.inbox_autopilot_handoff_events h WHERE h.event_key=o.event_key AND h.disposition='pending_identity')) " +
        'ORDER BY o.first_verified_at,o.event_key LIMIT $4', [businessCode, cursor?.firstVerifiedAt ?? null, cursor?.eventKey ?? null, limit + 1, release.activatedAt])).rows
      const items = rows.slice(0, limit).map(fromRow)
      const last = items[items.length - 1]
      return { enabled: true, items, hasMore: rows.length > limit,
        nextCursor: last ? { firstVerifiedAt: last.firstVerifiedAt, eventKey: last.eventKey } : null }
    },
  }
}
