import 'server-only'
import { scopeIdentity } from './contract'
import type { AutopilotDb } from './store'
import type { HandoffEvidence, HandoffReference } from './external-handoff'
import type { GreenBinding } from '@/lib/whatsapp-green/contract'
import { normaliseWebhook, normaliseHistory, stableGreenJson, greenHash } from '@/lib/whatsapp-green/normalise'
import { loadHandoffRelease } from './handoff-release'

const iso = (value: unknown): string | null => {
  const n = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) ? new Date(n).toISOString() : null
}
type Row = Record<string, any>
/** Re-normalise the immutable accepted ledger, not a caller's description.
 * Unknown/unsupported message content still represents an outgoing observation;
 * it can hold a conversation, but never qualifies that conversation for a reply. */
export function verifiedGreenEvent(row: Row, binding: GreenBinding) {
  const received = iso(row.received_at)
  if (!received || !binding.enabled || row.phone_number_id !== binding.phoneNumberId || row.instance_id !== binding.instanceId ||
    !['webhook', 'journal', 'history'].includes(row.origin) || !['processed', 'quarantined'].includes(row.state) ||
    (row.reason && !['UNSUPPORTED_CONTENT', 'PROVIDER_CONFLICT', 'REVISION_ORDER_UNKNOWN'].includes(row.reason))) return null
  try {
    const raw = stableGreenJson(row.raw)
    if (Buffer.byteLength(raw) > 1024 * 1024 || greenHash(raw) !== row.payload_hash || greenHash(row.origin + '\0' + row.payload_hash) !== row.event_key) return null
    const event = row.origin === 'webhook' ? normaliseWebhook(binding, row.raw, received) : normaliseHistory(binding, row.raw, received, row.origin)
    const o = event.observation
    if (!o || !o.waId || o.direction !== 'out' || event.eventKey !== row.event_key || event.payloadHash !== row.payload_hash ||
      event.eventType !== row.event_type || o.waId !== row.wa_id || o.providerChatId !== row.provider_chat_id ||
      o.providerMessageId !== row.provider_message_id || event.providerTimestamp !== iso(row.provider_timestamp) ||
      (event.quarantineReason && event.quarantineReason !== 'UNSUPPORTED_CONTENT')) return null
    return event
  } catch { return null }
}

export async function loadGreenHandoffEvidence(db: AutopilotDb, reference: HandoffReference, bindings: GreenBinding[]): Promise<HandoffEvidence | null> {
  const { owner, customer, business } = scopeIdentity(reference.scope)
  if (reference.source !== 'green_whatsapp' || reference.scope.channel !== 'whatsapp') return null
  const release = await loadHandoffRelease(db)
  const binding = bindings.find(b => b.phoneNumberId === owner && b.key === reference.scope.businessKey && b.enabled)
  if (!release || !binding) return null
  const current = (await db.query('SELECT b.*,n.page_id,n.display_phone,n.can_read FROM public.whatsapp_green_bindings b ' +
    'JOIN public.whatsapp_inbox_numbers n USING(phone_number_id) WHERE b.phone_number_id=$1', [owner])).rows[0]
  if (!current || current.enabled !== true || current.connection_state !== 'authorized' || current.instance_id !== binding.instanceId ||
    current.account_id !== binding.accountId || current.api_host !== new URL(binding.apiUrl).hostname || Number(current.version) !== binding.version ||
    current.can_read !== true || current.page_id !== business.pageId || String(current.display_phone).replace(/\D/g, '') !== binding.businessPhone) return null
  const row = (await db.query('SELECT * FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND instance_id=$2 AND event_key=$3 ' +
    'AND wa_id=$4 AND provider_message_id=$5', [owner, binding.instanceId, reference.sourceEventId, customer, reference.nativeMessageId])).rows[0]
  if (!row || row.origin === 'history' || Date.parse(iso(row.received_at) ?? '') < Date.parse(release.activatedAt)) return null
  const event = verifiedGreenEvent(row, binding)
  if (!event || !event.observation) return null
  let occurredAt = event.providerTimestamp
  if (row.origin === 'journal') {
    // Journal timestamps are last-action time. Only an independently verified
    // exact native-ID webhook/history record can supply original message time.
    const witnesses = (await db.query('SELECT * FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND instance_id=$2 ' +
      "AND wa_id=$3 AND provider_chat_id=$4 AND provider_message_id=$5 AND origin IN ('webhook','history') AND provider_timestamp IS NOT NULL " +
      'ORDER BY received_at ASC,id ASC LIMIT 101', [owner, binding.instanceId, customer, row.provider_chat_id, row.provider_message_id])).rows
    const times = witnesses.map(w => verifiedGreenEvent(w, binding)?.providerTimestamp ?? null)
    if (!times.length || witnesses.length > 100 || times.some(t => !t) || new Set(times).size !== 1) return null
    occurredAt = times[0]
  }
  if (!occurredAt || Date.parse(occurredAt) < Date.parse(release.activatedAt) || Date.parse(occurredAt) % 1000 !== 0) return null
  return { ...reference, acceptance: row.origin === 'webhook' ? 'verified_live_webhook' : 'verified_recent_green_journal',
    historical: false, imported: false, direction: 'out', eventKind: 'message', occurredAt, timestampPrecision: 'second',
    firstVerifiedAt: iso(row.received_at)! }
}
