import 'server-only'
import { randomUUID } from 'node:crypto'
import { validateGreenBinding, GREEN_CLIENT_LIMITS } from '@/lib/whatsapp-green/client'
import { GREEN_SCOPES, type GreenBinding } from '@/lib/whatsapp-green/contract'
import { normaliseWebhook, normaliseHistory, stableGreenJson, greenHash } from '@/lib/whatsapp-green/normalise'

export type GreenSendScope = { businessKey: 'made_by_moris' | 'destockage'; channel: 'whatsapp'; phoneNumberId: string; waId: string }
export type GreenSendInput = { scope: GreenSendScope; inboundMessageId: string; inboundEventKey: string;
  bindingVersion: number; configVersion: number; contextFingerprint: string; text: string }
export type GreenSendDb = { query(sql: string, values?: any[]): Promise<{ rows: Record<string, any>[]; rowCount?: number | null }>; end(): Promise<unknown> }
export type GreenSendResult = { attemptId: string; state: 'sending' | 'accepted' | 'unknown'; messageId: string | null;
  savedLocally: boolean; dispatched: boolean }
export type GreenSendDependencies = {
  connect(): Promise<GreenSendDb>
  authorizeScope(scope: GreenSendScope): Promise<void>
  getBinding(phoneNumberId: string): Promise<GreenBinding | null>
  /** Mandatory integration gate, on the locked intent transaction. It must
   * re-read GREEN-native enrollment/context, enforce policy and reserve the
   * existing engine budget/job exactly once. Never calls a provider or model.
   * No existing Meta/unknown send intent may be relabelled as a GREEN attempt. */
  authorizeAndReserve(db: GreenSendDb, input: GreenSendInput, binding: GreenBinding, intent: {attemptId:string}): Promise<boolean>
  fetchImpl?: typeof fetch
  /** Test-only lower timeout. Production callers cannot raise the existing client bound. */
  timeoutMs?: number
}
export class GreenNativeSendError extends Error {
  constructor(public code: string) { super(code); this.name = 'GreenNativeSendError' }
}
const fail = (code: string): never => { throw new GreenNativeSendError(code) }
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(v)
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const codeOf = (scope: GreenSendScope) => scope.businessKey === 'destockage' ? 'DBM' : 'MBM'
function checked(input: GreenSendInput) {
  const s = input?.scope, known = GREEN_SCOPES.find(b => b.key === s?.businessKey && b.phoneNumberId === s?.phoneNumberId)
  if (!known || s.channel !== 'whatsapp' || !/^\d{5,20}$/.test(s.waId) || !id(input.inboundMessageId) ||
    !hash(input.inboundEventKey) || !hash(input.contextFingerprint) || !positive(input.bindingVersion) || !positive(input.configVersion) ||
    typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000 || Buffer.byteLength(input.text) > 16000 || /[\u0000]/.test(input.text)) return fail('INVALID_SEND_INPUT')
  return known
}
function checkedBinding(input: GreenSendInput, value: GreenBinding | null): GreenBinding {
  const known = checked(input)
  if (!value || !value.enabled || value.key !== known.key || value.phoneNumberId !== known.phoneNumberId ||
    value.pageId !== known.pageId || value.businessPhone !== known.businessPhone || value.version !== input.bindingVersion) return fail('BINDING_UNAVAILABLE')
  try { validateGreenBinding(value) } catch { return fail('BINDING_UNAVAILABLE') }
  return { ...value }
}
const valuesFor = (input: GreenSendInput, b: GreenBinding) => [codeOf(input.scope),input.scope.phoneNumberId,input.scope.waId,b.instanceId,input.inboundMessageId]
const utc = (v: unknown) => v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN
const view = (row: Record<string, any>, dispatched: boolean, savedLocally = true): GreenSendResult => {
  if (!['sending','accepted','unknown'].includes(row.state) || !id(row.attempt_id) ||
    row.state === 'accepted' && !id(row.provider_message_id)) return fail('ATTEMPT_RECORD_INVALID')
  return { attemptId: row.attempt_id, state: row.state, messageId: row.provider_message_id ?? null, dispatched, savedLocally }
}

/** Validate the immutable authenticated event ledger using the deployed parser.
 * No journal last-action timestamp, text similarity or Meta-ID conversion. */
