import type { CentralBusinessView, CentralConnectionPhase, CentralObservationView } from './whatsapp-central-view'

export const CENTRAL_CONTACT = '23052583671'
export const CENTRAL_BUSINESSES = [
  { phoneNumberId: '968962882975955', name: 'Destockage By Moris', phone: '+230 5250 0684', digits: '23052500684' },
  { phoneNumberId: '1090043534186338', name: 'Made By Moris', phone: '+230 5940 6784', digits: '23059406784' },
] as const
type OperationName = 'connect' | 'pause' | 'fetch'
type Pairing = { token: string; expiresAt: string; sessionId: string }
export type CentralSnapshot = {
  success: true
  scope: { phoneNumberId: string; waId: string; businessName: string; businessPhone: string; pageId: string }
  session: {
    id: string | null; generation: number; connectionEnabled: boolean; state: CentralConnectionPhase
    lastSeenAt: string | null; workerExpiresAt: string | null; observedBusinessPhone: string | null; reason: string | null
    qr: { url: string; expiresAt: string } | null
    operation: { id: string; requestId: string; state: 'queued' | 'copying' | 'partial' | 'failed' | 'paused'; expiresAt: string; reason: string | null } | null
  }
  control: { enabled: boolean; responseSurface: 'business_suite' | 'akmez_manual'; version: number; operatorUserId: string | null }
  history: { unresolvedReceiptCount: number; lastCopiedAt: string | null; coverage: 'unknown' | 'partial' }
  observations: (CentralObservationView & { source: 'whatsapp-web' })[]
  hasMore: boolean
}
export type CentralClientState = {
  selectedBusinessId: string; snapshots: Record<string, CentralSnapshot | null>
  loading: Record<string, boolean>; operations: Record<string, OperationName | null>; errors: Record<string, string | null>
  pairing: Record<string, Omit<Pairing, 'token'> | null>; notice: string | null; checkedAt: string | null
}
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
type Mutation = { action: 'connect'; expectedGeneration: number } | { action: 'pause' } |
  { action: 'fetch'; expectedGeneration: number; requestId: string }
const PHASES = ['offline', 'disconnected', 'starting', 'qr', 'connecting', 'ready', 'paused', 'failed', 'mismatch']
const REASONS: Record<string, string> = {
  worker_offline: 'The central recovery service is not responding.',
  worker_expired: 'The service connection expired. Connect it again before fetching.',
  phone_mismatch: 'A different business phone connected. Pause it and connect the matching number.',
  identity_mismatch: 'The connected phone does not match this business.',
  pairing_required: 'The central recovery service needs its one-time setup before a phone code can appear.',
  pairing_expired: 'The service setup code expired. Connect again to request another.',
  request_expired: 'The history request expired. Reconnect the service if needed, then request another fetch.',
  connection_lost: 'The connection stopped responding before this fetch finished.',
  coverage_not_verified: 'Copies were received. Complete conversation history has not been verified.',
  paused: 'Recovery is paused for this business.',
}
const future = (value: string | null | undefined, now: number) => !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) > now
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')
export function workerIsFresh(snapshot: CentralSnapshot | null, now = Date.now()): boolean {
  const session = snapshot?.session
  return !!session && future(session.workerExpiresAt, now) && !!session.lastSeenAt && Number.isFinite(Date.parse(session.lastSeenAt)) &&
    now - Date.parse(session.lastSeenAt) <= 20_000 && Date.parse(session.lastSeenAt) <= now + 5_000
}
function validQrUrl(url: string, snapshot: CentralSnapshot): boolean {
  if (!url.startsWith('/api/inbox/whatsapp/central/qr?') || url.length > 2048) return false
  try {
    const parsed = new URL(url, 'https://www.akmez.tech')
    return parsed.pathname === '/api/inbox/whatsapp/central/qr' && parsed.searchParams.get('phoneNumberId') === snapshot.scope.phoneNumberId &&
      parsed.searchParams.get('waId') === CENTRAL_CONTACT && parsed.searchParams.get('sessionId') === snapshot.session.id &&
      parsed.searchParams.get('generation') === String(snapshot.session.generation) && !!parsed.searchParams.get('nonce')
  } catch { return false }
}
function parseSnapshot(input: unknown, phoneNumberId: string): CentralSnapshot {
  const value = input as CentralSnapshot, expected = CENTRAL_BUSINESSES.find(item => item.phoneNumberId === phoneNumberId)!
  if (!value || value.success !== true || value.scope?.phoneNumberId !== phoneNumberId || value.scope.waId !== CENTRAL_CONTACT ||
    digits(value.scope.businessPhone) !== expected.digits || !value.session || !PHASES.includes(value.session.state) ||
    !Number.isSafeInteger(value.session.generation) || value.session.generation < 0 || typeof value.session.connectionEnabled !== 'boolean' ||
    !value.control || typeof value.control.enabled !== 'boolean' || !value.history ||
    !Number.isSafeInteger(value.history.unresolvedReceiptCount) || value.history.unresolvedReceiptCount < 0 ||
    !['unknown', 'partial'].includes(value.history.coverage) || !Array.isArray(value.observations) || typeof value.hasMore !== 'boolean') throw new Error('The connection response could not be verified.')
  if (value.session.qr && (typeof value.session.qr.url !== 'string' || !validQrUrl(value.session.qr.url, value) ||
    !Number.isFinite(Date.parse(value.session.qr.expiresAt)))) throw new Error('The pairing code did not match this business connection.')
  if (value.session.operation && (!['queued', 'copying', 'partial', 'failed', 'paused'].includes(value.session.operation.state) ||
    !Number.isFinite(Date.parse(value.session.operation.expiresAt)) || typeof value.session.operation.requestId !== 'string')) throw new Error('The history request status could not be verified.')
  for (const item of value.observations) {
    if (!item || item.source !== 'whatsapp-web' || typeof item.sourceMessageId !== 'string' || !['in', 'out'].includes(item.direction) ||
      !['text', 'unsupported'].includes(item.kind) || (item.text !== null && typeof item.text !== 'string')) throw new Error('The copied history could not be verified.')
  }
  // Do not retain the optional one-time pairing credential inside public state.
  return { success: true, scope: value.scope, session: value.session, control: value.control, history: value.history,
    observations: value.observations, hasMore: value.hasMore }
}

