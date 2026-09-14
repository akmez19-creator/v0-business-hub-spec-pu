import crypto from 'node:crypto'

export const APPROVED_PAGES = ['308584892331429', '471644012696537']
export const GRAPH_VERSION = 'v25.0'
export const PREFIX = 'messenger:history:v1:'
export const LIMIT = 50
export const MAX_ITEMS = 100
export const MAX_VALUE_BYTES = 2_000_000
export class HistoryError extends Error {
  constructor(kind, { retryable = false, code = null, delayMs = null } = {}) {
    super(kind); this.kind = kind; this.retryable = retryable
    this.code = Number.isSafeInteger(code) ? code : null
    this.delayMs = Number.isFinite(delayMs) ? Math.max(0, Math.min(delayMs, 3_600_000)) : null
  }
}
export function fail(kind, options) { throw new HistoryError(kind, options) }
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u0020\u007f]/.test(value)
export function pageAllowed(pageId) { if (!APPROVED_PAGES.includes(pageId)) fail('page_not_approved') }
export function keyFor(pageId, conversationId = null, mode = 'recent', messageId = null) {
  pageAllowed(pageId)
  if (!['recent', 'history', 'target'].includes(mode)) fail('mode_invalid')
  if (conversationId !== null && !id(conversationId)) fail('invalid_conversation_identity')
  if (messageId !== null && !id(messageId)) fail('invalid_message_identity')
  return `${PREFIX}${pageId}:${mode}:${messageId ? 'message:' + crypto.createHash('sha256').update(messageId).digest('hex') : conversationId === null ? 'discovery' : 'thread:' + crypto.createHash('sha256').update(conversationId).digest('hex')}`
}
export function initialState(pageId, conversation = null, now = new Date().toISOString(), options = {}) {
  pageAllowed(pageId)
  const mode = options.mode ?? 'recent'
  const state = { version: 1, pageId, kind: conversation ? 'thread' : 'discovery', status: 'pending',
    mode, cutoff: mode === 'recent' ? options.cutoff ?? new Date(Date.parse(now) - 86400_000).toISOString() : null,
    maxPages: mode === 'recent' ? conversation ? 4 : 2 : null, coverageCapped: false,
    conversationId: conversation?.id ?? null, psid: conversation?.psid ?? null,
    messageId: null, expectedDirection: null, expectedTime: null,
    after: null, graphVersion: GRAPH_VERSION, startedAt: now, completedAt: null,
    lease: null, retryAt: null, failures: 0, lastError: null, cursorRestarts: 0,
    counters: { pages: 0, observed: 0, inserted: 0, enriched: 0, unchanged: 0, timestampDifferences: 0, attachmentReview: 0 } }
  validateState(state)
  return state
}
export function validateState(state) {
  if (!isObject(state) || state.version !== 1) fail('checkpoint_version_invalid')
  pageAllowed(state.pageId)
  if (!['discovery', 'thread', 'message'].includes(state.kind) || !['pending', 'complete', 'blocked'].includes(state.status)) fail('checkpoint_shape_invalid')
  if (!['recent', 'history', 'target'].includes(state.mode) || state.mode === 'target' && state.kind !== 'message') fail('checkpoint_mode_invalid')
  if (state.kind === 'thread' && (!id(state.conversationId) || !id(state.psid) || state.psid === state.pageId)) fail('checkpoint_identity_invalid')
  if (state.kind === 'discovery' && (state.conversationId !== null || state.psid !== null)) fail('checkpoint_identity_invalid')
  if (state.kind === 'message' && (!id(state.messageId) || !['in', 'out'].includes(state.expectedDirection) || !Number.isFinite(Date.parse(state.expectedTime)))) fail('checkpoint_identity_invalid')
  if (state.cutoff !== null && !Number.isFinite(Date.parse(state.cutoff))) fail('checkpoint_cutoff_invalid')
  if (state.maxPages !== null && (!Number.isSafeInteger(state.maxPages) || state.maxPages < 1 || state.maxPages > 100)) fail('checkpoint_budget_invalid')
  if (state.after !== null && (typeof state.after !== 'string' || state.after.length === 0 || state.after.length > 16000 || /[\u0000-\u001f\u007f]/.test(state.after) || /^https?:/i.test(state.after))) fail('checkpoint_cursor_invalid')
  if (!['v21.0', 'v25.0'].includes(state.graphVersion)) fail('checkpoint_version_invalid')
  if (!isObject(state.counters) || Object.values(state.counters).some(v => !Number.isSafeInteger(v) || v < 0)) fail('checkpoint_counters_invalid')
  if (state.lease !== null && (!isObject(state.lease) || typeof state.lease.token !== 'string' || !Number.isFinite(Date.parse(state.lease.until)))) fail('checkpoint_lease_invalid')
  if (!Number.isFinite(Date.parse(state.startedAt)) || !Number.isSafeInteger(state.failures) || state.failures < 0) fail('checkpoint_shape_invalid')
  if (state.retryAt !== null && !Number.isFinite(Date.parse(state.retryAt))) fail('checkpoint_retry_invalid')
  return state
}
export function parseCheckpoint(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 24000) fail('checkpoint_shape_invalid')
  let state; try { state = JSON.parse(text) } catch { fail('checkpoint_shape_invalid') }
  return validateState(state)
}
export function edgeFor(state) {
  validateState(state)
  if (state.kind === 'message') return encodeURIComponent(state.messageId)
  return state.kind === 'discovery' ? `${state.pageId}/conversations` : `${encodeURIComponent(state.conversationId)}/messages`
}
export function requestUrl(state) {
  const url = new URL(`https://graph.facebook.com/${state.graphVersion}/${edgeFor(state)}`)
  url.searchParams.set('limit', String(LIMIT))
  url.searchParams.set('fields', state.kind === 'discovery' ? 'id,participants{id},updated_time' : state.kind === 'message' ? 'id,message,created_time,from{id},to{id},attachments' : 'id,message,created_time,from{id},attachments')
  if (state.after !== null) url.searchParams.set('after', state.after)
  return url
}
/** Keep an opaque cursor, never a credential-bearing URL. Only next establishes continuation. */
export function continuation(response, state) {
  if (!response?.paging?.next) return { after: null, graphVersion: state.graphVersion }
  if (typeof response.paging.next !== 'string') fail('pagination_shape_invalid')
  let next; try { next = new URL(response.paging.next) } catch { fail('pagination_shape_invalid') }
  const path = next.pathname.match(/^\/(v21\.0|v25\.0)\/(.*)$/)
  const sameVersion = path && (path[1] === state.graphVersion || state.graphVersion === 'v21.0' && path[1] === 'v25.0')
  if (next.origin !== 'https://graph.facebook.com' || next.username || next.password || !sameVersion || path[2] !== edgeFor(state)) fail('pagination_scope_changed')
  if (next.searchParams.has('before') || next.searchParams.getAll('after').length !== 1) fail('pagination_cursor_unsupported')
  const after = next.searchParams.get('after')
  validateState({ ...state, after })
  if (after === state.after) fail('pagination_cycle')
  return { after, graphVersion: path[1] }
}
export function pageRows(response) {
  if (!isObject(response) || !Array.isArray(response.data) || response.data.length > MAX_ITEMS) fail('provider_page_shape_invalid')
  if (Buffer.byteLength(JSON.stringify(response)) > MAX_VALUE_BYTES) fail('provider_page_too_large')
  return response.data
}
export function conversationRow(row, pageId) {
  pageAllowed(pageId)
  if (!isObject(row) || !id(row.id)) fail('conversation_identity_missing')
  const participants = row.participants?.data
  if (!Array.isArray(participants) || row.participants?.paging?.next) fail('conversation_participants_incomplete')
  const unique = [...new Set(participants.map(p => p?.id))]
  if (unique.length !== 2 || !unique.every(id) || !unique.includes(pageId)) fail('conversation_ownership_ambiguous')
  return { id: row.id, psid: unique.find(participant => participant !== pageId) }
}
export const attachmentList = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
export function messageRow(row, state, observedAt) {
  validateState(state)
  if (state.kind !== 'thread' || !isObject(row) || !id(row.id)) fail('message_identity_missing')
  if (![state.pageId, state.psid].includes(row.from?.id)) fail('message_sender_ownership_invalid')
  const at = typeof row.created_time === 'string' ? Date.parse(row.created_time) : NaN
  if (!Number.isFinite(at)) fail('message_timestamp_invalid')
  if (row.message !== undefined && row.message !== null && typeof row.message !== 'string') fail('message_body_invalid')
  if (row.attachments !== undefined && row.attachments !== null && !Array.isArray(row.attachments) && !Array.isArray(row.attachments?.data)) fail('message_attachments_invalid')
  // Nested pagination cannot be silently certified as full attachment recovery.
  if (row.attachments?.paging?.next) fail('nested_attachment_pagination_requires_review')
  const graph = { id: row.id, message: row.message ?? null, created_time: row.created_time, from: { id: row.from.id }, attachments: row.attachments ?? null }
  if (Buffer.byteLength(JSON.stringify(graph)) > MAX_VALUE_BYTES) fail('message_too_large')
  return { mid: row.id, page_id: state.pageId, psid: state.psid,
    direction: row.from.id === state.pageId ? 'out' : 'in', body: row.message ?? null,
    attachments: row.attachments ?? null, created_at: new Date(at).toISOString(),
    raw: { _akmez_history: { version: 1, source: 'meta_graph', observedAt, graphVersion: state.graphVersion }, message: graph } }
}
export function targetState(pageId, target, now = new Date().toISOString()) {
  const state = { ...initialState(pageId, null, now, { mode: 'history' }), mode: 'target', kind: 'message',
    messageId: target.providerMessageId, expectedDirection: target.direction, expectedTime: target.createdTime }
  return validateState(state)
}
export function targetedMessageRow(row, state, observedAt) {
  if (state.kind !== 'message' || row?.id !== state.messageId) fail('target_message_id_mismatch')
  if (row.to?.paging?.next) fail('target_recipient_ambiguous')
  const recipients = Array.isArray(row.to?.data) ? row.to.data.map(value => value?.id) : id(row.to?.id) ? [row.to.id] : []
  const unique = [...new Set(recipients)]
  if (unique.length !== 1 || !unique.every(id)) fail('target_recipient_ambiguous')
  const from = row.from?.id, to = unique[0]
  const direction = from === state.pageId && to !== state.pageId ? 'out' : to === state.pageId && from !== state.pageId && id(from) ? 'in' : null
  if (direction !== state.expectedDirection) fail('target_page_or_direction_mismatch')
  if (Math.floor(Date.parse(row.created_time) / 1000) !== Math.floor(Date.parse(state.expectedTime) / 1000)) fail('target_timestamp_mismatch')
  const psid = direction === 'out' ? to : from
  const normalized = messageRow(row, { ...state, kind: 'thread', mode: 'history', conversationId: 'validated-exact-message', psid }, observedAt)
  normalized.raw.message.to = row.to
  return normalized
}
/** Exact-ID, exact-owner fill-only merge. Never rewrites event time or live-state fields. */
export function mergeMessage(existing, incoming) {
  if (!existing) return { action: 'insert', row: incoming, timestampDifference: false, attachmentReview: false }
  if (existing.mid !== incoming.mid || existing.page_id !== incoming.page_id || existing.psid !== incoming.psid || existing.direction !== incoming.direction) fail('stored_message_identity_conflict')
  const oldBody = existing.body ?? '', newBody = incoming.body ?? ''
  if (oldBody && newBody && oldBody !== newBody && oldBody.replace(/\r\n/g, '\n') !== newBody.replace(/\r\n/g, '\n')) fail('stored_message_body_conflict')
  const body = !oldBody && newBody ? incoming.body : existing.body
  const oldAttachments = attachmentList(existing.attachments), newAttachments = attachmentList(incoming.attachments)
  const attachments = oldAttachments.length === 0 && newAttachments.length > 0 ? incoming.attachments : existing.attachments
  const fields = [...(body !== existing.body ? ['body'] : []), ...(attachments !== existing.attachments ? ['attachments'] : [])]
  const timestampDifference = new Date(existing.created_at).getTime() !== Date.parse(incoming.created_at)
  const attachmentReview = oldAttachments.length > 0 && newAttachments.length > oldAttachments.length
  if (!fields.length) return { action: 'unchanged', row: existing, timestampDifference, attachmentReview }
  const evidence = { version: 1, source: 'meta_graph', observedAt: incoming.raw._akmez_history.observedAt, fields }
  const raw = { ...(isObject(existing.raw) ? existing.raw : { previous_raw: existing.raw ?? null }), _akmez_history_enrichment: evidence }
  return { action: 'enrich', row: { ...existing, body, attachments, raw }, timestampDifference, attachmentReview }
}
export function nextState(state, next, stats, now) {
  const updated = { ...state, ...next, status: next.after === null ? 'complete' : 'pending',
    completedAt: next.after === null ? now : null, lease: null, retryAt: null, failures: 0, lastError: null,
    counters: { ...state.counters } }
  for (const [key, count] of Object.entries(stats)) updated.counters[key] = (updated.counters[key] ?? 0) + count
  updated.counters.pages++
  if (updated.maxPages !== null && updated.counters.pages >= updated.maxPages && next.after !== null) {
    updated.status = 'complete'; updated.coverageCapped = true; updated.completedAt = now
  }
  return validateState(updated)
}
export function errorState(state, error, nowMs) {
  const known = error instanceof HistoryError ? error : new HistoryError('database_or_local_failure', { retryable: true })
  const failures = state.failures + 1
  const wait = known.delayMs ?? Math.min(3_600_000, 15_000 * 2 ** Math.min(failures - 1, 8))
  return validateState({ ...state, lease: null, failures, lastError: known.kind,
    status: known.retryable ? 'pending' : 'blocked', retryAt: known.retryable ? new Date(nowMs + wait).toISOString() : null })
}
