export type GreenScope = { phoneNumberId: string; waId: string }
export type GreenMessage = {
  id: string; source: 'green-api'; providerInstanceId: string; providerChatId: string; providerMessageId: string
  direction: 'in' | 'out'; kind: 'text' | 'unsupported' | 'deleted'; text: string | null
  providerAcceptedAt: string | null; sentAt: null; observedAt: string; edited: boolean; conflicted: boolean; canonicalReceiptMatch: 'verified' | 'unverified'
}
export type GreenReadiness = { allowed: false; canDraft: boolean; reasons: string[]; draftReasons: string[]; contextVersion: number
  unresolvedOriginalCount: number; unsupportedOriginalCount: number; canonicalHasMore: boolean; providerConflictCount: number; pendingProviderCount: number; providerUnalignedCount: number; coverage: 'unknown' }
export type GreenSnapshot = {
  scope: GreenScope
  binding: { configured: boolean; enabled: boolean; mode: 'observation'; state: 'not_configured' | 'not_connected' | 'paused' | 'observing' | 'needs_attention'; lastEventAt: string | null; lastReconcileAt: string | null; lastError: string | null }
  messages: GreenMessage[]; hasMore: boolean; nextCursor: string | null; readiness: GreenReadiness
}
export type GreenCopiesState = {
  scope: GreenScope; snapshot: GreenSnapshot | null; loading: 'refresh' | 'older' | null
  error: string | null; checkedAt: string | null; cancelled: boolean
}
export type GreenContextStatus = { scope: GreenScope; readiness: GreenReadiness | null; pending: boolean; unavailable: boolean }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const bounded = (value: unknown, max = 600): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const date = (value: unknown): value is string | null => value === null || typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
const sameScope = (left: GreenScope, right: GreenScope) => left.phoneNumberId === right.phoneNumberId && left.waId === right.waId
export const validGreenScope = (scope: GreenScope) => /^\d{5,30}$/.test(scope.phoneNumberId) && /^\d{5,20}$/.test(scope.waId)

export const GREEN_REASON_LABELS: Record<string, string> = {
  OBSERVATION_MODE: 'Observation mode · automatic replies are off.',
  COVERAGE_UNKNOWN: 'Complete readable conversation history has not been verified.',
  NOT_CONFIGURED: 'This business is not configured for additional copies.',
  PAUSED: 'Receiving additional copies is paused.',
  CONNECTION_UNVERIFIED: 'The business connection has not been verified.',
  ORIGINAL_CONTENT_MISSING: 'Some original messages have no verified copy, so their content is still missing.',
  UNSUPPORTED_CONTENT: 'Some message content needs a person to review it.',
  HISTORY_TRUNCATED: 'Only part of the conversation history is available.',
  PROVIDER_CONFLICT: 'Conflicting message records need review.',
  PENDING_RECONCILIATION: 'Message coverage checks are still pending.',
  NO_READABLE_CONTEXT: 'No readable original conversation is stored yet.',
  PROVIDER_CONTEXT_UNALIGNED: 'Some additional copies have no matching original message, so the AI transcript would omit them.',
}

