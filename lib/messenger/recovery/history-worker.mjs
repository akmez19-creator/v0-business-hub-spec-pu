import { APPROVED_PAGES, GRAPH_VERSION, MAX_VALUE_BYTES, HistoryError, fail, initialState, targetState,
  requestUrl, pageRows, conversationRow, messageRow, targetedMessageRow, continuation, mergeMessage, id } from './history-core.mjs'

async function limitedJson(response) {
  const maximum = MAX_VALUE_BYTES + 100_000
  const advertised = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertised) && advertised > maximum) fail('provider_response_too_large')
  let text
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        size += value.byteLength
        if (size > maximum) { await reader.cancel(); fail('provider_response_too_large') }
        chunks.push(Buffer.from(value))
      }
      text = Buffer.concat(chunks).toString('utf8')
    } finally { reader.releaseLock() }
  } else {
    text = await response.text()
    if (Buffer.byteLength(text) > maximum) fail('provider_response_too_large')
  }
  try { return JSON.parse(text) } catch { fail('provider_json_invalid', { retryable: true }) }
}
export class GraphHistoryReader {
  constructor({ token, fetchImpl = fetch, clock = Date.now, maxRequests = 8, maxRunMs = 45000 } = {}) {
    if (typeof token !== 'string' || !token) fail('facebook_token_missing')
    this.token = token; this.fetchImpl = fetchImpl; this.clock = clock; this.startedAt = clock()
    this.maxRequests = maxRequests; this.maxRunMs = maxRunMs; this.requests = 0; this.pageTokens = new Map(); this.halted = null
  }
  canRead(pageId) { return !this.halted && this.clock() - this.startedAt < this.maxRunMs && this.requests + (this.pageTokens.has(pageId) ? 1 : 2) <= this.maxRequests }
  async get(url, token) {
    if (this.requests >= this.maxRequests || this.clock() - this.startedAt >= this.maxRunMs) fail('invocation_budget_reached', { retryable: true })
    if (this.halted) fail('graph_rate_limited', { retryable: true, delayMs: 300000 })
    const parsed = new URL(url)
    if (parsed.origin !== 'https://graph.facebook.com' || parsed.username || parsed.password || parsed.searchParams.has('access_token') || parsed.searchParams.has('appsecret_proof')) fail('unsafe_provider_url')
    this.requests++
    let response, json
    try {
      response = await this.fetchImpl(parsed, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) })
      json = await limitedJson(response)
    } catch (error) { throw error instanceof HistoryError ? error : new HistoryError('provider_transport_failure', { retryable: true }) }
    if (!response.ok || json?.error) {
      const code = Number.isSafeInteger(json?.error?.code) ? json.error.code : null
      const rate = response.status === 429 || [4,17,32,613].includes(code)
      if (rate) this.halted = 'graph_rate_limited'
      const retryAfter = response.headers.get('retry-after'), seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null
      const retryAt = retryAfter && seconds === null ? Date.parse(retryAfter) : NaN
      const delayMs = seconds !== null ? seconds * 1000 : Number.isFinite(retryAt) ? Math.max(0, retryAt - this.clock()) : rate ? 300000 : null
      fail(rate ? 'graph_rate_limited' : 'graph_request_failed', { code, retryable: rate || response.status >= 500 || json?.error?.is_transient === true, delayMs })
    }
    return json
  }
  async read(state) {
    if (!this.pageTokens.has(state.pageId)) {
      const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${state.pageId}`)
      url.searchParams.set('fields', 'id,access_token')
      const page = await this.get(url, this.token)
      if (page?.id !== state.pageId || typeof page.access_token !== 'string' || !page.access_token) fail('owning_page_token_unavailable')
      this.pageTokens.set(state.pageId, page.access_token)
    }
    return this.get(requestUrl(state), this.pageTokens.get(state.pageId))
  }
}
export function pilotTargets(artifact) {
  if (!artifact || !Array.isArray(artifact.pages)) fail('target_artifact_invalid')
  const seen = new Map()
  for (const page of artifact.pages) {
    if (!APPROVED_PAGES.includes(page?.pageId) || !Array.isArray(page.missingMessages)) fail('target_artifact_invalid')
    for (const row of page.missingMessages) {
      if (!id(row?.providerMessageId) || !['in','out'].includes(row.direction) || !Number.isFinite(Date.parse(row.createdTime))) fail('target_artifact_invalid')
      const target = { pageId: page.pageId, providerMessageId: row.providerMessageId, direction: row.direction, createdTime: row.createdTime }
      const previous = seen.get(row.providerMessageId)
      if (previous && (previous.pageId !== target.pageId || previous.direction !== target.direction || previous.createdTime !== target.createdTime)) fail('target_artifact_identity_conflict')
      seen.set(row.providerMessageId, target)
      if (seen.size > 100) fail('target_artifact_budget_exceeded')
    }
  }
  if (!seen.size) fail('target_artifact_empty')
  return [...seen.values()]
}
function uniqueMessages(rows) {
  const seen = new Map()
  for (const row of rows) {
    const previous = seen.get(row.mid)
    if (!previous) { seen.set(row.mid, row); continue }
    const result = mergeMessage(previous, row)
    seen.set(row.mid, result.row)
  }
  return [...seen.values()]
}
export async function runRecovery(store, options = {}) {
  const mode = options.mode ?? 'recent'
  if (!['recent','target','history'].includes(mode)) fail('mode_invalid')
  const clock = options.clock ?? Date.now, now = new Date(clock()).toISOString()
  const lookbackMs = options.lookbackMs ?? 86400_000
  if (!Number.isFinite(lookbackMs) || lookbackMs < 60_000 || lookbackMs > 7 * 86400_000) fail('recent_window_invalid')
  const cutoff = new Date(clock() - lookbackMs).toISOString()
  const maxSteps = options.maxSteps ?? 4
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) fail('invocation_step_budget_invalid')
  const graph = options.reader ?? new GraphHistoryReader({ ...options, clock })
  let cached = { cachedWithoutGraphId: 0, cachedActiveCapped: false }
  let seeds
  if (mode === 'target') {
    seeds = pilotTargets(options.artifact).map(target => targetState(target.pageId, target, now))
  } else {
    seeds = APPROVED_PAGES.map(pageId => initialState(pageId, null, now, { mode, cutoff }))
    if (mode === 'recent') {
      cached = await store.activeThreads(cutoff)
      seeds.push(...cached.threads.map(thread => initialState(thread.pageId, thread, now, { mode, cutoff })))
    }
  }
  await store.seed(seeds)
  const pageOrder = await store.pageOrder(mode)
  const report = { mode, dryRun: store.dryRun, requests: 0, attemptedPages: 0, committedPages: 0,
    observed: 0, inserted: 0, enriched: 0, unchanged: 0, timestampDifferences: 0, attachmentReview: 0,
    errors: [], halted: null, cachedWithoutGraphId: cached.cachedWithoutGraphId,
    cachedActiveCapped: cached.cachedActiveCapped,
    limitations: ['No outbound messages, read receipts, unread counters or Done state are changed. Recent activity reconciliation is a separate store option.',
      'Recent scope is bounded; capped discovery, unresolved thread identities and unavailable Meta history are not certified complete.',
      'Done/archive folder semantics and attachment binaries are outside this recovery guarantee.'] }
  const pausedUntil=await store.ratePause()
  if(pausedUntil) { report.halted='graph_rate_limited';report.ratePausedUntil=pausedUntil;report.pages=await store.status(mode);report.queuedWorkComplete=false;return report }
  let idle = 0
  for (let step = 0; step < maxSteps && idle < APPROVED_PAGES.length; step++) {
    const pageId = pageOrder[step % pageOrder.length]
    if (!graph.canRead(pageId)) { report.halted = graph.halted ?? 'invocation_budget_reached'; break }
    const claim = await store.claim(pageId, mode)
    if (!claim) { idle++; continue }
    idle = 0; report.attemptedPages++
    try {
      const response = await graph.read(claim.state), observedAt = new Date(clock()).toISOString()
      let messages = [], jobs = [], conversations = [], next
      if (claim.state.kind === 'message') {
        messages = [targetedMessageRow(response, claim.state, observedAt)]
        next = { after: null, graphVersion: claim.state.graphVersion }
      } else {
        const rows = pageRows(response)
        next = continuation(response, claim.state)
        if (claim.state.kind === 'discovery') {
          for (const row of rows) {
            const conversation = conversationRow(row, pageId)
            const updated = typeof row.updated_time === 'string' ? Date.parse(row.updated_time) : NaN
            if (mode === 'recent' && Number.isFinite(updated) && updated < Date.parse(claim.state.cutoff)) continue
            jobs.push(initialState(pageId, conversation, claim.state.startedAt, { mode, cutoff: claim.state.cutoff }))
          }
          // Discovery queues validated identities only; canonical conversation rows are touched with actual messages.
        } else {
          const selectedRows = mode === 'recent' ? rows.filter(row => {
            const time = typeof row?.created_time === 'string' ? Date.parse(row.created_time) : NaN
            // Invalid timestamps still reach strict validation; only definitely old rows are outside this mode.
            return !Number.isFinite(time) || time >= Date.parse(claim.state.cutoff)
          }) : rows
          const normalized = []
          for (const row of selectedRows) {
            try { normalized.push(messageRow(row, claim.state, observedAt)) }
            catch (error) {
              if (mode !== 'recent' || !(error instanceof HistoryError) || error.kind !== 'nested_attachment_pagination_requires_review') throw error
              // The exact identity, sender, timestamp, body type and attachment shape were already validated.
              // Keep this one message unresolved without holding unrelated new text behind its attachment page.
              const unresolved = targetState(pageId, { providerMessageId: row.id,
                direction: row.from.id === pageId ? 'out' : 'in', createdTime: row.created_time }, claim.state.startedAt)
              jobs.push({ ...unresolved, mode: 'recent', conversationId: claim.state.conversationId,
                psid: claim.state.psid, cutoff: claim.state.cutoff, status: 'blocked',
                lastError: 'nested_attachment_pagination_requires_review' })
            }
          }
          messages = uniqueMessages(normalized)
          if (mode === 'recent') {
            if(messages.some(row=>Date.parse(row.created_at)>clock()+300000))fail('recent_message_timestamp_in_future')
            messages = messages.filter(row => Date.parse(row.created_at) >= Date.parse(claim.state.cutoff))
          }
          if (messages.length) conversations = [{ pageId, psid: claim.state.psid, id: claim.state.conversationId }]
        }
      }
      const result = await store.commitPage(claim, { messages, conversations, jobs, next })
      report.committedPages++
      for (const key of ['observed','inserted','enriched','unchanged','timestampDifferences','attachmentReview']) report[key] += result[key] ?? 0
    } catch (error) {
      const safe = error instanceof HistoryError ? error : new HistoryError('database_or_local_failure', { retryable: true })
      try { await store.failClaim(claim, safe) } catch { /* A lost lease cannot overwrite its replacement. */ }
      if(graph.halted==='graph_rate_limited') {
        try { await store.pauseRateLimit(new Date(clock()+(safe.delayMs??300000)).toISOString()) }
        catch { report.errors.push({pageId,kind:'rate_pause_persistence_failed',code:null,retryable:true}) }
      }
      report.errors.push({ pageId, kind: safe.kind, code: safe.code, retryable: safe.retryable })
      if (graph.halted) { report.halted = graph.halted; break }
    }
  }
  report.requests = graph.requests
  report.pages = await store.status(mode)
  // Completion is deliberately a scoped checkpoint result, never a claim that Suite holds no further content.
  report.queuedWorkComplete = report.pages.every(page => page.pending === 0 && page.blocked === 0 && page.capped === 0)
  return report
}
