export type DraftScope = { phoneNumberId: string; waId: string }

export type DraftReadiness = {
  canDraft: boolean
  draftReasons: string[]
  contextVersion: number
  unsupportedOriginalCount: number
  canonicalHasMore: boolean
  totalCount: number
}

export type DraftReadinessState = {
  scope: DraftScope; readiness: DraftReadiness | null; loading: boolean
  error: string | null; checkedAt: string | null; cancelled: boolean
}

export type DraftContextStatus = { scope: DraftScope; readiness: DraftReadiness | null; pending: boolean; unavailable: boolean }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const bounded = (value: unknown, max = 600): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const sameScope = (left: DraftScope, right: DraftScope) => left.phoneNumberId === right.phoneNumberId && left.waId === right.waId
export const validDraftScope = (scope: DraftScope) => /^\d{5,30}$/.test(scope.phoneNumberId) && /^\d{5,20}$/.test(scope.waId)

export function parseDraftReadiness(value: unknown, scope: DraftScope): DraftReadiness {
  if (!record(value) || value.success !== true || !record(value.scope) ||
    value.scope.phoneNumberId !== scope.phoneNumberId || value.scope.waId !== scope.waId ||
    !record(value.readiness)) throw new Error('invalid response')
  const readiness = value.readiness
  if (typeof readiness.canDraft !== 'boolean' || !integer(readiness.contextVersion) ||
    !integer(readiness.unsupportedOriginalCount) || !integer(readiness.totalCount) ||
    typeof readiness.canonicalHasMore !== 'boolean' ||
    !Array.isArray(readiness.draftReasons) || readiness.draftReasons.length > 30 ||
    readiness.draftReasons.some(reason => !bounded(reason, 100))) throw new Error('invalid response')
  if (readiness.canDraft && (readiness.draftReasons.length || readiness.unsupportedOriginalCount || readiness.canonicalHasMore)) {
    throw new Error('inconsistent readiness')
  }
  return { canDraft: readiness.canDraft, draftReasons: [...readiness.draftReasons] as string[], contextVersion: readiness.contextVersion,
    unsupportedOriginalCount: readiness.unsupportedOriginalCount, canonicalHasMore: readiness.canonicalHasMore, totalCount: readiness.totalCount }
}

/** Fixed-scope cached reads only. Never sends and never marks a conversation read. */
export function createDraftReadinessClient(scope: DraftScope, fetcher: typeof fetch = fetch) {
  const fixedScope = { ...scope }
  let state: DraftReadinessState = { scope: fixedScope, readiness: null, loading: false, error: null, checkedAt: null, cancelled: false }
  let generation = 0, disposed = false, controller: AbortController | null = null
  const subscribers = new Set<() => void>()
  const update = (patch: Partial<DraftReadinessState>) => { if (!disposed) { state = { ...state, ...patch }; subscribers.forEach(callback => callback()) } }
  const cancel = () => { generation++; controller?.abort(); controller = null; update({ loading: false, cancelled: true }) }
  const read = async () => {
    if (disposed || !validDraftScope(fixedScope)) return
    controller?.abort()
    const current = ++generation, abort = new AbortController()
    controller = abort
    update({ loading: true, error: null, cancelled: false })
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('cancelled')) })
    aborted.catch(() => {})
    abort.signal.addEventListener('abort', rejectAbort, { once: true })
    const timer = setTimeout(() => abort.abort(), 15000)
    try {
      const query = new URLSearchParams(fixedScope)
      const response = await Promise.race([fetcher('/api/inbox/whatsapp/readiness?' + query.toString(), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal,
      }), aborted])
      if (!response.ok) throw new Error('read failed')
      const readiness = parseDraftReadiness(await Promise.race([response.json(), aborted]), fixedScope)
      if (disposed || current !== generation || abort.signal.aborted) return
      update({ readiness, checkedAt: new Date().toISOString(), loading: false, error: null })
    } catch {
      if (!disposed && current === generation) update({ loading: false, error: 'The conversation check could not be completed. Refresh to try again.' })
    } finally {
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', rejectAbort)
      if (current === generation) controller = null
      if (!disposed && current === generation && state.loading) update({ loading: false, error: 'The conversation check timed out. Refresh to try again.' })
    }
  }
  return { getSnapshot: () => state, subscribe: (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } },
    refresh: () => read(), cancel, dispose: () => { cancel(); disposed = true; subscribers.clear() } }
}