export function verifiedNativeEvent(row: Record<string, any>, binding: GreenBinding, direction: 'in' | 'out') {
  try {
    if (!['webhook', 'journal'].includes(row.origin) || row.state !== 'processed' || row.reason != null || row.phone_number_id !== binding.phoneNumberId ||
      row.instance_id !== binding.instanceId || !Number.isFinite(utc(row.received_at))) return null
    const raw = stableGreenJson(row.raw)
    if (Buffer.byteLength(raw) > 1024 * 1024 || greenHash(raw) !== row.payload_hash || greenHash(row.origin + '\0' + row.payload_hash) !== row.event_key) return null
    const receivedAt = new Date(utc(row.received_at)).toISOString()
    const event = row.origin === 'webhook' ? normaliseWebhook(binding, row.raw, receivedAt) : normaliseHistory(binding, row.raw, receivedAt, 'journal'), o = event.observation
    if (!o || o.direction !== direction || o.kind !== 'text' || !o.text || o.edited || event.quarantineReason ||
      event.eventKey !== row.event_key || event.eventType !== row.event_type || o.providerMessageId !== row.provider_message_id ||
      o.providerChatId !== row.provider_chat_id || o.waId !== row.wa_id) return null
    if (row.origin === 'webhook') {
      if (!event.providerTimestamp || utc(event.providerTimestamp) !== utc(row.provider_timestamp) ||
        event.eventType !== (direction === 'in' ? 'incomingMessageReceived' : 'outgoingAPIMessageReceived')) return null
    } else {
      // Journal timestamps can be last-action time, so the record proves identity, direction and text only; callers
      // take the message time from the stored row. An outbound journal record is ours only when the provider says so.
      if (event.providerTimestamp != null || row.provider_timestamp != null || (direction === 'out' && (row.raw as Record<string, any>)?.sendByApi !== true)) return null
    }
    return event
  } catch { return null }
}

async function dispatch(binding: GreenBinding, chatId: string, text: string, deps: GreenSendDependencies): Promise<string> {
  const controller = new AbortController(), duration = positive(deps.timeoutMs) ? Math.min(deps.timeoutMs, GREEN_CLIENT_LIMITS.timeoutMs) : GREEN_CLIENT_LIMITS.timeoutMs
  let expired = false, rejectTimeout!: (error: Error) => void
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject })
  const timer = setTimeout(() => { expired = true; controller.abort(); rejectTimeout(new GreenNativeSendError('SEND_OUTCOME_UNKNOWN')) }, duration)
  const race = <T>(work: Promise<T>) => Promise.race([work, timeout])
  try {
    const pending = (deps.fetchImpl ?? fetch)(`${binding.apiUrl}/waInstance${binding.instanceId}/sendMessage/${binding.apiToken}`, {
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ chatId, message: text, linkPreview: false }),
    })
    void pending.then(response => { if (expired) void response.body?.cancel().catch(() => {}) }, () => {})
    const response = await race(pending)
    if (response.redirected || response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body)
      return fail('SEND_OUTCOME_UNKNOWN')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let bytes = 0, finished = false
    try {
      for (;;) {
        const part = await race(reader.read()); if (part.done) { finished = true; break }
        bytes += part.value.byteLength; if (bytes > 8192) return fail('SEND_OUTCOME_UNKNOWN'); chunks.push(part.value)
      }
      let parsed: unknown
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return fail('SEND_OUTCOME_UNKNOWN') }
      const result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).idMessage : null
      return id(result) ? result : fail('SEND_OUTCOME_UNKNOWN')
    } finally { if (!finished) void reader.cancel().catch(() => {}); reader.releaseLock() }
  } catch { return fail('SEND_OUTCOME_UNKNOWN') }
  finally { clearTimeout(timer); controller.abort() }
}

/** Isolated GREEN transport. No import-time actions and no automatic resend path.
 * Sending/unknown rows without a response ID remain unresolved indefinitely. */
