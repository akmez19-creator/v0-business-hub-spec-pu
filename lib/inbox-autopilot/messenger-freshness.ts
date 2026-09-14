import 'server-only'
import { scopeIdentity, type AutopilotScope } from './contract'
import type { TrustedContext } from './context'

type MessengerScope = Extract<AutopilotScope, { channel: 'messenger' }>
export type FreshnessResult = { ok: true; expiresAt?: number } | { ok: false; reason: string }
export type RecoveredMessengerRow = {
  mid: string; page_id: string; psid: string; direction: 'in' | 'out'; body: string | null
  attachments: unknown; created_at: string; raw: Record<string, unknown>
}
export type MessengerFreshnessDependencies = {
  getPage(pageId: string): Promise<{ id: string; access_token: string } | null>
  conversationId(scope: MessengerScope): Promise<string | null>
  /** Separate short transaction, exact-owner fill-only history writer. Never called inside beginSend. */
  merge(scope: MessengerScope, conversationId: string, rows: RecoveredMessengerRow[]): Promise<void>
  fetch?: typeof fetch
  now?: () => number
}
type Snapshot = { conversationId: string; rows: RecoveredMessengerRow[]; observedAt: number }
class FreshnessError extends Error { constructor(public reason: string) { super(reason) } }
function fail(reason: string): never { throw new FreshnessError(reason) }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024 && !/[\u0000-\u0020\u007f]/.test(v)
const timestamp = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN
const second = (value: string) => Math.floor(Date.parse(value) / 1000)
const empty = (value: unknown): boolean => value == null || Array.isArray(value) && value.length === 0 || object(value) && Object.keys(value).length === 0
const noAttachments = (value: unknown): boolean => empty(value) || object(value) && Array.isArray(value.data) && value.data.length === 0 && !value.paging?.next

