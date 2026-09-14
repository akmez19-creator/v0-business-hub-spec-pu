import 'server-only'
import { createHash } from 'node:crypto'

export type ContextScope = ({ channel: 'messenger'; pageId: string; psid: string } |
  { channel: 'whatsapp'; phoneNumberId: string; waId: string }) & { businessKey?: 'destockage' | 'made_by_moris' }
export type ContextDb = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<unknown> }
export type ContextDependencies = {
  /** Mandatory server-side operator/worker authorization. Never accept browser-supplied transcript/permissions. */
  authorizeScope(scope: ContextScope): Promise<void>
  connectDatabase(): Promise<ContextDb>
  /** Current server configuration only. Do not return provider credentials. */
  getGreenBinding?(phoneNumberId: string): Promise<{ instanceId: string; version: number; enabled: boolean } | null>
  now?: () => Date
  /** Server-only integration option: existing transaction/locks and connection cleanup belong to caller. */
  transaction?: 'owned' | 'caller'
}
export type ContextMessage = { id: string; direction: 'in' | 'out'; text: string; createdAt: string }
export type MessengerChronology = { version: 1; groups: Array<{ second: string; order: 'single' | 'unordered'; messages: ContextMessage[] }>; evidenceMessageIds: string[]; hasUnorderedHistory: boolean; latestUnambiguous: boolean }
/** Equal-second historical messages are a set, never an inferred sequence. */
export function messengerChronology(messages: readonly ContextMessage[]): MessengerChronology {
  const bySecond = new Map<string, ContextMessage[]>()
  for (const message of messages) {
    const at = Date.parse(message.createdAt)
    if (!Number.isFinite(at)) throw new ContextError('CONTEXT_UNAVAILABLE')
    const key = new Date(Math.floor(at / 1000) * 1000).toISOString()
    const group = bySecond.get(key) ?? []; group.push(message); bySecond.set(key, group)
  }
  const groups = [...bySecond].sort(([a],[b]) => a.localeCompare(b)).map(([second, members]) => ({
    second, order: members.length === 1 ? 'single' as const : 'unordered' as const,
    messages: [...members].sort((a,b) => a.id.localeCompare(b.id)),
  }))
  let lastUnordered = -1
  groups.forEach((group,index) => { if (group.order === 'unordered') lastUnordered = index })
  const latest = groups.at(-1)
  return { version: 1, groups, evidenceMessageIds: groups.slice(lastUnordered + 1).flatMap(group => group.messages.map(message => message.id)),
    hasUnorderedHistory: lastUnordered >= 0, latestUnambiguous: latest?.messages.length === 1 && latest.messages[0].direction === 'in' }
}
export type ContextReason = 'NO_CONVERSATION' | 'SCOPE_MISMATCH' | 'CONNECTION_UNVERIFIED' | 'HISTORY_TRUNCATED' |
  'CONTEXT_TOO_LONG' | 'ORIGINAL_CONTENT_MISSING' | 'UNSUPPORTED_CONTENT' | 'REFERENCE_CONTEXT_UNSUPPORTED' |
  'UNVERIFIED_CANONICAL_CONTENT' | 'CONFLICTING_CONTENT' | 'PROVIDER_CONTEXT_UNACCOUNTED' | 'PENDING_RECONCILIATION' |
  'EMPTY_CONTEXT' | 'NO_LIVE_INBOUND' | 'ALREADY_ANSWERED' | 'AMBIGUOUS_MESSAGE_ORDER' | 'REPLY_WINDOW_CLOSED'
export type TrustedContext = {
  scope: ContextScope; eligible: boolean; reasons: ContextReason[]; fingerprint: string
  messengerOrder?: MessengerChronology
  transcript: string | null; messages: ContextMessage[]; latestInbound: { id: string; createdAt: string } | null
  providerHandling: 'none' | 'redundant_incoming_observation' | 'redundant_canonical_observations' | 'staff_review'
  /** This makes no claim that Meta/GREEN supplied every historical message. */
  coverage: 'all_stored_rows_only'
}
export class ContextError extends Error {
  constructor(public code: 'INVALID_SCOPE' | 'CONTEXT_CHANGED' | 'CONTEXT_UNAVAILABLE') { super(code); this.name = 'ContextError' }
}

