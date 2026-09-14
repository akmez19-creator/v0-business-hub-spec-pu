import 'server-only'
import type { GreenNativePending, HandoffReference } from './external-handoff'
import { scopeIdentity } from './contract'
import type { GreenBinding } from '@/lib/whatsapp-green/contract'
import { validateGreenBinding } from '@/lib/whatsapp-green/client'
import { verifiedNativeEvent, type GreenSendDb } from './green-native-send'

/** Possible pending identity only. Neither text nor arrival time can establish
 * ownership. Exact accepted native proof is still required before any release. */
export async function loadGreenNativePending(db: GreenSendDb, reference: HandoffReference,
  getBinding: (phoneNumberId: string) => Promise<GreenBinding | null>): Promise<GreenNativePending | null> {
  if (reference.source !== 'green_whatsapp' || reference.scope.channel !== 'whatsapp') return null
  const { business, owner, customer } = scopeIdentity(reference.scope), binding = await getBinding(owner)
  if (!binding || !binding.enabled || binding.key !== reference.scope.businessKey || binding.phoneNumberId !== owner) return null
  try { validateGreenBinding(binding) } catch { return null }
  const current = (await db.query('SELECT b.*,n.page_id,n.display_phone,n.can_read FROM public.whatsapp_green_bindings b JOIN public.whatsapp_inbox_numbers n USING(phone_number_id) WHERE b.phone_number_id=$1', [owner])).rows[0]
  if (!current || current.enabled !== true || current.connection_state !== 'authorized' || (current.last_error != null && current.last_error !== 'QUARANTINED_EVENTS') ||
    current.instance_id !== binding.instanceId || current.account_id !== binding.accountId || Number(current.version) !== binding.version ||
    current.api_host !== new URL(binding.apiUrl).hostname || current.can_read !== true || current.page_id !== business.pageId ||
    String(current.display_phone).replace(/\D/g,'') !== binding.businessPhone) return null
  const events = (await db.query('SELECT * FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND instance_id=$2 AND wa_id=$3 AND provider_chat_id=$4 AND provider_message_id=$5 AND event_key=$6',
    [owner,binding.instanceId,customer,customer+'@c.us',reference.nativeMessageId,reference.sourceEventId])).rows
  if (events.length !== 1 || !verifiedNativeEvent(events[0],binding,'out')) return null
  const attempts = (await db.query("SELECT attempt_id FROM public.inbox_autopilot_green_sends WHERE business_code=$1 AND phone_number_id=$2 AND wa_id=$3 AND instance_id=$4 AND account_id=$5 AND chat_id=$6 AND binding_version=$7 AND state='sending' AND provider_message_id IS NULL AND request_token IS NOT NULL AND started_at>clock_timestamp()-interval '120 seconds' AND started_at<=clock_timestamp() LIMIT 2",
    [business.code,owner,customer,binding.instanceId,binding.accountId,customer+'@c.us',binding.version])).rows
  if (attempts.length !== 1 || typeof attempts[0].attempt_id !== 'string') return null
  return { ...reference,proof:'verified_green_native_pending',provider:'green-api',attemptId:attempts[0].attempt_id,
    instanceId:binding.instanceId,chatId:customer+'@c.us',bindingVersion:binding.version }
}
