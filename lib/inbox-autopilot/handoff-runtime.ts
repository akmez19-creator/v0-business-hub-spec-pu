import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { stableHash } from './stable-hash'
import { AUTOPILOT_BUSINESSES, scopeIdentity, type AutopilotScope, type BusinessKey } from './contract'
import type { AutopilotDb } from './store'
import { createExternalHandoff, type HandoffReference } from './external-handoff'
import { createHandoffObservations } from './handoff-observations'
import { loadHandoffRelease } from './handoff-release'
import { validatedMetaObservation } from './handoff-meta-evidence'

async function withDb<T>(read: (db: AutopilotDb) => Promise<T>): Promise<T> {
  const db = await connectInboxDatabase()
  try { return await read(db) } finally { await db.end().catch(() => {}) }
}
function scopeFor(channel: 'messenger' | 'whatsapp', owner: string, customer: string): AutopilotScope | null {
  const businessKey = (Object.keys(AUTOPILOT_BUSINESSES) as BusinessKey[]).find(key =>
    (channel === 'messenger' ? AUTOPILOT_BUSINESSES[key].pageId : AUTOPILOT_BUSINESSES[key].phoneNumberId) === owner)
  if (!businessKey) return null
  const scope: AutopilotScope = channel === 'messenger' ? { businessKey, channel, pageId: owner, psid: customer }
    : { businessKey, channel, phoneNumberId: owner, waId: customer }
  scopeIdentity(scope)
  return scope
}
const observations = createHandoffObservations({
  connect: connectInboxDatabase,
  loadRelease: loadHandoffRelease,
  // This shared repository is read-only. Capture requires the per-call trusted
  // wrapper below, after the route has authenticated the complete request.
  verifyAuthenticatedWitness: async () => false,
})
const handoff = createExternalHandoff({
  connect: connectInboxDatabase,
  loadPersistedEvidence: async (db, reference) => observations.read(db, reference),
  loadJournalWindow: async db => {
    const release = await loadHandoffRelease(db)
    return release ? { activatedAt: release.activatedAt, maxAgeSeconds: release.journalMaxAgeSeconds } : null
  },
})
async function settle(reference: HandoffReference) {
  const result = await handoff.observe(reference)
  if (result.status === 'pending_identity' || result.status === 'duplicate') await handoff.resolvePending(reference)
}

/** Only signed, live outgoing MESSAGE branches call this before canonical commit.
 * History imports, delivery/read statuses, marketing broadcasts and incoming
 * messages do not pass this boundary. Caller awaits completion before HTTP ack. */
export async function observeMetaOutgoing(channel: 'messenger' | 'whatsapp', owner: string, customer: string,
  nativeMessageId: string, occurredAt: string, rawEvent: unknown): Promise<void> {
  const scope = scopeFor(channel, owner, customer)
  if (!scope || !await withDb(loadHandoffRelease)) return
  const input = validatedMetaObservation(channel, owner, customer, nativeMessageId, occurredAt, rawEvent)
  if (!input) return
  const capture = createHandoffObservations({ connect: connectInboxDatabase, loadRelease: loadHandoffRelease,
    verifyAuthenticatedWitness: async (_db, checked) => checked === input })
  const captured = await capture.capture(input)
  if (captured.status !== 'disabled') await settle(input)
}