const BUSINESSES = [
  { key: 'destockage', page: '471644012696537', phone: '968962882975955', businessPhone: '23052500684' },
  { key: 'made_by_moris', page: '308584892331429', phone: '1090043534186338', businessPhone: '23059406784' },
] as const
const MAX_MESSAGES = 100, MAX_CHARACTERS = 30000, WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_BINDING_AGE_MS = 15 * 60 * 1000 // Pilot policy: allow three ordinary five-minute reconciliation intervals.
const stamp = (value: unknown): string | null => {
  const at = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}
const flag = (value: unknown) => value === true || value === 'true'
/** Only the server's exact-owner Graph recovery record qualifies without a later webhook. */
function provenMessengerGraphHistory(row: Record<string, unknown>, scope: ContextScope): boolean {
  if (scope.channel !== 'messenger' || row.history_source !== 'meta_graph' || row.history_version !== 1 ||
    typeof row.history_graph_version !== 'string' || !['v21.0', 'v25.0'].includes(row.history_graph_version)) return false
  const expectedSender = row.direction === 'out' ? scope.pageId : row.direction === 'in' ? scope.psid : null
  const originalTime = typeof row.history_message_created_at === 'string' ? stamp(row.history_message_created_at) : null
  return row.history_message_id === row.id && typeof row.history_message_id === 'string' &&
    typeof row.history_message_body === 'string' && !!row.history_message_body.trim() && row.history_message_body === row.body &&
    expectedSender !== null && row.history_message_from === expectedSender &&
    originalTime !== null && originalTime === stamp(row.created_at)
}
const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}'
}
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex')
const unixSeconds = (value: unknown, stringValue: boolean): string | null => {
  if (stringValue ? typeof value !== 'string' || !/^[1-9]\d{0,11}$/.test(value) : typeof value !== 'number') return null
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds < 253402300800 ? new Date(seconds * 1000).toISOString() : null
}
/** Read-only semantic coverage, not an identity link. No inferred time tolerance or new transcript turns. */
function redundantGreenCopies(rows: Record<string, unknown>[], green: Record<string, unknown>[], scope: ContextScope,
  binding: Record<string, unknown> | undefined, businessPhone: string): boolean {
  if (scope.channel !== 'whatsapp' || !rows.length || !green.length) return false
  const candidates = new Map<string, string[]>(), used = new Set<string>(), providerIds = new Set<string>()
  for (const row of rows) {
    const at = unixSeconds(row.canonical_timestamp, true)
    if (row.phone_number_id !== scope.phoneNumberId || row.wa_id !== scope.waId || row.content_source !== 'webhook' ||
      row.type !== 'text' || row.canonical_type !== 'text' || row.canonical_id !== row.id ||
      typeof row.id !== 'string' || typeof row.body !== 'string' || !row.body.trim() || row.canonical_body !== row.body ||
      row.canonical_peer !== scope.waId || !['in','out'].includes(String(row.direction)) || !at || at !== stamp(row.created_at)) continue
    const key = stable([row.direction,row.body,at]), ids = candidates.get(key) ?? []
    ids.push(row.id); candidates.set(key,ids)
  }
  for (const row of green) {
    const w = row.webhook_witness as Record<string, unknown> | null
    if (!w || typeof w !== 'object' || Array.isArray(w) || typeof w.id !== 'string' || !w.id ||
      row.phone_number_id !== scope.phoneNumberId || row.wa_id !== scope.waId || row.instance_id !== binding?.instance_id ||
      row.provider_chat_id !== scope.waId+'@c.us' || typeof row.provider_message_id !== 'string' || !row.provider_message_id ||
      row.kind !== 'text' || typeof row.body !== 'string' || !row.body.trim() || flag(row.edited) || flag(row.conflicted) || flag(row.deleted_observed) || flag(row.has_reference) || flag(w.has_reference) ||
      w.phone !== scope.phoneNumberId || w.customer !== scope.waId || w.instance !== row.instance_id ||
      w.chat !== row.provider_chat_id || w.message_id !== row.provider_message_id || w.origin !== 'webhook' || w.state !== 'processed' ||
      w.raw_type !== 'whatsapp' || typeof w.raw_account !== 'string' || ![binding?.account_id,businessPhone+'@c.us'].includes(w.raw_account) ||
      !(typeof w.raw_instance === 'string' || typeof w.raw_instance === 'number' && Number.isSafeInteger(w.raw_instance)) ||
      String(w.raw_instance) !== row.instance_id || w.raw_chat !== row.provider_chat_id || w.raw_id !== row.provider_message_id ||
      w.raw_event !== w.event || w.raw_message_type !== 'textMessage' || w.raw_body !== row.body) return false
    const direction = w.event === 'incomingMessageReceived' ? 'in' :
      w.event === 'outgoingMessageReceived' || w.event === 'outgoingAPIMessageReceived' ? 'out' : null
    const at = unixSeconds(w.raw_timestamp, false)
    if (direction !== row.direction || !at || at !== stamp(w.provider_timestamp) || at !== stamp(row.provider_accepted_at)) return false
    const providerKey = stable([row.instance_id,row.provider_chat_id,row.provider_message_id])
    if (providerIds.has(providerKey)) return false
    providerIds.add(providerKey)
    const matches = candidates.get(stable([direction,row.body,at]))
    if (!matches || matches.length !== 1 || used.has(matches[0])) return false
    used.add(matches[0])
  }
  return true
}
const project = (row: Record<string, unknown> | undefined, fields: readonly string[]) => row
  ? Object.fromEntries(fields.map(key => [key, row[key] ?? null])) : null