/** A scoped, fresh and fully bounded Graph read. No cache, retry, read receipt, send or model call. */
export function createMessengerFreshness(deps: MessengerFreshnessDependencies) {
  const now = deps.now ?? Date.now
  const fetchImpl = deps.fetch ?? fetch
  async function get(path: string, parameters: Record<string, string>, token: string): Promise<Record<string, any>> {
    const url = new URL('https://graph.facebook.com/v25.0/' + path)
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
    const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) fail('messenger_freshness_unavailable')
    const advertised = Number(response.headers.get('content-length'))
    if (Number.isFinite(advertised) && advertised > 2_000_000) fail('messenger_history_too_large')
    const reader = response.body?.getReader()
    if (!reader) fail('messenger_freshness_unavailable')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 2_000_000) { await reader.cancel(); fail('messenger_history_too_large') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!object(data) || data.error) fail('messenger_freshness_unavailable')
    return data
  }
  function ownsThread(value: Record<string, any>, scope: MessengerScope): boolean {
    const participants = value.participants
    if (!object(participants) || !Array.isArray(participants.data) || participants.paging?.next) return false
    const members = participants.data.map((p: unknown) => object(p) ? p.id : null)
    return members.length === 2 && new Set(members).size === 2 && members.includes(scope.pageId) && members.includes(scope.psid)
  }
  async function read(scope: MessengerScope): Promise<Snapshot> {
    scopeIdentity(scope)
    const started = now()
    const page = await deps.getPage(scope.pageId)
    if (!page || page.id !== scope.pageId || typeof page.access_token !== 'string' || !page.access_token) fail('messenger_freshness_unavailable')
    let conversationId = await deps.conversationId(scope)
    if (conversationId !== null && !id(conversationId)) fail('messenger_history_scope_mismatch')
    if (!conversationId) {
      const found = await get(encodeURIComponent(scope.pageId) + '/conversations', { user_id: scope.psid, fields: 'id,participants{id}', limit: '2' }, page.access_token)
      if (!Array.isArray(found.data) || found.data.length !== 1 || found.paging?.next || !object(found.data[0]) || !id(found.data[0].id) || !ownsThread(found.data[0], scope)) fail('messenger_history_scope_mismatch')
      conversationId = found.data[0].id
    }
    if (now() - started > 15000) fail('messenger_freshness_unavailable')
    const data = await get(encodeURIComponent(conversationId!), { fields: 'id,participants{id},messages.limit(101){id,message,created_time,from{id},attachments}' }, page.access_token)
    if (data.id !== conversationId || !ownsThread(data, scope)) fail('messenger_history_scope_mismatch')
    if (!object(data.messages) || !Array.isArray(data.messages.data)) fail('messenger_freshness_unavailable')
    if (data.messages.paging?.next || data.messages.data.length > 100) fail('messenger_history_truncated')
    if (!data.messages.data.length) fail('messenger_history_incomplete')
    const observedAt = now()
    if (!Number.isFinite(observedAt) || observedAt - started > 25000) fail('messenger_freshness_unavailable')
    const rows: RecoveredMessengerRow[] = [], seen = new Set<string>()
    for (const item of data.messages.data) {
      if (!object(item) || !id(item.id) || seen.has(item.id) || !object(item.from) || ![scope.pageId, scope.psid].includes(item.from.id)) fail('messenger_history_scope_mismatch')
      seen.add(item.id)
      const at = timestamp(item.created_time)
      if (!Number.isFinite(at) || at > observedAt + 60000 || item.message != null && typeof item.message !== 'string') fail('messenger_history_invalid')
      const attachments = item.attachments ?? null
      if (!empty(attachments) && !Array.isArray(attachments) && !(object(attachments) && Array.isArray(attachments.data))) fail('messenger_history_invalid')
      if (object(attachments) && attachments.paging?.next) fail('messenger_history_unsupported')
      if (!empty(item.reply_to)) fail('messenger_history_unsupported')
      const graph = { id: item.id, message: item.message ?? null, created_time: item.created_time, from: { id: item.from.id }, attachments }
      rows.push({ mid: item.id, page_id: scope.pageId, psid: scope.psid, direction: item.from.id === scope.pageId ? 'out' : 'in',
        body: item.message ?? null, attachments, created_at: new Date(at).toISOString(),
        raw: { _akmez_history: { version: 1, source: 'meta_graph', observedAt: new Date(observedAt).toISOString(), graphVersion: 'v25.0' }, message: graph } })
    }
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.mid.localeCompare(b.mid))
    return { conversationId: conversationId!, rows, observedAt }
  }
  function compare(scope: MessengerScope, snapshot: Snapshot, context: TrustedContext): FreshnessResult {
    if (!context.eligible || context.scope.channel !== 'messenger' || context.scope.pageId !== scope.pageId || context.scope.psid !== scope.psid || context.scope.businessKey !== scope.businessKey) return { ok: false, reason: 'messenger_history_changed' }
    if (now() - snapshot.observedAt > 5000 || now() < snapshot.observedAt) return { ok: false, reason: 'messenger_freshness_expired' }
    if (snapshot.rows.some(r => !r.body?.trim() || !noAttachments(r.attachments))) return { ok: false, reason: 'messenger_history_unsupported' }
    const latest = snapshot.rows.at(-1)!
    // Only the newest second needs a single chronological target. Older ties are
    // explicitly unordered in context and cannot supply extracted reply evidence.
    if (snapshot.rows.filter(row=>second(row.created_at)===second(latest.created_at)).length!==1) return { ok: false, reason: 'messenger_message_order_ambiguous' }
    if (latest.direction !== 'in') return { ok: false, reason: 'messenger_already_answered' }
    if (context.latestInbound?.id !== latest.mid || second(context.latestInbound.createdAt) !== second(latest.created_at)) return { ok: false, reason: 'messenger_history_changed' }
    if (snapshot.rows.length !== context.messages.length) return { ok: false, reason: 'messenger_history_incomplete' }
    const canonical = new Map(context.messages.map(m => [m.id, m]))
    if (canonical.size !== context.messages.length) return { ok: false, reason: 'messenger_history_changed' }
    let characters = 0
    for (const row of snapshot.rows) {
      const stored = canonical.get(row.mid)
      characters += row.body!.length
      if (!stored || stored.direction !== row.direction || stored.text !== row.body || second(stored.createdAt) !== second(row.created_at)) return { ok: false, reason: 'messenger_history_changed' }
    }
    if (characters > 30000) return { ok: false, reason: 'messenger_history_too_large' }
    return { ok: true, expiresAt: snapshot.observedAt + 5000 }
  }
  const failure = (error: unknown): FreshnessResult => ({ ok: false, reason: error instanceof FreshnessError ? error.reason : 'messenger_freshness_unavailable' })
  return {
    async hydrate(scope: MessengerScope): Promise<FreshnessResult> {
      try { const snapshot = await read(scope); await deps.merge(scope, snapshot.conversationId, snapshot.rows); return { ok: true } }
      catch (error) { return failure(error) }
    },
    async verify(scope: AutopilotScope, context: TrustedContext): Promise<FreshnessResult> {
      if (scope.channel !== 'messenger') return { ok: true }
      try { return compare(scope, await read(scope), context) } catch (error) { return failure(error) }
    },
  }
}
