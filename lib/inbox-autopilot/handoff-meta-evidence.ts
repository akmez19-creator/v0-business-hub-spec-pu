import 'server-only'
import { AUTOPILOT_BUSINESSES, assertMessageId, scopeIdentity, type AutopilotScope, type BusinessKey } from './contract'
import type { MetaObservationInput } from './handoff-observations'
import { greenHash, stableGreenJson } from '@/lib/whatsapp-green/normalise'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}

/** Only the HMAC-verified live outgoing webhook branch may call this function.
 * The external reply already happened. Persist its hold before canonical
 * ingestion so a worker cannot send between that write and the hold.
 * A later canonical failure remains retryable without dropping this evidence.
 */
export function validatedMetaObservation(channel: 'messenger' | 'whatsapp', owner: string, customer: string,
  nativeMessageId: string, occurredAt: string, rawEvent: unknown): MetaObservationInput | null {
  const businessKey = (Object.keys(AUTOPILOT_BUSINESSES) as BusinessKey[]).find(key =>
    (channel === 'messenger' ? AUTOPILOT_BUSINESSES[key].pageId : AUTOPILOT_BUSINESSES[key].phoneNumberId) === owner)
  if (!businessKey) return null
  const scope: AutopilotScope = channel === 'messenger' ? { businessKey, channel, pageId: owner, psid: customer }
    : { businessKey, channel, phoneNumberId: owner, waId: customer }
  scopeIdentity(scope); assertMessageId(nativeMessageId)
  const timestamp = Date.parse(occurredAt), raw = object(rawEvent)
  const fail = () => { throw new Error('handoff_authenticated_event_invalid') }
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== occurredAt ||
    raw.imported === true || raw.historical === true || raw._akmez_imported === true) return fail()
  if (channel === 'messenger') {
    const message = object(raw.message)
    if (object(raw.sender).id !== owner || object(raw.recipient).id !== customer || message.mid !== nativeMessageId ||
      message.is_echo !== true || typeof raw.timestamp !== 'number' || raw.timestamp !== timestamp ||
      (message.attachments != null && stableGreenJson(message.attachments).includes('notification_messages_'))) return fail()
  } else {
    // The enclosing signed webhook branch supplies the number and excludes
    // history/status batches. `to` is the client, never the business sender.
    if (raw.to !== customer || raw.id !== nativeMessageId || typeof raw.type !== 'string' || !raw.type ||
      typeof raw.timestamp !== 'string' || !/^\d+$/.test(raw.timestamp) || Number(raw.timestamp) * 1000 !== timestamp ||
      timestamp % 1000 !== 0) return fail()
  }
  const payload = stableGreenJson(rawEvent)
  if (Buffer.byteLength(payload) > 1024 * 1024) return fail()
  const payloadHash = greenHash(payload)
  return { scope, source: channel === 'messenger' ? 'meta_messenger' : 'meta_whatsapp', sourceEventId: payloadHash,
    nativeMessageId, occurredAt, timestampPrecision: channel === 'messenger' ? 'millisecond' : 'second',
    payloadHash, acceptance: 'verified_live_webhook' }
}