export function draftContextStatus(state: DraftReadinessState): DraftContextStatus {
  return { scope: state.scope, readiness: state.readiness, pending: state.loading, unavailable: !state.readiness || !!state.error || state.cancelled }
}

/**
 * Notices, NOT blocks. Every one of these used to pause drafting behind a
 * "draft anyway" button, and the answer was always to press it - the agent
 * cannot make the AI see a photo by looking at it themselves. So the draft is
 * written straight away and the gap is stated instead: the model is told what
 * it cannot read (markers in the prompt) and the agent is told to check before
 * sending. Nothing here stops a draft.
 */
export const ATTACHMENT_REVIEW_NOTICE = 'The AI cannot see photos or stickers in this thread - check them yourself before sending.'
/** A bubble Meta never delivered (reaction, deleted or view-once message): nothing to read, the later messages are. */
export const UNAVAILABLE_REVIEW_NOTICE = 'One earlier message is unavailable from WhatsApp (a reaction, deleted or view-once message). The draft works from the readable ones.'
export const MISSING_TEXT_REVIEW_NOTICE = 'Some message text never reached the app - usually a reply typed on the phone. Read those bubbles in WhatsApp before sending.'
export const LONG_HISTORY_REVIEW_NOTICE = 'This thread is longer than the AI can read in full - the draft works from the most recent messages.'
export const CHECKS_REVIEW_NOTICE = 'The stored conversation did not pass every message check - the draft works from what is readable.'
/** Transient states: the check is still running or failed, so there is nothing to draft from yet. */
export const TRANSIENT_BLOCK = 'AI drafting is paused until this conversation can be checked.'
export const COVERAGE_BLOCK = 'AI drafting is paused until this conversation can be checked.'

type DraftInput = {
  scope: DraftScope; messages: { text: string; attachments: unknown[]; unavailable?: boolean }[]; loading: boolean; error: boolean
  hasMore: boolean | undefined; readiness: DraftContextStatus | null
}

/**
 * UI guard only, and only for states where there is genuinely nothing to draft
 * from yet. Unreadable content is no longer one of them - see the notices.
 * The server must independently build and recheck the same scope's context.
 */
export function whatsappDraftBlock(input: DraftInput): string | null {
  if (input.loading || input.error) return TRANSIENT_BLOCK
  if (!input.messages.length) return 'AI drafting needs readable conversation history.'
  // A refresh in flight keeps the previous readiness valid; only the very first check has nothing to go on.
  if (!input.readiness || !sameScope(input.scope, input.readiness.scope) || (input.readiness.pending && !input.readiness.readiness) || input.readiness.unavailable)
    return COVERAGE_BLOCK
  return null
}

/** What the agent should know before sending. Never stops the draft. */
export function whatsappDraftNotice(input: DraftInput): string | null {
  if (input.loading || input.error || !input.messages.length) return null
  if (input.messages.some(message => !message.text.trim() && !message.unavailable && message.attachments.length === 0)) return MISSING_TEXT_REVIEW_NOTICE
  if (input.messages.some(message => message.attachments.length > 0)) return ATTACHMENT_REVIEW_NOTICE
  if (input.messages.some(message => message.unavailable)) return UNAVAILABLE_REVIEW_NOTICE
  if (input.hasMore !== false || input.messages.length > 100 || input.messages.reduce((length, message) => length + message.text.length, 0) > 30000)
    return LONG_HISTORY_REVIEW_NOTICE
  const readiness = input.readiness?.readiness
  if (!readiness) return null
  if (!readiness.canDraft || readiness.draftReasons.length || readiness.unsupportedOriginalCount || readiness.canonicalHasMore)
    return CHECKS_REVIEW_NOTICE
  return null
}
