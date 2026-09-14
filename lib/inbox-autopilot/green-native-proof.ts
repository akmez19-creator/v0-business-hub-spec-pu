import 'server-only'
import type { HandoffReference } from './external-handoff'
import { scopeIdentity } from './contract'
import { validateGreenBinding } from '@/lib/whatsapp-green/client'
import type { GreenBinding } from '@/lib/whatsapp-green/contract'
import { verifiedNativeEvent, type GreenSendDb } from './green-native-send'

/** A GREEN-native own-attempt proof, NOT an ExactProviderIdentity/Meta mapping.
 * Core must explicitly support this discriminator before using it to exempt
 * an echo. Never pass providerMessageId to the current untagged Meta-job query. */
export type GreenNativeHandoffProof = HandoffReference & {
  proof: 'verified_green_native_send'; provider: 'green-api'; attemptId: string;
  instanceId: string; chatId: string; bindingVersion: number; providerMessageId: string;
}
export async function loadGreenNativeHandoffProof(db: GreenSendDb, reference: HandoffReference,
  getBinding: (phoneNumberId: string) => Promise<GreenBinding | null>): Promise<GreenNativeHandoffProof | null> {
  if (reference.source !== 'green_whatsapp' || reference.scope.channel !== 'whatsapp') return null
  const { business, owner, customer } = scopeIdentity(reference.scope), binding = await getBinding(owner)
  if (!binding || !binding.enabled || binding.key !== reference.scope.businessKey || binding.phoneNumberId !== owner) return null
  try { validateGreenBinding(binding) } catch { return null }
  const current = (await db.query('SELECT b.*,n.page_id,n.display_phone,n.can_read FROM public.whatsapp_green_bindings b JOIN public.whatsapp_inbox_numbers n USING(phone_number_id) WHERE b.phone_number_id=$1', [owner])).rows[0]
  if (!current || current.enabled !== true || current.connection_state !== 'authorized' || (current.last_error != null && current.last_error !== 'QUARANTINED_EVENTS') ||
    current.instance_id !== binding.instanceId || current.account_id !== binding.accountId || Number(current.version) !== binding.version ||
    current.api_host !== new URL(binding.apiUrl).hostname || current.can_read !== true || current.page_id !== business.pageId ||
    String(current.display_phone).replace(/\D/g,'') !== binding.businessPhone) return null
  const rows = (await db.query('SELECT * FROM public.inbox_autopilot_green_sends WHERE business_code=$1 AND phone_number_id=$2 AND wa_id=$3 AND instance_id=$4 AND chat_id=$5 AND provider_message_id=$6 AND state=\'accepted\' LIMIT 2',
    [business.code,owner,customer,binding.instanceId,customer+'@c.us',reference.nativeMessageId])).rows
  if (rows.length !== 1) return null
  const attempt = rows[0]
  if (attempt.business_code !== business.code || attempt.phone_number_id !== owner || attempt.wa_id !== customer ||
    attempt.instance_id !== binding.instanceId || attempt.chat_id !== customer+'@c.us' || attempt.provider_message_id !== reference.nativeMessageId ||
    attempt.state !== 'accepted' || attempt.account_id !== binding.accountId || Number(attempt.binding_version) !== binding.version ||
    !Number.isFinite(new Date(attempt.accepted_at).getTime()) || !attempt.accepted_at ||
    typeof attempt.attempt_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(attempt.attempt_id) ||
    typeof attempt.reply_text !== 'string' || !attempt.reply_text.trim()) return null
  const events = (await db.query('SELECT * FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND instance_id=$2 AND wa_id=$3 AND provider_chat_id=$4 AND provider_message_id=$5 AND event_key=$6',
    [owner,binding.instanceId,customer,customer+'@c.us',reference.nativeMessageId,reference.sourceEventId])).rows
  if (events.length !== 1) return null
  const event = verifiedNativeEvent(events[0],binding,'out')
  // Exact native identity establishes the link. Equality below is only a
  // consistency veto, never a search/matching strategy for unknown IDs.
  if (!event?.observation || event.eventKey !== reference.sourceEventId || event.observation.providerMessageId !== reference.nativeMessageId ||
    event.observation.waId !== customer || event.observation.text !== attempt.reply_text || event.observation.providerChatId !== customer+'@c.us') return null
  return { ...reference, proof:'verified_green_native_send',provider:'green-api',attemptId:attempt.attempt_id,
    instanceId:binding.instanceId,chatId:customer+'@c.us',bindingVersion:binding.version,providerMessageId:reference.nativeMessageId }
}