export function centralBusinessViews(state: CentralClientState, now = Date.now()): CentralBusinessView[] {
  return CENTRAL_BUSINESSES.map(business => {
    const snapshot = state.snapshots[business.phoneNumberId], session = snapshot?.session
    const fresh = !state.errors[business.phoneNumberId] && workerIsFresh(snapshot, now)
    const matches = !!session && digits(session.observedBusinessPhone) === business.digits
    let phase: CentralConnectionPhase = session?.state ?? 'disconnected'
    if (['ready', 'qr', 'connecting'].includes(phase) && !fresh) phase = 'offline'
    if (phase === 'ready' && !matches) phase = session?.observedBusinessPhone ? 'mismatch' : 'connecting'
    const operation = session?.operation
    const active = !!operation && ['queued', 'copying'].includes(operation.state) && future(operation.expiresAt, now)
    const expired = !!operation && ['queued', 'copying'].includes(operation.state) && !active
    const pairing = state.pairing[business.phoneNumberId]
    const pairingSetup = pairing && future(pairing.expiresAt, now) ? pairing : null
    const localOperation = state.operations[business.phoneNumberId] ?? null
    return {
      ...business, phase, workerOnline: fresh, recoveryEnabled: snapshot?.control.enabled ?? false,
      workerExpiresAt: session?.workerExpiresAt ?? null,
      connectedPhone: session?.observedBusinessPhone ?? null,
      qr: phase === 'qr' && fresh && !localOperation && session?.qr ? { imageSrc: session.qr.url, expiresAt: session.qr.expiresAt } : null,
      explanation: state.errors[business.phoneNumberId] ?? (phase === 'mismatch' ? `This connection must use ${business.phone}.` :
        phase === 'offline' ? 'The central recovery service is unavailable or its connection expired.' :
        session?.reason ? REASONS[session.reason] ?? session.reason : null),
      operation: localOperation,
      canConnect: !!snapshot && !localOperation && (['disconnected', 'paused', 'failed', 'mismatch', 'offline'].includes(phase) ||
        (phase === 'starting' && !fresh && !pairingSetup) || (phase === 'qr' && !future(session?.qr?.expiresAt, now))),
      canFetch: !!snapshot && phase === 'ready' && fresh && matches && session?.connectionEnabled === true && !active && !localOperation,
      fetchState: expired ? 'failed' : operation?.state === 'partial' ? 'uploaded' : operation?.state === 'copying' ? 'capturing' : operation?.state ?? 'none',
      fetchReason: expired ? REASONS.request_expired : operation?.reason ? REASONS[operation.reason] ?? operation.reason : null,
      lastCopiedAt: snapshot?.history.lastCopiedAt ?? null, missingReceiptCount: snapshot?.history.unresolvedReceiptCount ?? null,
      observations: snapshot?.observations ?? [], hasMore: snapshot?.hasMore ?? false, pairingSetup,
    }
  })
}