const CANONICAL_VERSION_FIELDS = ['id','page_id','psid','phone_number_id','wa_id','direction','type','body','created_at','total_count',
  'has_media','has_reference','imported','history_source','history_version','history_graph_version','history_message_id',
  'history_message_body','history_message_from','history_message_created_at','live_webhook_seen','content_source','receipt_only','provisional_timestamp','raw_body',
  'canonical_id','canonical_type','canonical_body','canonical_peer','canonical_timestamp'] as const
const GREEN_VERSION_FIELDS = ['id','phone_number_id','wa_id','instance_id','provider_chat_id','provider_message_id','direction','kind','body',
  'edited','conflicted','deleted_observed','semantic_hash','total_count','first_origin','first_state','first_event_type','first_instance_id',
  'first_provider_message_id','first_provider_chat_id','first_payload_hash','first_message_type','first_body','has_reference','provider_accepted_at','webhook_witness'] as const

function validateScope(scope: ContextScope) {
  if (!scope || typeof scope !== 'object') throw new ContextError('INVALID_SCOPE')
  const found = BUSINESSES.find(b => scope.channel === 'messenger' ? b.page === scope.pageId : scope.channel === 'whatsapp' && b.phone === scope.phoneNumberId)
  const customer = scope.channel === 'messenger' ? scope.psid : scope.channel === 'whatsapp' ? scope.waId : null
  if (!found || scope.businessKey !== undefined && scope.businessKey !== found.key || typeof customer !== 'string' || !/^\d{5,20}$/.test(customer)) throw new ContextError('INVALID_SCOPE')
  return found
}

