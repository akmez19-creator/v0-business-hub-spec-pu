export const RECOVERY_CONTACT = '23052583671'
export const RECOVERY_BUSINESSES = [
  { phoneNumberId: '968962882975955', name: 'Destockage By Moris', phone: '+230 5250 0684' },
  { phoneNumberId: '1090043534186338', name: 'Made By Moris', phone: '+230 5940 6784' },
] as const

export type ResponseSurface = 'business_suite' | 'akmez_manual'
export type RecoveryObservation = {
  sourceMessageId: string
  direction: 'in' | 'out'
  text: string | null
  kind: 'text' | 'unsupported'
  sentAt: string | null
  displayedSentAt: string | null
  unsupportedKind: string | null
  firstObservedAt: string
  source: 'whatsapp-web'
}
export type RecoverySnapshot = {
  success: true
  scope: { phoneNumberId: string; waId: string; businessName: string; businessPhone: string; pageId: string }
  control: { enabled: boolean; responseSurface: ResponseSurface; version: number; operatorUserId: string | null }
  status: {
    state: 'not_checked' | 'queued' | 'leased' | 'partial' | 'failed' | 'paused'
    lastAttemptAt: string | null
    lastCopiedAt: string | null
    coverage: 'unknown' | 'partial'
    reason: string | null
    leaseExpiresAt: string | null
    unresolvedReceiptCount?: number | null
  }
  observations: RecoveryObservation[]
  hasMore: boolean
}
export type RecoveryClientState = {
  phoneNumberId: string
  data: RecoverySnapshot | null
  loading: boolean
  saving: boolean
  error: string | null
  notice: string | null
  loadedAt: string | null
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
type Listener = () => void
type Configure = { action: 'configure'; enabled: boolean; responseSurface: ResponseSurface }
type Enqueue = { action: 'enqueue' }

class RecoveryRequestError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

function readSnapshot(value: unknown, phoneNumberId: string): RecoverySnapshot {
  const data = value as RecoverySnapshot
  if (!data || data.success !== true || data.scope?.phoneNumberId !== phoneNumberId ||
    data.scope?.waId !== RECOVERY_CONTACT || !data.control ||
    !Number.isSafeInteger(data.control.version) || data.control.version < 0 ||
    typeof data.control.enabled !== 'boolean' ||
    !['business_suite', 'akmez_manual'].includes(data.control.responseSurface) ||
    !data.status || !['not_checked', 'queued', 'leased', 'partial', 'failed', 'paused'].includes(data.status.state) ||
    !['unknown', 'partial'].includes(data.status.coverage) ||
    !Array.isArray(data.observations) || typeof data.hasMore !== 'boolean') {
    throw new Error('The server returned an unexpected conversation. Refresh before continuing.')
  }
  for (const item of data.observations) {
    if (item.source !== 'whatsapp-web' || typeof item.sourceMessageId !== 'string' ||
      !['in', 'out'].includes(item.direction) || !['text', 'unsupported'].includes(item.kind) ||
      (item.text !== null && typeof item.text !== 'string')) {
      throw new Error('The copied history could not be verified. Refresh before continuing.')
    }
  }
  return data
}

/** A scoped client store: changing business invalidates requests already in flight. */
export function createRecoveryClient(fetcher: Fetcher = fetch) {
  let state: RecoveryClientState = {
    phoneNumberId: RECOVERY_BUSINESSES[0].phoneNumberId,
    data: null, loading: false, saving: false, error: null, notice: null, loadedAt: null,
  }
  let generation = 0
  let request: AbortController | null = null
  let disposed = false
  const listeners = new Set<Listener>()
  const publish = (patch: Partial<RecoveryClientState>) => {
    state = { ...state, ...patch }
    if (!disposed) listeners.forEach(listener => listener())
  }
  const query = (phoneNumberId: string) => `/api/inbox/whatsapp/recovery?${new URLSearchParams({ phoneNumberId, waId: RECOVERY_CONTACT })}`

  async function perform(mutation?: Configure | Enqueue) {
    if (disposed || state.saving || (!mutation && state.loading)) return
    const phoneNumberId = state.phoneNumberId
    const version = state.data?.control.version
    if (mutation && (state.loading || version === undefined)) return
    if (mutation?.action === 'enqueue' && !state.data?.control.enabled) return
    const currentGeneration = ++generation
    request?.abort()
    const controller = new AbortController()
    request = controller
    publish({ loading: !mutation, saving: !!mutation, error: null, notice: null })
    try {
      const response = await fetcher(query(phoneNumberId), {
        method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal,
        ...(mutation ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          ...mutation, phoneNumberId, waId: RECOVERY_CONTACT, expectedVersion: version,
        }) } : {}),
      })
      let body: unknown
      try { body = await response.json() } catch { throw new RecoveryRequestError('The recovery service did not return a readable response. Try refreshing.', response.status) }
      if (!response.ok) {
        const serverError = body as { error?: unknown }
        throw new RecoveryRequestError(
          response.status === 409 ? 'This conversation changed in another session. Refresh to see its current settings.' :
            typeof serverError?.error === 'string' ? serverError.error : 'The request failed. Try refreshing.', response.status,
        )
      }
      const data = readSnapshot(body, phoneNumberId)
      if (disposed || currentGeneration !== generation) return
      publish({ data, loadedAt: new Date().toISOString(), notice: mutation?.action === 'enqueue' ?
        'Recovery requested. The connected worker must open and inspect this test conversation.' :
        mutation ? data.control.enabled ? 'Preference saved. Recovery is enabled for this test conversation.' :
          'Recovery paused for this test conversation.' : null })
    } catch (error) {
      if (disposed || currentGeneration !== generation || controller.signal.aborted) return
      publish({ error: error instanceof Error ? error.message : 'The recovery request failed.',
        ...(error instanceof RecoveryRequestError && error.status === 409 ? { data: null } : {}) })
    } finally {
      if (!disposed && currentGeneration === generation) publish({ loading: false, saving: false })
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh: () => perform(),
    selectBusiness(phoneNumberId: string) {
      if (!RECOVERY_BUSINESSES.some(business => business.phoneNumberId === phoneNumberId)) throw new Error('Choose a supported business.')
      if (phoneNumberId === state.phoneNumberId) return Promise.resolve()
      ++generation
      request?.abort()
      publish({ phoneNumberId, data: null, loading: false, saving: false, error: null, notice: null, loadedAt: null })
      return perform()
    },
    configure: (enabled: boolean, responseSurface: ResponseSurface) => perform({ action: 'configure', enabled, responseSurface }),
    enqueue: () => perform({ action: 'enqueue' }),
    activate() { disposed = false; publish({ loading: false, saving: false }) },
    dispose() { disposed = true; ++generation; request?.abort(); listeners.clear() },
  }
}

export function formatRecoveryDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function observationTime(item: RecoveryObservation): string {
  if (item.sentAt && Number.isFinite(Date.parse(item.sentAt))) return `${formatRecoveryDate(item.sentAt)} · Mauritius time`
  if (item.displayedSentAt) return `${item.displayedSentAt} · as displayed in WhatsApp; exact date not verified`
  return 'Sent time not available'
}