export function parseGreenSnapshot(value: unknown, scope: GreenScope): GreenSnapshot {
  if (!record(value) || value.success !== true || !record(value.scope) ||
    value.scope.phoneNumberId !== scope.phoneNumberId || value.scope.waId !== scope.waId ||
    !record(value.binding) || !record(value.readiness) || !Array.isArray(value.messages) || value.messages.length > 100 ||
    typeof value.hasMore !== 'boolean' || !(value.nextCursor === null || bounded(value.nextCursor, 4000)) ||
    value.hasMore !== (value.nextCursor !== null)) throw new Error('invalid response')
  const binding = value.binding, readiness = value.readiness
  if (typeof binding.configured !== 'boolean' || typeof binding.enabled !== 'boolean' || binding.mode !== 'observation' ||
    !['not_configured', 'not_connected', 'paused', 'observing', 'needs_attention'].includes(String(binding.state)) || !date(binding.lastEventAt) ||
    !date(binding.lastReconcileAt) || !(binding.lastError === null || bounded(binding.lastError, 100)) ||
    readiness.allowed !== false || typeof readiness.canDraft !== 'boolean' || readiness.coverage !== 'unknown' || !integer(readiness.contextVersion) ||
    !integer(readiness.unresolvedOriginalCount) || !integer(readiness.unsupportedOriginalCount) || !integer(readiness.providerConflictCount) ||
    !integer(readiness.pendingProviderCount) || !integer(readiness.providerUnalignedCount) || typeof readiness.canonicalHasMore !== 'boolean' ||
    !Array.isArray(readiness.reasons) || readiness.reasons.length > 30 || readiness.reasons.some(reason => !bounded(reason, 100)) ||
    !Array.isArray(readiness.draftReasons) || readiness.draftReasons.length > 30 || readiness.draftReasons.some(reason => !bounded(reason, 100))) throw new Error('invalid response')
  if (readiness.canDraft && (readiness.draftReasons.length || readiness.unresolvedOriginalCount || readiness.unsupportedOriginalCount ||
    readiness.providerConflictCount || readiness.pendingProviderCount || readiness.providerUnalignedCount || readiness.canonicalHasMore)) throw new Error('inconsistent readiness')
  const messages: GreenMessage[] = value.messages.map(item => {
    if (!record(item) || !bounded(item.id) || item.source !== 'green-api' || !bounded(item.providerInstanceId, 30) ||
      !/^\d+$/.test(item.providerInstanceId) || !bounded(item.providerChatId) || !bounded(item.providerMessageId) ||
      !['in', 'out'].includes(String(item.direction)) || !['text', 'unsupported', 'deleted'].includes(String(item.kind)) ||
      !(item.text === null || typeof item.text === 'string' && item.text.length <= 100000) ||
      !date(item.providerAcceptedAt) || item.sentAt !== null || !date(item.observedAt) || item.observedAt === null ||
      typeof item.edited !== 'boolean' || typeof item.conflicted !== 'boolean' || !['verified', 'unverified'].includes(String(item.canonicalReceiptMatch)) ||
      ((item.conflicted || item.kind === 'deleted') && item.text !== null)) throw new Error('invalid response')
    return { id: item.id, source: 'green-api', providerInstanceId: item.providerInstanceId, providerChatId: item.providerChatId,
      providerMessageId: item.providerMessageId, direction: item.direction as GreenMessage['direction'], kind: item.kind as GreenMessage['kind'],
      text: item.text, providerAcceptedAt: item.providerAcceptedAt, sentAt: null, observedAt: item.observedAt,
      edited: item.edited, conflicted: item.conflicted, canonicalReceiptMatch: item.canonicalReceiptMatch as GreenMessage['canonicalReceiptMatch'] }
  })
  return { scope: { ...scope }, binding: { configured: binding.configured, enabled: binding.enabled, mode: 'observation',
    state: binding.state as GreenSnapshot['binding']['state'], lastEventAt: binding.lastEventAt, lastReconcileAt: binding.lastReconcileAt, lastError: binding.lastError },
    messages: mergeGreenMessages([], messages), hasMore: value.hasMore, nextCursor: value.nextCursor,
    readiness: { allowed: false, canDraft: readiness.canDraft, reasons: [...readiness.reasons] as string[], draftReasons: [...readiness.draftReasons] as string[], coverage: 'unknown',
      contextVersion: readiness.contextVersion, unresolvedOriginalCount: readiness.unresolvedOriginalCount, unsupportedOriginalCount: readiness.unsupportedOriginalCount,
      canonicalHasMore: readiness.canonicalHasMore, providerConflictCount: readiness.providerConflictCount, pendingProviderCount: readiness.pendingProviderCount,
      providerUnalignedCount: readiness.providerUnalignedCount } }
}

export function mergeGreenMessages(previous: GreenMessage[], incoming: GreenMessage[]): GreenMessage[] {
  const rows = new Map<string, GreenMessage>()
  for (const row of [...previous, ...incoming]) {
    const key = JSON.stringify([row.providerInstanceId, row.providerChatId, row.providerMessageId])
    const existing = rows.get(key)
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('conflicting copy')
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => {
    const aTime = Date.parse(a.observedAt)
    const bTime = Date.parse(b.observedAt)
    return (aTime === bTime ? 0 : aTime < bTime ? -1 : 1) || a.id.localeCompare(b.id)
  })
}