export function createCentralRecoveryClient(fetcher: Fetcher = fetch, uuid: () => string = () => crypto.randomUUID()) {
  let state: CentralClientState = { selectedBusinessId: CENTRAL_BUSINESSES[0].phoneNumberId, snapshots: {}, loading: {},
    operations: {}, errors: {}, pairing: {}, notice: null, checkedAt: null }
  let disposed = false
  const subscribers = new Set<() => void>(), sequences = new Map<string, number>(), requests = new Map<string, AbortController>()
  const pairingTokens = new Map<string, Pairing & { generation: number }>(), pairingEpochs = new Map<string, number>()
  const fetchRetries = new Map<string, Extract<Mutation, { action: 'fetch' }>>()
  const publish = (patch: Partial<CentralClientState>) => { state = { ...state, ...patch }; if (!disposed) subscribers.forEach(fn => fn()) }
  const patchScope = <K extends 'snapshots' | 'loading' | 'operations' | 'errors' | 'pairing'>(key: K, id: string, value: CentralClientState[K][string]) => publish({ [key]: { ...state[key], [id]: value } })
  const scope = (id: string) => { if (!CENTRAL_BUSINESSES.some(item => item.phoneNumberId === id)) throw new Error('Unknown business connection.'); return id }
  const clearPairing = (id: string) => { pairingEpochs.set(id, (pairingEpochs.get(id) ?? 0) + 1); pairingTokens.delete(id); patchScope('pairing', id, null) }
  const readSetupCode = (id: string): string | null => {
    scope(id)
    const pairing = pairingTokens.get(id), session = state.snapshots[id]?.session
    return pairing && session?.connectionEnabled && session.id === pairing.sessionId && session.generation === pairing.generation &&
      session.workerExpiresAt === null && future(pairing.expiresAt, Date.now())
      ? JSON.stringify({ phoneNumberId: id, sessionId: pairing.sessionId, pairToken: pairing.token }) : null
  }

  async function perform(id: string, mutation?: Mutation) {
    scope(id)
    if (disposed || state.operations[id] === 'pause' || (mutation?.action !== 'pause' && (state.operations[id] || state.loading[id]))) return
    const credentialEpoch = pairingEpochs.get(id) ?? 0
    const sequence = (sequences.get(id) ?? 0) + 1; sequences.set(id, sequence); requests.get(id)?.abort()
    const controller = new AbortController(); requests.set(id, controller)
    patchScope('loading', id, !mutation); patchScope('operations', id, mutation?.action ?? null); patchScope('errors', id, null)
    if (mutation) publish({ notice: null })
    if (mutation?.action === 'pause') { clearPairing(id); fetchRetries.delete(id) }
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetcher(`/api/inbox/whatsapp/central?${new URLSearchParams({ phoneNumberId: id, waId: CENTRAL_CONTACT })}`, {
        method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        ...(mutation ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...mutation, phoneNumberId: id, waId: CENTRAL_CONTACT }) } : {}),
      })
      const raw = await response.json()
      if (!response.ok || raw?.success !== true) throw new Error(typeof raw?.error === 'string' ? raw.error : 'The service did not confirm this request.')
      const data = parseSnapshot(raw, id)
      if (disposed || sequences.get(id) !== sequence) return
      if (mutation?.action === 'connect' && raw.pairing) {
        const pairing = raw.pairing as Pairing
        if (typeof pairing.token !== 'string' || !pairing.token || pairing.token.length > 8192 || pairing.sessionId !== data.session.id ||
          !future(pairing.expiresAt, Date.now())) throw new Error('The one-time service setup could not be verified. Connect again after refreshing.')
        if ((pairingEpochs.get(id) ?? 0) === credentialEpoch && data.session.connectionEnabled && data.session.workerExpiresAt === null) {
          pairingTokens.set(id, { ...pairing, generation: data.session.generation })
          patchScope('pairing', id, { expiresAt: pairing.expiresAt, sessionId: pairing.sessionId })
        }
      } else if (!data.session.connectionEnabled || data.session.workerExpiresAt !== null || state.pairing[id]?.sessionId !== data.session.id ||
        pairingTokens.get(id)?.generation !== data.session.generation ||
        !future(state.pairing[id]?.expiresAt, Date.now())) clearPairing(id)
      if (data.session.operation?.requestId === fetchRetries.get(id)?.requestId) fetchRetries.delete(id)
      patchScope('snapshots', id, data); publish({ checkedAt: new Date().toISOString() })
      if (mutation) publish({ notice: mutation.action === 'pause' ? 'Recovery is paused for this business. Previously accepted copies remain saved.' :
        mutation.action === 'connect' ? 'Connection requested. Its live status and phone pairing code will appear in this business card.' :
          'Asla history requested for this business. Copies appear after the service stores them.' })
    } catch {
      if (disposed || sequences.get(id) !== sequence) return
      patchScope('errors', id, mutation?.action === 'pause' ? 'Pause was not confirmed. Refresh, then try Pause recovery again.' :
        mutation?.action === 'fetch' ? 'The fetch result is not confirmed. Refresh to check its status; retry uses the same request.' :
        mutation?.action === 'connect' ? 'Connection was not confirmed. Refresh to check its status before trying again.' : 'Could not refresh this business connection.')
    } finally {
      clearTimeout(timeout)
      if (!disposed && sequences.get(id) === sequence) { patchScope('loading', id, false); patchScope('operations', id, null) }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { subscribers.add(fn); return () => { subscribers.delete(fn) } },
    refresh(manual = false) { if (manual) for (const item of CENTRAL_BUSINESSES) clearPairing(item.phoneNumberId); return Promise.all(CENTRAL_BUSINESSES.map(item => perform(item.phoneNumberId))) },
    selectBusiness(id: string) { scope(id); for (const item of CENTRAL_BUSINESSES) clearPairing(item.phoneNumberId); publish({ selectedBusinessId: id }) },
    connect(id: string) {
      scope(id); const data = state.snapshots[id], view = centralBusinessViews(state).find(item => item.phoneNumberId === id)
      if (!data || !view?.canConnect) return Promise.resolve()
      clearPairing(id); return perform(id, { action: 'connect', expectedGeneration: data.session.generation })
    },
    pause: (id: string) => perform(id, { action: 'pause' }),
    fetchHistory(id: string) {
      scope(id); const data = state.snapshots[id], view = centralBusinessViews(state).find(item => item.phoneNumberId === id)
      if (!data || !view?.canFetch) return Promise.resolve()
      let action = fetchRetries.get(id)
      if (!action || action.expectedGeneration !== data.session.generation) { action = { action: 'fetch', expectedGeneration: data.session.generation, requestId: uuid() }; fetchRetries.set(id, action) }
      return perform(id, action)
    },
    dismissPairing: clearPairing,
    readSetupCode,
    async copyPairing(id: string, writeText: (value: string) => Promise<void> = value => navigator.clipboard.writeText(value)) {
      const setupCode = readSetupCode(id)
      if (!setupCode) { clearPairing(id); publish({ notice: 'This setup code is unavailable. Connect again to request a new one.' }); return }
      try {
        await writeText(setupCode)
        publish({ notice: 'One-time setup code copied. Paste it into the Akmez connection service for this business. Keep it private.' })
      }
      catch { publish({ notice: 'The setup code could not be copied. Allow clipboard access and try again.' }) }
    },
    activate() { disposed = false; publish({ loading: {}, operations: {} }) },
    dispose() { disposed = true; for (const [id, request] of requests) { sequences.set(id, (sequences.get(id) ?? 0) + 1); request.abort() }; pairingTokens.clear(); fetchRetries.clear(); subscribers.clear(); state = { ...state, pairing: {} } },
  }
}