export function createGreenNativeSender(deps: GreenSendDependencies) {
  async function database<T>(run: (db: GreenSendDb) => Promise<T>) {
    let db: GreenSendDb
    try { db = await deps.connect() } catch { return fail('SEND_STORE_UNAVAILABLE') }
    try { return await run(db) } catch (error) { if (error instanceof GreenNativeSendError) throw error; return fail('SEND_STORE_UNAVAILABLE') }
    finally { await db.end().catch(() => {}) }
  }
  async function intent(input: GreenSendInput, binding: GreenBinding) {
    return database(async db => {
      await db.query('BEGIN')
      try {
        await db.query("SET LOCAL lock_timeout='3s'"); await db.query("SET LOCAL statement_timeout='10s'")
        const config = (await db.query('SELECT business_code,enabled,version FROM public.inbox_autopilot_config WHERE business_code=$1 FOR UPDATE', [codeOf(input.scope)])).rows[0]
        for (const key of ['whatsapp:customer:' + input.scope.waId,JSON.stringify(['whatsapp:conversation',input.scope.phoneNumberId,input.scope.waId]),'green:binding:' + binding.phoneNumberId])
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
        const previous = (await db.query('SELECT * FROM public.inbox_autopilot_green_sends WHERE business_code=$1 AND phone_number_id=$2 AND wa_id=$3 AND instance_id=$4 AND inbound_message_id=$5', valuesFor(input,binding))).rows[0]
        if (previous) {
          if (previous.chat_id !== input.scope.waId + '@c.us' || previous.account_id !== binding.accountId || previous.binding_version != binding.version ||
            previous.inbound_event_key !== input.inboundEventKey || previous.context_fingerprint !== input.contextFingerprint || previous.reply_text !== input.text) fail('EXISTING_ATTEMPT_CONFLICT')
          await db.query('COMMIT'); return { created: false as const, row: previous }
        }
        if (config?.enabled !== true || Number(config.version) !== input.configVersion) fail('BUSINESS_NOT_APPROVED')
        const held = (await db.query('SELECT paused FROM public.inbox_autopilot_controls WHERE business_code=$1 AND channel=\'whatsapp\' AND owner_id=$2 AND customer_id=$3', [codeOf(input.scope),input.scope.phoneNumberId,input.scope.waId])).rows[0]
        if (held?.paused === true) fail('CONVERSATION_HELD')
        const current = (await db.query('SELECT b.*,n.page_id,n.display_phone,n.can_read,n.can_send FROM public.whatsapp_green_bindings b JOIN public.whatsapp_inbox_numbers n USING(phone_number_id) WHERE b.phone_number_id=$1', [binding.phoneNumberId])).rows[0]
        if (!current || current.enabled !== true || current.connection_state !== 'authorized' || (current.last_error != null && current.last_error !== 'QUARANTINED_EVENTS') ||
          current.instance_id !== binding.instanceId || current.account_id !== binding.accountId || current.api_host !== new URL(binding.apiUrl).hostname ||
          Number(current.version) !== binding.version || current.can_read !== true || current.can_send !== true || current.page_id !== binding.pageId ||
          String(current.display_phone).replace(/\D/g,'') !== binding.businessPhone) fail('BINDING_UNAVAILABLE')
        const time = utc((await db.query('SELECT clock_timestamp() AS observed_at')).rows[0]?.observed_at)
        const inbound = (await db.query('SELECT * FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND instance_id=$2 AND wa_id=$3 AND event_key=$4 AND provider_message_id=$5',
          [binding.phoneNumberId,binding.instanceId,input.scope.waId,input.inboundEventKey,input.inboundMessageId])).rows[0]
        const event = inbound && verifiedNativeEvent(inbound,binding,'in')
        // The 24h window is measured from the stored message time, which the history proof pinned; a journal
        // witness has no time of its own and `utc(null)` is NaN, which would pass every comparison silently.
        const stored = event && (await db.query("SELECT provider_accepted_at FROM public.whatsapp_green_messages WHERE phone_number_id=$1 AND instance_id=$2 AND wa_id=$3 AND provider_message_id=$4 AND direction='in' AND kind='text'",
          [binding.phoneNumberId,binding.instanceId,input.scope.waId,input.inboundMessageId])).rows[0]
        const messageTime = event?.providerTimestamp ? utc(event.providerTimestamp) : utc(stored?.provider_accepted_at)
        if (!Number.isFinite(time) || !event?.observation || event.observation.providerChatId !== input.scope.waId + '@c.us' || !Number.isFinite(messageTime) ||
          messageTime > time || time - messageTime >= 24 * 60 * 60 * 1000) fail('INBOUND_NOT_VERIFIED')
        const unresolved = (await db.query("SELECT attempt_id FROM public.inbox_autopilot_green_sends WHERE phone_number_id=$1 AND wa_id=$2 AND state IN ('sending','unknown') LIMIT 1",[binding.phoneNumberId,input.scope.waId])).rows[0]
        if (unresolved) fail('PRIOR_ATTEMPT_UNRESOLVED')
        const recent = (await db.query("SELECT attempt_id FROM public.inbox_autopilot_green_sends WHERE phone_number_id=$1 AND instance_id=$2 AND started_at>clock_timestamp()-interval '1050 milliseconds' LIMIT 1",[binding.phoneNumberId,binding.instanceId])).rows[0]
        if (recent) fail('INSTANCE_RATE_WINDOW')
        const attemptId = randomUUID(), token = randomUUID()
        if (typeof deps.authorizeAndReserve !== 'function' || await deps.authorizeAndReserve(db,input,binding,{attemptId}) !== true) fail('SEND_NOT_AUTHORIZED')
        const row = (await db.query('INSERT INTO public.inbox_autopilot_green_sends(attempt_id,business_code,phone_number_id,wa_id,instance_id,account_id,chat_id,binding_version,config_version,inbound_message_id,inbound_event_key,context_fingerprint,reply_text,request_token,state) ' +
          "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'sending') RETURNING *",
          [attemptId,codeOf(input.scope),binding.phoneNumberId,input.scope.waId,binding.instanceId,binding.accountId,input.scope.waId+'@c.us',binding.version,input.configVersion,input.inboundMessageId,input.inboundEventKey,input.contextFingerprint,input.text,token])).rows[0]
        if (!row || row.attempt_id !== attemptId) fail('INTENT_NOT_PERSISTED')
        await db.query('COMMIT'); return { created: true as const, row, token }
      } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error }
    })
  }
  async function outcome(attemptId: string, token: string, messageId: string | null) {
    return database(async db => {
      const result = messageId === null
        ? await db.query("UPDATE public.inbox_autopilot_green_sends SET state='unknown',reason='provider_outcome_unknown',updated_at=clock_timestamp() WHERE attempt_id=$1 AND request_token=$2 AND state='sending' RETURNING *",[attemptId,token])
        : await db.query("UPDATE public.inbox_autopilot_green_sends SET state='accepted',provider_message_id=$3,accepted_at=clock_timestamp(),reason=NULL,updated_at=clock_timestamp() WHERE attempt_id=$1 AND request_token=$2 AND state IN ('sending','unknown') AND provider_message_id IS NULL RETURNING *",[attemptId,token,messageId])
      if (result.rows.length !== 1) fail('OUTCOME_NOT_PERSISTED')
      return result.rows[0]
    })
  }
  return {
    async sendOnce(original: GreenSendInput): Promise<GreenSendResult> {
      // Capture caller data before any await; a changed draft cannot change the
      // already approved request or its durable identity.
      const input: GreenSendInput = { ...original, scope: { ...original?.scope } }
      checked(input); await deps.authorizeScope(input.scope)
      const binding = checkedBinding(input,await deps.getBinding(input.scope.phoneNumberId))
      const reserved = await intent(input,binding)
      if (!reserved.created) return view(reserved.row,false)
      let messageId: string, dispatched = false
      try {
        const latest = checkedBinding(input,await deps.getBinding(input.scope.phoneNumberId))
        if (latest.instanceId !== binding.instanceId || latest.accountId !== binding.accountId || latest.apiUrl !== binding.apiUrl || latest.apiToken !== binding.apiToken) fail('BINDING_UNAVAILABLE')
        dispatched = true
        messageId = await dispatch(binding,input.scope.waId+'@c.us',input.text,deps)
      } catch {
        try { return view(await outcome(reserved.row.attempt_id,reserved.token,null),dispatched) }
        catch { return { attemptId: reserved.row.attempt_id,state:'unknown',messageId:null,savedLocally:false,dispatched } }
      }
      try { return view(await outcome(reserved.row.attempt_id,reserved.token,messageId),true) }
      catch { return { attemptId:reserved.row.attempt_id,state:'accepted',messageId,savedLocally:false,dispatched:true } }
    },
  }
}