/** Fixed-scope cached reads only. Never contacts the provider, sends, or marks a conversation read. */
export function createGreenCopiesClient(scope: GreenScope, fetcher: typeof fetch = fetch) {
  const fixedScope = { ...scope }
  let state: GreenCopiesState = { scope: fixedScope, snapshot: null, loading: null, error: null, checkedAt: null, cancelled: false }
  let generation = 0, disposed = false, controller: AbortController | null = null
  const subscribers = new Set<() => void>()
  const update = (patch: Partial<GreenCopiesState>) => { if (!disposed) { state = { ...state, ...patch }; subscribers.forEach(callback => callback()) } }
  const cancel = () => { generation++; controller?.abort(); controller = null; update({ loading: null, cancelled: true }) }
  const read = async (older: boolean) => {
    if (disposed || !validGreenScope(fixedScope) || older && (state.loading || !state.snapshot?.nextCursor)) return
    const cursor = older ? state.snapshot!.nextCursor : null
    const previous = state.snapshot
    controller?.abort()
    const current = ++generation, abort = new AbortController()
    controller = abort
    update({ loading: older ? 'older' : 'refresh', error: null, cancelled: false })
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('cancelled')) })
    aborted.catch(() => {})
    abort.signal.addEventListener('abort', rejectAbort, { once: true })
    const timer = setTimeout(() => abort.abort(), 15000)
    try {
      const query = new URLSearchParams(fixedScope)
      if (cursor) query.set('cursor', cursor)
      const response = await Promise.race([fetcher('/api/inbox/whatsapp/green?' + query.toString(), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal,
      }), aborted])
      if (!response.ok) throw new Error('read failed')
      const snapshot = parseGreenSnapshot(await Promise.race([response.json(), aborted]), fixedScope)
      if (disposed || current !== generation || abort.signal.aborted) return
      if (older && previous) {
        // A new event can invalidate pagination. Never combine two context revisions.
        if (snapshot.readiness.contextVersion !== previous.readiness.contextVersion) throw new Error('history changed')
        snapshot.messages = mergeGreenMessages(previous.messages, snapshot.messages)
      }
      update({ snapshot, checkedAt: new Date().toISOString(), loading: null, error: null })
    } catch {
      if (!disposed && current === generation) update({ loading: null, error: 'Additional copies could not be checked. Loaded copies have been kept. Refresh to try again.' })
    } finally {
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', rejectAbort)
      if (current === generation) controller = null
      if (!disposed && current === generation && state.loading) update({ loading: null, error: 'The copy check timed out. Refresh to try again.' })
    }
  }
  return { getSnapshot: () => state, subscribe: (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } },
    refresh: () => read(false), loadOlder: () => read(true), cancel,
    dispose: () => { cancel(); disposed = true; subscribers.clear() } }
}

export function greenContextStatus(state: GreenCopiesState): GreenContextStatus {
  return { scope: state.scope, readiness: state.snapshot?.readiness ?? null,
    pending: !!state.loading, unavailable: !state.snapshot || !!state.error || state.cancelled }
}

/** UI guard only. The server must independently build and recheck the same scope's context. */
export function whatsappDraftBlock(input: {
  scope: GreenScope; messages: { text: string; attachments: unknown[] }[]; loading: boolean; error: boolean
  hasMore: boolean | undefined; green: GreenContextStatus | null
}): string | null {
  if (input.loading || input.error) return 'AI drafting is paused until this conversation can be checked.'
  if (!input.messages.length) return 'AI drafting needs readable conversation history.'
  if (input.messages.some(message => !message.text.trim())) return 'AI drafting is paused because message content is missing. You can reply manually.'
  if (input.messages.some(message => message.attachments.length > 0)) return 'AI drafting is paused because attachments need human review. You can reply manually.'
  if (input.hasMore !== false || input.messages.length > 100 || input.messages.reduce((length, message) => length + message.text.length, 0) > 30000)
    return 'AI drafting is paused because the available AI context would omit or shorten conversation history. You can reply manually.'
  if (!input.green || !sameScope(input.scope, input.green.scope) || input.green.pending || input.green.unavailable)
    return 'AI drafting is paused until additional-message coverage can be checked.'
  if (!input.green.readiness || !input.green.readiness.canDraft || input.green.readiness.draftReasons.length ||
    input.green.readiness.unresolvedOriginalCount || input.green.readiness.unsupportedOriginalCount || input.green.readiness.canonicalHasMore ||
    input.green.readiness.providerConflictCount || input.green.readiness.pendingProviderCount || input.green.readiness.providerUnalignedCount)
    return 'AI drafting is paused until the stored conversation is readable and its message checks pass. Manual replies remain available.'
  return null
}
