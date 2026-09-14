export const AUTOPILOT_BUSINESSES = ['made_by_moris', 'destockage'] as const
export type AutopilotBusinessKey = typeof AUTOPILOT_BUSINESSES[number]
export type AutopilotBusiness = {
  key: AutopilotBusinessKey; name: string; version: number; enabled: boolean
  state: 'paused' | 'enabled' | 'needs_review' | 'failed' | 'unknown'
  deliveryDate: string | null; maxDailyReplies: number; repliesToday: number
  freeDelivery: true; lastRunAt: string | null; reason: string | null; reservedToday?: number
}
export type AutopilotJob = {
  id: string; businessKey: AutopilotBusinessKey; conversationKey: string; customerName: string | null
  state: 'queued' | 'processing' | 'sending' | 'sent' | 'needs_review' | 'failed' | 'unknown' | 'cancelled'
  reason: string | null; updatedAt: string
  channel?: 'messenger' | 'whatsapp'; customerId?: string; manualTakeover?: boolean
}
export type AutopilotSnapshot = { businesses: AutopilotBusiness[]; jobs: AutopilotJob[]; permissions: { canManage: boolean } }
export type AutopilotOperation = { kind: 'refresh' | 'save' | 'pause' | 'run' | 'takeover'; businessKey?: AutopilotBusinessKey; jobId?: string }
export type AutopilotState = { snapshot: AutopilotSnapshot | null; loading: AutopilotOperation | null; error: string | null; checkedAt: string | null }
export type AutopilotSettings = { deliveryDate: string; maxDailyReplies: number }