type CatchupCursor = { schema: 1; activatedAt: string; nextLane: number; after: Array<string | null> }
function catchupCursor(raw: unknown, activatedAt: string): CatchupCursor {
  const empty: CatchupCursor = { schema: 1, activatedAt, nextLane: 0, after: [null, null, null] }
  if (typeof raw !== 'string' || raw.length > 1024) return empty
  try {
    const value = JSON.parse(raw)
    if (!value || value.schema !== 1 || value.activatedAt !== activatedAt ||
      !Number.isInteger(value.nextLane) || value.nextLane < 0 || value.nextLane > 2 ||
      !Array.isArray(value.after) || value.after.length !== 3 ||
      value.after.some((key: unknown) => key !== null && (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) ||
      Object.keys(value).sort().join(',') !== 'activatedAt,after,nextLane,schema') return empty
    return value
  } catch { return empty }
}

/** A per-conversation catch-up includes all accepted observations. Uncertain
 * outcomes stay held; nothing in this function sends or resets a job. Called
 * outside a worker's send transaction before planning and after provider ack. */
export async function reconcileHandoffScope(scope: AutopilotScope): Promise<{ complete: boolean }> {
  const startedAt = Date.now()
  const { business, owner, customer } = scopeIdentity(scope)
  const cursorKey = 'inbox:autopilot:handoff:catchup:v1:' + stableHash(JSON.stringify([business.code, scope.channel, owner, customer]))
  const inventory = await withDb(async db => {
    const release = await loadHandoffRelease(db)
    if (!release) return null
    const stored = (await db.query('SELECT cursor FROM public.inbox_sync_state WHERE key=$1', [cursorKey])).rows[0]
    const original = typeof stored?.cursor === 'string' ? stored.cursor : null
    const cursor = catchupCursor(original, release.activatedAt)
    const meta = (await db.query('SELECT source,source_event_id,native_message_id,o.event_key AS cursor_key FROM public.inbox_autopilot_handoff_observations o ' +
      'WHERE o.business_code=$1 AND o.channel=$2 AND o.owner_id=$3 AND o.customer_id=$4 ' +
      'AND o.first_verified_at>=$5::timestamptz AND o.provider_occurred_at>=$5::timestamptz ' +
      'AND (NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_handoff_events h WHERE h.event_key=o.event_key) OR ' +
      "EXISTS(SELECT 1 FROM public.inbox_autopilot_handoff_events h WHERE h.event_key=o.event_key AND h.disposition='pending_identity')) " +
      'ORDER BY CASE WHEN $6::text IS NULL OR o.event_key>$6::text THEN 0 ELSE 1 END,o.event_key LIMIT 101',
    [business.code, scope.channel, owner, customer, release.activatedAt, cursor.after[0]])).rows
    const pending = (await db.query('SELECT source,source_event_id,native_message_id,event_key AS cursor_key FROM public.inbox_autopilot_handoff_events ' +
      "WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND source='green_whatsapp' AND disposition='pending_identity' " +
      'ORDER BY CASE WHEN $5::text IS NULL OR event_key>$5::text THEN 0 ELSE 1 END,event_key LIMIT 101',
    [business.code, scope.channel, owner, customer, cursor.after[1]])).rows
    // Lane 3 held GREEN-API's own outgoing ledger; the Meta record is now the only source.
    return { lanes: [meta, pending, []], cursor, original }
  })
  if (!inventory) return { complete: true }
  const { lanes, cursor, original } = inventory
  const total = lanes.reduce((sum, lane) => sum + lane.length, 0), positions = [0, 0, 0]
  let processed = 0
  while (processed < 8 && processed < total) {
    // Finish each started transaction; do not abandon it to meet a clock limit.
    if (Date.now() - startedAt >= 4000) break
    let lane = cursor.nextLane
    for (let skipped = 0; skipped < 3 && positions[lane] >= lanes[lane].length; skipped++) lane = (lane + 1) % 3
    const row = lanes[lane][positions[lane]]
    if (!row || typeof row.cursor_key !== 'string' || !/^[a-f0-9]{64}$/.test(row.cursor_key))
      throw new Error('handoff_catchup_cursor_invalid')
    await settle({ scope, source: row.source, sourceEventId: row.source_event_id, nativeMessageId: row.native_message_id })
    // Progress is only a fair scan position, never an acknowledgement. Retained
    // ignored/pending references are revisited after wrapping their lane.
    cursor.after[lane] = row.cursor_key
    cursor.nextLane = (lane + 1) % 3
    positions[lane]++
    processed++
  }
  if (!processed) return { complete: total === 0 }
  const saved = await withDb(async db => {
    const current = await loadHandoffRelease(db)
    if (!current || current.activatedAt !== cursor.activatedAt) return false
    const result = await db.query('INSERT INTO public.inbox_sync_state(key,cursor) VALUES($1,$2) ' +
      'ON CONFLICT(key) DO UPDATE SET cursor=EXCLUDED.cursor WHERE inbox_sync_state.cursor IS NOT DISTINCT FROM $3::text RETURNING key',
    [cursorKey, JSON.stringify(cursor), original])
    return result.rows.length === 1
  })
  return { complete: saved && processed === total }
}

/** In the already locked final send transaction, newly committed but unprocessed
 * Meta observations block the send. Failures propagate; they never permit it. */
export async function hasUnprocessedHandoff(db: AutopilotDb, scope: AutopilotScope): Promise<boolean> {
  const { business, owner, customer } = scopeIdentity(scope)
  const release = await loadHandoffRelease(db)
  if (!release) return false
  const row = (await db.query('SELECT 1 FROM public.inbox_autopilot_handoff_observations o ' +
    'WHERE o.business_code=$1 AND o.channel=$2 AND o.owner_id=$3 AND o.customer_id=$4 ' +
    'AND o.first_verified_at>=$5::timestamptz AND o.provider_occurred_at>=$5::timestamptz ' +
    'AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_handoff_events h WHERE h.event_key=o.event_key) LIMIT 1',
  [business.code, scope.channel, owner, customer, release.activatedAt])).rows[0]
  return !!row
}