/** Every row includes its real ownership fields; validate these again after the exact-scope SELECT. */
export const CONTEXT_SQL = {
  messengerConversation: 'SELECT page_id,psid,message_count,updated_at,last_from_customer FROM public.messenger_conversations WHERE page_id=$1 AND psid=$2',
  messengerMessages: `SELECT mid AS id,page_id,psid,direction,body,created_at,count(*) OVER() AS total_count,
    CASE WHEN attachments IS NULL OR attachments IN ('null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"data":[]}'::jsonb) THEN false ELSE true END AS has_media,
    raw->>'imported' AS imported,raw#>>'{_akmez_history,source}' AS history_source,
    raw#>'{_akmez_history,version}' AS history_version,raw#>'{_akmez_history,graphVersion}' AS history_graph_version,
    raw#>'{message,id}' AS history_message_id,raw#>'{message,message}' AS history_message_body,
    raw#>'{message,from,id}' AS history_message_from,raw#>'{message,created_time}' AS history_message_created_at,
    raw#>>'{_akmez_history,liveWebhookSeen}' AS live_webhook_seen,
    CASE WHEN coalesce(raw#>'{message,reply_to}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
      OR coalesce(raw->'reply_to','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb) THEN true ELSE false END AS has_reference,
    coalesce(raw#>>'{message,text}',raw->>'text',raw#>>'{message,message}') AS raw_body,md5(coalesce(raw::text,'')) AS raw_hash
    FROM public.messenger_messages WHERE page_id=$1 AND psid=$2 ORDER BY created_at ASC,mid ASC LIMIT 101`,
  whatsappConversation: `SELECT c.phone_number_id,c.wa_id,c.activity_version,c.updated_at,n.can_read,n.can_send,n.page_id,n.display_phone
    FROM public.whatsapp_conversations c JOIN public.whatsapp_inbox_numbers n USING(phone_number_id)
    WHERE c.phone_number_id=$1 AND c.wa_id=$2`,
  whatsappMessages: `SELECT id,phone_number_id,wa_id,direction,type,body,created_at,status,count(*) OVER() AS total_count,
    media_id IS NOT NULL AS has_media,raw->>'imported' AS imported,raw#>>'{_inbox,contentSource}' AS content_source,
    raw#>>'{_inbox,receiptOnly}' AS receipt_only,raw#>>'{_inbox,provisionalTimestamp}' AS provisional_timestamp,
    raw->'id' AS canonical_id,raw->'type' AS canonical_type,raw#>'{text,body}' AS canonical_body,
    CASE WHEN direction='in' THEN raw->'from' ELSE raw->'to' END AS canonical_peer,raw->'timestamp' AS canonical_timestamp,
    CASE WHEN raw->'context' IS NOT NULL AND raw->'context'<>'null'::jsonb THEN true ELSE false END AS has_reference,
    raw#>>'{text,body}' AS raw_body,md5(coalesce(raw::text,'')) AS raw_hash
    FROM public.whatsapp_messages WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY created_at ASC,id ASC LIMIT 101`,
  greenBinding: 'SELECT phone_number_id,instance_id,account_id,version,enabled,connection_state,last_error,last_reconcile_at FROM public.whatsapp_green_bindings WHERE phone_number_id=$1',
  greenConversation: 'SELECT phone_number_id,wa_id,context_version,updated_at FROM public.whatsapp_green_conversations WHERE phone_number_id=$1 AND wa_id=$2',
  greenPending: "SELECT count(*) AS count FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND (wa_id=$2 OR wa_id IS NULL) AND state='quarantined'",
  greenMessages: `SELECT m.id,m.phone_number_id,m.wa_id,m.instance_id,m.provider_chat_id,m.provider_message_id,m.direction,m.kind,m.body,
    m.provider_accepted_at,m.first_observed_at,m.last_observed_at,m.edited,m.conflicted,m.deleted_observed,m.semantic_hash,
    count(*) OVER() AS total_count,e.origin AS first_origin,e.state AS first_state,e.event_type AS first_event_type,
    e.instance_id AS first_instance_id,e.provider_message_id AS first_provider_message_id,e.provider_chat_id AS first_provider_chat_id,
    e.payload_hash AS first_payload_hash,z.payload_hash AS last_payload_hash,
    e.raw#>>'{messageData,typeMessage}' AS first_message_type,
    e.raw#>>'{messageData,textMessageData,textMessage}' AS first_body,
    CASE WHEN coalesce(e.raw#>'{messageData,quotedMessage}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
      OR coalesce(e.raw#>'{messageData,extendedTextMessageData}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
      OR coalesce(e.raw->'quotedMessage','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
      OR coalesce(z.raw#>'{messageData,quotedMessage}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
      OR coalesce(z.raw->'quotedMessage','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
      THEN true ELSE false END AS has_reference,
    jsonb_build_object('id',w.id,'phone',w.phone_number_id,'customer',w.wa_id,'instance',w.instance_id,
      'chat',w.provider_chat_id,'message_id',w.provider_message_id,'origin',w.origin,'state',w.state,'event',w.event_type,
      'provider_timestamp',w.provider_timestamp,'raw_instance',w.raw#>'{instanceData,idInstance}',
      'raw_type',w.raw#>'{instanceData,typeInstance}','raw_account',w.raw#>'{instanceData,wid}',
      'raw_chat',w.raw#>'{senderData,chatId}','raw_id',w.raw->'idMessage','raw_event',w.raw->'typeWebhook',
      'raw_message_type',w.raw#>'{messageData,typeMessage}','raw_body',w.raw#>'{messageData,textMessageData,textMessage}',
      'raw_timestamp',w.raw->'timestamp','has_reference',
      coalesce(w.raw#>'{messageData,quotedMessage}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb) OR
      coalesce(w.raw#>'{messageData,extendedTextMessageData}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb) OR
      coalesce(w.raw->'quotedMessage','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb) OR w.reference_seen) AS webhook_witness
    FROM public.whatsapp_green_messages m LEFT JOIN public.whatsapp_green_events e ON e.id=m.first_event_id
    LEFT JOIN public.whatsapp_green_events z ON z.id=m.last_event_id
    LEFT JOIN LATERAL (SELECT e.*,EXISTS(SELECT 1 FROM public.whatsapp_green_events r
      WHERE r.phone_number_id=m.phone_number_id AND r.wa_id=m.wa_id AND r.instance_id=m.instance_id
        AND r.provider_chat_id=m.provider_chat_id AND r.provider_message_id=m.provider_message_id
        AND (coalesce(r.raw#>'{messageData,quotedMessage}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
          OR coalesce(r.raw#>'{messageData,extendedTextMessageData}','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
          OR coalesce(r.raw->'quotedMessage','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb))) AS reference_seen
      FROM public.whatsapp_green_events e
      WHERE e.phone_number_id=m.phone_number_id AND e.wa_id=m.wa_id AND e.instance_id=m.instance_id
        AND e.provider_chat_id=m.provider_chat_id AND e.provider_message_id=m.provider_message_id
        AND e.origin='webhook' AND e.state='processed'
        AND e.event_type IN ('incomingMessageReceived','outgoingMessageReceived','outgoingAPIMessageReceived')
        AND e.raw#>>'{messageData,typeMessage}'='textMessage' AND e.raw#>>'{messageData,textMessageData,textMessage}'=m.body
      ORDER BY e.received_at ASC,e.id ASC LIMIT 1) w ON true
    WHERE m.phone_number_id=$1 AND m.wa_id=$2 ORDER BY m.first_observed_at ASC,m.id ASC LIMIT 101`,
} as const