export const AUTOPILOT_REASON_LABELS: Record<string, string> = {
  MISSING_HISTORY: 'Conversation history needs staff review.', ORIGINAL_CONTENT_MISSING: 'Some original message text is missing.',
  CONTEXT_INCOMPLETE: 'The conversation needs a complete context check.', PROVIDER_CONTEXT_UNALIGNED: 'Additional replies still need to be checked against the conversation.',
  UNSUPPORTED_CONTENT: 'A photo, attachment or other content needs staff review.', HISTORY_TRUNCATED: 'Older conversation history needs review.',
  PENDING_RECONCILIATION: 'Waiting for the conversation check to finish.', PROVIDER_CONFLICT: 'Conflicting message copies need review.',
  MANUAL_TAKEOVER: 'A team member has taken over this conversation.', HUMAN_REPLIED: 'A team member has already replied.',
  ALREADY_REPLIED: 'This message has already been handled.', NO_UNANSWERED_MESSAGE: 'No eligible unanswered message is waiting.',
  CONTEXT_CHANGED: 'A new message changed the conversation.', DAILY_LIMIT_REACHED: 'Today’s reply limit has been reached.',
  PAUSED: 'Autopilot is paused.', DISABLED: 'Autopilot is paused.', OUTSIDE_WINDOW: 'The messaging reply window is closed.',
  SEND_FAILED: 'The reply could not be sent. Staff review is needed.', SEND_UNKNOWN: 'Delivery could not be confirmed. Check before sending again.',
  SEND_UNCONFIRMED: 'Delivery could not be confirmed. Check before sending again.', CONNECTION_UNVERIFIED: 'The business connection needs checking.',
  PERMISSION_REQUIRED: 'The messaging connection needs permission.', ORDER_REVIEW_REQUIRED: 'Order details are ready for staff confirmation.',
  DELIVERY_DATE_EXPIRED: 'Choose a current delivery date before the next reply.', CURRENT_DELIVERY_DATE_REQUIRED: 'Choose a current delivery date before the next reply.',
  PROVIDER_OUTCOME_UNKNOWN: 'Delivery could not be confirmed. Check before sending again.', SEND_CONFIRMATION_MISSING: 'Delivery could not be confirmed. Check before sending again.',
  PRODUCT_CLARIFICATION: 'Asked which product the customer wants.', CATALOGUE_PRICE: 'Shared the current listed price.', DELIVERY_INFORMATION: 'Shared the scheduled delivery information.',
  COLLECT_ORDER_DETAILS: 'Asked for the remaining order details.', ORDER_READY_FOR_STAFF: 'Details collected; staff must confirm the order.',
  SOLD_OUT: 'Explained that the product is marked sold out.', VARIANT_CLARIFICATION: 'Asked which model or colour is needed.',
  SENT_LOCAL_SAVE_PENDING: 'Reply sent; local copy still needs checking.', HISTORY_NEEDS_REVIEW: 'Conversation history needs staff review.',
  DAILY_REPLY_LIMIT: 'Today’s reply limit has been reached.', PREVIOUS_SEND_UNCONFIRMED: 'An earlier reply is unconfirmed. Check the conversation before sending again.',
  NO_REPLY_NEEDED: 'No further reply was needed.', BUSINESS_PAUSED: 'Autopilot is paused.',
  UNVERIFIED_CANONICAL_CONTENT: 'The source of an older message could not be verified.',
  SCOPE_MISMATCH: 'The conversation’s business or customer identity needs checking.',
  REFERENCE_CONTEXT_UNSUPPORTED: 'A quoted message needs staff review.',
  PROVIDER_CONTEXT_UNACCOUNTED: 'Additional WhatsApp replies need a complete history check.',
  EMPTY_CONTEXT: 'No readable conversation is available yet.', NO_CONVERSATION: 'The conversation has not finished syncing.',
  NO_LIVE_INBOUND: 'No verified incoming message is available.', ALREADY_ANSWERED: 'A reply is already present in this conversation.',
  AMBIGUOUS_MESSAGE_ORDER: 'The message order needs staff review.', REPLY_WINDOW_CLOSED: 'The messaging reply window is closed.',
  CONTEXT_TOO_LONG: 'This long conversation needs staff review.', CONFLICTING_CONTENT: 'Two copies of a message disagree.',
  PRE_SEND_FAILED: 'The reply could not be prepared. No message was sent.',
  CUSTOMER_ISSUE: 'Customer issue — agent follow-up required.',
  EXCHANGE_OR_CHANGE_REQUEST: 'Exchange or order change — agent follow-up required.',
  REPLY_SERVICE_RATE_LIMITED: 'The AI service is busy. No message was sent.',
  REPLY_SERVICE_BILLING: 'The AI service account needs attention. No message was sent.',
  REPLY_GENERATION_FAILED: 'The AI could not prepare this reply. No message was sent.',
  CATALOGUE_UNAVAILABLE: 'The product catalogue could not be checked. No message was sent.',
  PROVIDER_CONFIGURATION_UNAVAILABLE: 'The messaging connection could not be prepared. No message was sent.',
}
export const autopilotReason = (reason: string | null) => {
  if (!reason) return null
  const key=reason.toUpperCase()
  return AUTOPILOT_REASON_LABELS[key] ?? (key.startsWith('HISTORY_') ? AUTOPILOT_REASON_LABELS[key.slice(8)] : undefined) ?? 'This conversation needs staff review.'
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const number = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const time = (v: unknown): v is string | null => v === null || string(v, 40) && Number.isFinite(Date.parse(v))
const reason = (v: unknown): v is string | null => v === null || string(v, 100) && /^[A-Za-z0-9_]+$/.test(v)
export function isAutopilotDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const parsed = new Date(v + 'T12:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v
}
export function autopilotDateBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (kind: string) => parts.find(p => p.type === kind)!.value
  const min = `${part('year')}-${part('month')}-${part('day')}`
  return { min, max: new Date(Date.parse(min + 'T12:00:00Z') + 365 * 86400000).toISOString().slice(0, 10) }
}
export function autopilotSettingsError(settings: AutopilotSettings, now = new Date()): string | null {
  const bounds = autopilotDateBounds(now)
  if (!isAutopilotDate(settings.deliveryDate) || settings.deliveryDate < bounds.min || settings.deliveryDate > bounds.max) return 'Choose a delivery date from today to one year ahead.'
  if (!Number.isSafeInteger(settings.maxDailyReplies) || settings.maxDailyReplies < 1 || settings.maxDailyReplies > 500) return 'Choose a daily reply limit between 1 and 500.'
  return null
}
export function parseAutopilotSnapshot(value: unknown): AutopilotSnapshot {
  if (!object(value) || value.success !== true || !Array.isArray(value.businesses) || value.businesses.length !== 2 ||
      !Array.isArray(value.jobs) || value.jobs.length > 100 || !object(value.permissions) || typeof value.permissions.canManage !== 'boolean') throw Error('Invalid status')
  const seen = new Set<string>()
  const businesses = value.businesses.map(item => {
    if (!object(item) || !AUTOPILOT_BUSINESSES.includes(item.businessKey as AutopilotBusinessKey) || seen.has(String(item.businessKey)) ||
        !string(item.name, 150) || !number(item.version) || typeof item.enabled !== 'boolean' ||
        !['paused', 'enabled', 'needs_review', 'failed', 'unknown'].includes(String(item.state)) ||
        !(item.deliveryDate === null || isAutopilotDate(item.deliveryDate)) || !number(item.maxDailyReplies) || item.maxDailyReplies < 1 || item.maxDailyReplies > 500 ||
        !number(item.repliesToday) || item.freeDelivery !== true || !time(item.lastRunAt) || !reason(item.reason) || item.reservedToday !== undefined && !number(item.reservedToday) ||
        item.enabled === true && item.state === 'paused' || item.enabled === false && item.state === 'enabled') throw Error('Invalid business status')
    seen.add(String(item.businessKey))
    return { key: item.businessKey, name: item.name, version: item.version, enabled: item.enabled, state: item.state,
      deliveryDate: item.deliveryDate, maxDailyReplies: item.maxDailyReplies, repliesToday: item.repliesToday,
      freeDelivery: true, lastRunAt: item.lastRunAt, reason: item.reason, ...(item.reservedToday !== undefined ? { reservedToday: item.reservedToday } : {}) } as AutopilotBusiness
  })
  const jobIds = new Set<string>()
  const jobs = value.jobs.map(item => {
    if (!object(item) || !string(item.id) || jobIds.has(item.id) || !AUTOPILOT_BUSINESSES.includes(item.businessKey as AutopilotBusinessKey) ||
        !string(item.conversationKey) || !(item.customerName === null || typeof item.customerName === 'string' && item.customerName.length <= 200) ||
        !['queued', 'processing', 'sending', 'sent', 'needs_review', 'failed', 'unknown', 'cancelled'].includes(String(item.state)) ||
        !reason(item.reason) || !time(item.updatedAt) || item.updatedAt === null) throw Error('Invalid job status')
    jobIds.add(item.id)
    const takeover = item.channel !== undefined || item.customerId !== undefined || item.manualTakeover !== undefined
    if (takeover && (!['messenger', 'whatsapp'].includes(String(item.channel)) || !string(item.customerId, 40) || !/^\d{5,30}$/.test(item.customerId) || typeof item.manualTakeover !== 'boolean')) throw Error('Invalid conversation identity')
    return { id: item.id, businessKey: item.businessKey, conversationKey: item.conversationKey, customerName: typeof item.customerName === 'string' && item.customerName.trim() ? item.customerName : null,
      state: item.state, reason: item.reason, updatedAt: item.updatedAt,
      ...(takeover ? { channel: item.channel, customerId: item.customerId, manualTakeover: item.manualTakeover } : {}) } as AutopilotJob
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
  return { businesses: AUTOPILOT_BUSINESSES.map(key => businesses.find(b => b.key === key)!), jobs, permissions: { canManage: value.permissions.canManage } }
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw Error('Empty response')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  let bytes = 0, text = ''
  try {
    while (true) {
      if (signal.aborted) throw Error('Request stopped')
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > 512 * 1024) throw Error('Response too large')
      text += decoder.decode(next.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } finally { signal.removeEventListener('abort', cancel); if (signal.aborted || bytes > 512 * 1024) cancel(); reader.releaseLock() }
}

/** Settings and finite-run controls only. This client never sends a customer message. */
export function createAutopilotClient(options: { fetcher?: typeof fetch; now?: () => Date; uuid?: () => string; timeoutMs?: number } = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? (() => new Date()), uuid = options.uuid ?? (() => crypto.randomUUID())
  let state: AutopilotState = { snapshot: null, loading: null, error: null, checkedAt: null }
  let generation = 0, disposed = false, controller: AbortController | null = null
  const listeners = new Set<() => void>(), uncertainRuns = new Map<AutopilotBusinessKey, { version: number; requestId: string }>()
  const update = (patch: Partial<AutopilotState>) => { if (disposed) return; state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const execute = async (operation: AutopilotOperation, body?: object, background = false): Promise<boolean> => {
    if (disposed || state.loading && operation.kind !== 'pause') return false
    controller?.abort()
    const current = ++generation, abort = new AbortController(); controller = abort
    update({ loading: operation, ...(background ? {} : { error: null }) })
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(Error('Request stopped')) }); aborted.catch(() => {})
    abort.signal.addEventListener('abort', rejectAbort, { once: true })
    const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? (operation.kind === 'run' ? 190000 : 20000))
    try {
      const response = await Promise.race([fetcher(operation.kind === 'run' ? '/api/inbox/autopilot/run' : '/api/inbox/autopilot', {
        method: operation.kind === 'refresh' ? 'GET' : operation.kind === 'run' ? 'POST' : 'PATCH',
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      }), aborted])
      if (!response.ok) {
        if (response.status === 409) throw Error('STALE_SETTINGS')
        if (response.status === 401 || response.status === 403) throw Error('NOT_AUTHORIZED')
        throw Error('REQUEST_FAILED')
      }
      const snapshot = parseAutopilotSnapshot(await Promise.race([readBoundedJson(response, abort.signal), aborted]))
      if (disposed || generation !== current || abort.signal.aborted) return false
      if (state.snapshot?.businesses.some(old => snapshot.businesses.find(b => b.key === old.key)!.version < old.version)) throw Error('STALE_SETTINGS')
      update({ snapshot, loading: null, checkedAt: now().toISOString(), ...(background ? {} : { error: null }) })
      return true
    } catch (error) {
      if (!disposed && generation === current) {
        const code = error instanceof Error ? error.message : ''
        const message = code === 'STALE_SETTINGS' ? 'Settings changed elsewhere. Refresh the status and review them before trying again.'
          : code === 'NOT_AUTHORIZED' ? 'Your account cannot manage Autopilot. Check that you are signed in with an authorised account.'
          : operation.kind === 'refresh' ? 'Autopilot status could not be checked. The last confirmed status is shown.'
          : operation.kind === 'pause' ? 'Pause could not be confirmed. Refresh to check the status before your team replies.'
          : 'The change could not be confirmed. Refresh the status before trying again.'
        update({ loading: null, error: message })
      }
      return false
    } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', rejectAbort); if (generation === current) controller = null }
  }
  const business = (key: AutopilotBusinessKey) => state.snapshot?.businesses.find(b => b.key === key)
  const canManage = () => state.snapshot?.permissions.canManage === true
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh: (background = false) => execute({ kind: 'refresh' }, undefined, background),
    configure: (key: AutopilotBusinessKey, expectedVersion: number, settings: AutopilotSettings, enabled: boolean) => {
      const current = business(key), error = autopilotSettingsError(settings, now())
      if (!canManage() || !current || current.version !== expectedVersion || error) { update({ error: error ?? 'Refresh and review the current settings first.' }); return Promise.resolve(false) }
      return execute({ kind: 'save', businessKey: key }, { businessKey: key, expectedVersion, deliveryDate: settings.deliveryDate, maxDailyReplies: settings.maxDailyReplies, enabled })
    },
    pause: (key: AutopilotBusinessKey) => canManage() && business(key)
      ? execute({ kind: 'pause', businessKey: key }, { action: 'pause', businessKey: key }) : Promise.resolve(false),
    run: async (key: AutopilotBusinessKey) => {
      const current = business(key)
      if (!canManage() || !current?.enabled || state.loading) return false
      const prior = uncertainRuns.get(key)
      const requestId = prior?.version === current.version ? prior.requestId : uuid(); uncertainRuns.set(key, { version: current.version, requestId })
      const success = await execute({ kind: 'run', businessKey: key }, { businessKey: key, expectedVersion: current.version, requestId })
      if (success) uncertainRuns.delete(key)
      return success
    },
    takeover: (jobId: string, paused: boolean) => {
      const job = state.snapshot?.jobs.find(j => j.id === jobId)
      if (!canManage() || !job?.channel || !job.customerId || typeof job.manualTakeover !== 'boolean' || !paused && !business(job.businessKey)?.enabled) return Promise.resolve(false)
      return execute({ kind: 'takeover', businessKey: job.businessKey, jobId }, { action: 'takeover', businessKey: job.businessKey, channel: job.channel, customerId: job.customerId, paused })
    },
    dismissError: () => update({ error: null }),
    dispose: () => { disposed = true; generation++; controller?.abort(); controller = null; uncertainRuns.clear(); listeners.clear() },
  }
}
