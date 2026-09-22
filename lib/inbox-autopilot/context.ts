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
} as const

/** No provider calls, AI, sends, orders or read marks. Caller gives an exclusive connection for this read snapshot. */
export async function loadTrustedContext(scope: ContextScope, deps: ContextDependencies): Promise<TrustedContext> {
  const business = validateScope(scope)
  await deps.authorizeScope(scope)
  const now = (deps.now ?? (() => new Date()))().getTime()
  if (!Number.isFinite(now)) throw new ContextError('CONTEXT_UNAVAILABLE')
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
    const reasons = new Set<ContextReason>()
    if (!conversation) reasons.add('NO_CONVERSATION')
    else if (scope.channel === 'messenger' ? conversation.page_id !== scope.pageId || conversation.psid !== scope.psid
      : conversation.phone_number_id !== scope.phoneNumberId || conversation.wa_id !== scope.waId || conversation.page_id !== business.page || String(conversation.display_phone).replace(/\D/g, '') !== business.businessPhone) reasons.add('SCOPE_MISMATCH')
    // The Meta Cloud API is the only channel: the conversation's own read/send capability decides.
    if (scope.channel === 'whatsapp' && (!conversation?.can_read || !conversation.can_send)) reasons.add('CONNECTION_UNVERIFIED')
    if (rows.length > MAX_MESSAGES || rows.some(r => Number(r.total_count) > MAX_MESSAGES)) reasons.add('HISTORY_TRUNCATED')
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
    const providerHandling: TrustedContext['providerHandling'] = 'none'
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
      rows: rows.map(row => ({ ...project(row, CANONICAL_VERSION_FIELDS), failed: row.status === 'failed' })),
      providerHandling, ...(messengerOrder ? { messengerOrder } : {}) })
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