/** No provider calls, AI, sends, orders or read marks. Caller gives an exclusive connection for this read snapshot. */
export async function loadTrustedContext(scope: ContextScope, deps: ContextDependencies): Promise<TrustedContext> {
  const business = validateScope(scope)
  await deps.authorizeScope(scope)
  const now = (deps.now ?? (() => new Date()))().getTime()
  if (!Number.isFinite(now)) throw new ContextError('CONTEXT_UNAVAILABLE')
  const configured = scope.channel === 'whatsapp' ? await deps.getGreenBinding?.(scope.phoneNumberId) ?? null : null
  const db = await deps.connectDatabase()
  const ownsTransaction = deps.transaction !== 'caller'
  let result: TrustedContext
  try {
    if (ownsTransaction) {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      await db.query("SET LOCAL statement_timeout='8s'")
    }
    const values = scope.channel === 'messenger' ? [scope.pageId, scope.psid] : [scope.phoneNumberId, scope.waId]
    const conversation = (await db.query(scope.channel === 'messenger' ? CONTEXT_SQL.messengerConversation : CONTEXT_SQL.whatsappConversation, values)).rows[0]
    const rows = (await db.query(scope.channel === 'messenger' ? CONTEXT_SQL.messengerMessages : CONTEXT_SQL.whatsappMessages, values)).rows
    let binding: Record<string, unknown> | undefined, greenConversation: Record<string, unknown> | undefined, pending = 0
    let green: Record<string, unknown>[] = []
    if (scope.channel === 'whatsapp') {
      binding = (await db.query(CONTEXT_SQL.greenBinding, [scope.phoneNumberId])).rows[0]
      greenConversation = (await db.query(CONTEXT_SQL.greenConversation, values)).rows[0]
      pending = Number((await db.query(CONTEXT_SQL.greenPending, values)).rows[0]?.count ?? 0)
      green = (await db.query(CONTEXT_SQL.greenMessages, values)).rows
    }
    const reasons = new Set<ContextReason>()
    if (!conversation) reasons.add('NO_CONVERSATION')
    else if (scope.channel === 'messenger' ? conversation.page_id !== scope.pageId || conversation.psid !== scope.psid
      : conversation.phone_number_id !== scope.phoneNumberId || conversation.wa_id !== scope.waId || conversation.page_id !== business.page || String(conversation.display_phone).replace(/\D/g, '') !== business.businessPhone) reasons.add('SCOPE_MISMATCH')
    if (scope.channel === 'whatsapp') {
      const reconciled = stamp(binding?.last_reconcile_at)
      if (!conversation?.can_read || !conversation.can_send || !configured?.enabled || !binding?.enabled || binding.connection_state !== 'authorized' || binding.last_error ||
        binding.phone_number_id !== scope.phoneNumberId || binding.instance_id !== configured.instanceId || Number(binding.version) !== configured.version ||
        !reconciled || now - Date.parse(reconciled) > MAX_BINDING_AGE_MS || Date.parse(reconciled) > now + 60000) reasons.add('CONNECTION_UNVERIFIED')
      if (greenConversation && (greenConversation.phone_number_id !== scope.phoneNumberId || greenConversation.wa_id !== scope.waId)) reasons.add('SCOPE_MISMATCH')
    }
    if (rows.length > MAX_MESSAGES || rows.some(r => Number(r.total_count) > MAX_MESSAGES) || green.length > MAX_MESSAGES || green.some(r => Number(r.total_count) > MAX_MESSAGES)) reasons.add('HISTORY_TRUNCATED')
    if (scope.channel === 'messenger' && Number(conversation?.message_count) > rows.length) reasons.add('HISTORY_TRUNCATED')
    if (!rows.length) reasons.add('EMPTY_CONTEXT')
    const messages: ContextMessage[] = [], identities = new Map<string, string>()
    let characters = 0
    for (const row of rows) {
      const owns = scope.channel === 'messenger' ? row.page_id === scope.pageId && row.psid === scope.psid : row.phone_number_id === scope.phoneNumberId && row.wa_id === scope.waId
      if (!owns) reasons.add('SCOPE_MISMATCH')
      const at = stamp(row.created_at), body = typeof row.body === 'string' && row.body.trim() ? row.body : null
      if (typeof row.id !== 'string' || !row.id || !at || !['in', 'out'].includes(String(row.direction))) { reasons.add('UNVERIFIED_CANONICAL_CONTENT'); continue }
      if (!body || row.type === 'external' || flag(row.receipt_only)) reasons.add('ORIGINAL_CONTENT_MISSING')
      if (flag(row.has_media) || scope.channel === 'whatsapp' && row.type !== 'text') reasons.add('UNSUPPORTED_CONTENT')
      if (flag(row.has_reference)) reasons.add('REFERENCE_CONTEXT_UNSUPPORTED')
      if (flag(row.imported) || row.content_source === 'import' || flag(row.provisional_timestamp) || row.status === 'failed' ||
        row.history_source && !flag(row.live_webhook_seen) && !provenMessengerGraphHistory(row, scope)) reasons.add('UNVERIFIED_CANONICAL_CONTENT')
      if (row.raw_body !== null && row.raw_body !== undefined && row.raw_body !== row.body) reasons.add('CONFLICTING_CONTENT')
      const semantic = stable([row.direction, row.body, at])
      if (identities.has(row.id)) { if (identities.get(row.id) !== semantic) reasons.add('CONFLICTING_CONTENT'); continue }
      identities.set(row.id, semantic)
      if (body) { characters += body.length; messages.push({ id: row.id, direction: row.direction as 'in' | 'out', text: body, createdAt: at }) }
    }
    if (characters > MAX_CHARACTERS) reasons.add('CONTEXT_TOO_LONG')
    let providerHandling: TrustedContext['providerHandling'] = green.length ? 'staff_review' : 'none'
    if (pending > 0) reasons.add('PENDING_RECONCILIATION')
    for (const row of green) {
      if (scope.channel !== 'whatsapp' || row.phone_number_id !== scope.phoneNumberId || row.wa_id !== scope.waId || row.instance_id !== configured?.instanceId || row.provider_chat_id !== scope.waId + '@c.us') reasons.add('SCOPE_MISMATCH')
      if (flag(row.conflicted) || flag(row.edited) || flag(row.deleted_observed)) reasons.add('CONFLICTING_CONTENT')
      if (row.kind !== 'text' || typeof row.body !== 'string' || !row.body.trim()) reasons.add('UNSUPPORTED_CONTENT')
    }
    // This is a tightly bounded semantic allowance, NOT a provider-ID mapping. One
    // additional same-text incoming observation contains no additional request. Its
    // identity remains unverified; never fill a blank or use time proximity as proof.
    const one = rows.length === 1 && green.length === 1 ? green[0] : null
    const canonical = rows[0]
    if (one && canonical?.direction === 'in' && canonical.type === 'text' && canonical.content_source === 'webhook' &&
      !flag(canonical.has_reference) && one.direction === 'in' && one.body === canonical.body && one.kind === 'text' &&
      !flag(one.edited) && !flag(one.conflicted) && !flag(one.deleted_observed) && !flag(one.has_reference) &&
      !flag((one.webhook_witness as Record<string, unknown> | null)?.has_reference) &&
      one.first_origin === 'webhook' && one.first_state === 'processed' && one.first_event_type === 'incomingMessageReceived' &&
      one.first_instance_id === one.instance_id && one.first_provider_message_id === one.provider_message_id && one.first_provider_chat_id === one.provider_chat_id &&
      one.first_message_type === 'textMessage' && one.first_body === one.body && typeof one.first_payload_hash === 'string' && typeof one.last_payload_hash === 'string') {
      providerHandling = 'redundant_incoming_observation'
    } else if (redundantGreenCopies(rows, green, scope, binding, business.businessPhone)) {
      providerHandling = 'redundant_canonical_observations'
    } else if (green.length) reasons.add('PROVIDER_CONTEXT_UNACCOUNTED')
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const inbound = [...messages].reverse().find(m => m.direction === 'in') ?? null
    const last = messages[messages.length - 1]
    const messengerOrder = scope.channel === 'messenger' ? messengerChronology(messages) : undefined
    if (messengerOrder?.groups.at(-1)?.order === 'unordered') reasons.add('AMBIGUOUS_MESSAGE_ORDER')
    if (!inbound) reasons.add('NO_LIVE_INBOUND')
    else {
      if (last?.direction !== 'in') reasons.add('ALREADY_ANSWERED')
      if (messages.some(m => m.id !== inbound.id && m.createdAt === inbound.createdAt)) reasons.add('AMBIGUOUS_MESSAGE_ORDER')
      const age = now - Date.parse(inbound.createdAt)
      if (age >= WINDOW_MS || age < -60000) reasons.add('REPLY_WINDOW_CLOSED')
    }
    const eligible = reasons.size === 0
    // Read marks, successful polling timestamps and delivery/read receipts are not new
    // conversation content. They must not invalidate an otherwise unchanged draft.
    const fingerprint = digest({ scope,
      conversation: project(conversation, ['page_id','psid','phone_number_id','wa_id','message_count','activity_version','can_read','can_send','display_phone']),
      rows: rows.map(row => ({ ...project(row, CANONICAL_VERSION_FIELDS), failed: row.status === 'failed' })), configured,
      binding: project(binding, ['phone_number_id','instance_id','account_id','version','enabled','connection_state','last_error']),
      greenConversation: project(greenConversation, ['phone_number_id','wa_id','context_version']), pending,
      green: green.map(row => project(row, GREEN_VERSION_FIELDS)), providerHandling, ...(messengerOrder ? { messengerOrder } : {}) })
    result = { scope, eligible, reasons: [...reasons].sort(), fingerprint, ...(eligible && messengerOrder ? { messengerOrder } : {}),
      messages: eligible ? messages : [], transcript: eligible ? JSON.stringify(messengerOrder?.hasUnorderedHistory ? { messageGroups: messengerOrder.groups } : messages.map(m => ({ role: m.direction === 'in' ? 'customer' : 'business', text: m.text }))) : null,
      latestInbound: inbound ? { id: inbound.id, createdAt: inbound.createdAt } : null, providerHandling, coverage: 'all_stored_rows_only' }
    if (ownsTransaction) await db.query('COMMIT')
  } catch {
    if (ownsTransaction) await db.query('ROLLBACK').catch(() => {})
    throw new ContextError('CONTEXT_UNAVAILABLE')
  } finally { if (ownsTransaction) await db.end().catch(() => {}) }
  return result
}

/** Existing transaction variant: caller owns locks, transaction boundaries, timeout and connection cleanup. */
export async function readTrustedContext(scope: ContextScope, deps: ContextDependencies, db: Pick<ContextDb, 'query'>): Promise<TrustedContext> {
  return loadTrustedContext(scope, { ...deps, transaction: 'caller', connectDatabase: async () => ({ query: (sql, values) => db.query(sql, values), end: async () => {} }) })
}

/** Call again immediately before sending; engine must also atomically enforce its own control/lease/takeover checks. */
export async function assertTrustedContextCurrent(context: TrustedContext, deps: ContextDependencies): Promise<void> {
  const latest = await loadTrustedContext(context.scope, deps)
  if (!latest.eligible || !context.eligible || latest.fingerprint !== context.fingerprint || latest.latestInbound?.id !== context.latestInbound?.id) throw new ContextError('CONTEXT_CHANGED')
}
