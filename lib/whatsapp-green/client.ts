import type { GreenBinding } from './contract'

// Only the API origin observed in the connected instance console is permitted.
// Additional provider shards require explicit configuration/code review, not a wildcard.
const ALLOWED_ORIGINS = new Set(['https://7107.api.greenapi.com'])
const SCOPES: Record<string, string> = {
  '968962882975955': '23052500684',
  '1090043534186338': '23059406784',
}
export const GREEN_CLIENT_LIMITS = Object.freeze({
  timeoutMs: 20_000, responseBytes: 8 * 1024 * 1024, historyCount: 100,
  journalRows: 10_000, requestSpacingMs: 1_050,
})

export type GreenClientCode = 'CONFIG_INVALID' | 'CANCELLED' | 'TIMEOUT' | 'NETWORK_ERROR' |
  'REDIRECT_BLOCKED' | 'PROVIDER_UNAUTHORIZED' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_ERROR' |
  'RESPONSE_INVALID' | 'RESPONSE_TOO_LARGE' | 'NUMBER_UNCONFIRMED' | 'INSTANCE_NOT_READY'

export class GreenClientError extends Error {
  constructor(readonly code: GreenClientCode, readonly retryAfterSeconds: number | null = null) {
    super(code)
    this.name = 'GreenClientError'
  }
}
export type GreenRecord = Record<string, unknown>
export interface GreenAccountEvidence {
  businessPhone: string
  accountId: string
  observedAt: string
  historySyncProgress: number | null
}
type ClientOptions = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  now?: () => number
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}
const record = (value: unknown): value is GreenRecord => !!value && typeof value === 'object' && !Array.isArray(value)
function fail(code: GreenClientCode): never { throw new GreenClientError(code) }

export function validateGreenBinding(binding: GreenBinding): void {
  if (!binding || SCOPES[binding.phoneNumberId] !== binding.businessPhone ||
      typeof binding.instanceId !== 'string' || !/^[1-9]\d{0,19}$/.test(binding.instanceId) ||
      typeof binding.apiToken !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(binding.apiToken) ||
      typeof binding.apiUrl !== 'string' || !ALLOWED_ORIGINS.has(binding.apiUrl) ||
      typeof binding.accountId !== 'string' || !/^\d{5,25}@(c\.us|lid|s\.whatsapp\.net)$/.test(binding.accountId)) fail('CONFIG_INVALID')
}

export function isGreenChatId(value: unknown): value is string {
  // LIDs stay opaque; this check does not interpret their digits as telephone numbers.
  return typeof value === 'string' && /^\d{5,25}@(c\.us|lid|s\.whatsapp\.net)$/.test(value)
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new GreenClientError('CANCELLED')); return }
    const onAbort = () => { clearTimeout(timer); reject(new GreenClientError('CANCELLED')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function deadline(external?: AbortSignal) {
  const controller = new AbortController()
  let rejectDeadline!: (reason: GreenClientError) => void
  const expired = new Promise<never>((_, reject) => { rejectDeadline = reject })
  void expired.catch(() => {})
  let code: GreenClientCode = 'TIMEOUT'
  const abort = (reason: GreenClientCode) => {
    if (controller.signal.aborted) return
    code = reason
    controller.abort()
    rejectDeadline(new GreenClientError(reason))
  }
  const onAbort = () => abort('CANCELLED')
  external?.addEventListener('abort', onAbort, { once: true })
  if (external?.aborted) onAbort()
  const timer = setTimeout(() => abort('TIMEOUT'), GREEN_CLIENT_LIMITS.timeoutMs)
  return {
    signal: controller.signal,
    race: <T>(promise: Promise<T>) => Promise.race([promise, expired]),
    check: () => { if (controller.signal.aborted) fail(code) },
    close: () => { clearTimeout(timer); external?.removeEventListener('abort', onAbort) },
  }
}

async function readJson(response: Response, budget: ReturnType<typeof deadline>): Promise<unknown> {
  if (response.redirected || response.status >= 300 && response.status < 400) fail('REDIRECT_BLOCKED')
  if (response.status === 401 || response.status === 403) fail('PROVIDER_UNAUTHORIZED')
  if (response.status === 429) {
    const raw = response.headers.get('retry-after')
    const seconds = raw && /^\d{1,5}$/.test(raw) ? Math.min(3600, Number(raw)) : null
    throw new GreenClientError('PROVIDER_RATE_LIMITED', seconds)
  }
  if (response.status !== 200) fail('PROVIDER_ERROR')
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) fail('RESPONSE_INVALID')
  const length = response.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > GREEN_CLIENT_LIMITS.responseBytes)) fail('RESPONSE_TOO_LARGE')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0, finished = false
  try {
    while (true) {
      budget.check()
      const next = await budget.race(reader.read())
      if (next.done) { finished = true; break }
      total += next.value.byteLength
      if (total > GREEN_CLIENT_LIMITS.responseBytes) fail('RESPONSE_TOO_LARGE')
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { return fail('RESPONSE_INVALID') }
  } finally {
    if (!finished) { try { void reader.cancel().catch(() => {}) } catch {} }
    try { reader.releaseLock() } catch {}
  }
}

/** Server-only read methods. No settings, sends, mark-read, queue deletion or logging.
 * Credentials are passed privately by server config; importing has no side effects.
 * A durable per-instance scheduler lease is required across processes.
 */
export class GreenReadClient {
  private readonly binding: GreenBinding
  private readonly options: ClientOptions
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private nextStart = 0
  private serial: Promise<unknown> = Promise.resolve()

  constructor(binding: GreenBinding, options: ClientOptions = {}) {
    validateGreenBinding(binding)
    this.binding = { ...binding }
    this.options = options
    this.fetcher = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
  }

  private request(method: 'getWaSettings' | 'getChatHistory' | 'lastIncomingMessages' | 'lastOutgoingMessages',
                  body?: GreenRecord, minutes?: number): Promise<unknown> {
    const task = this.serial.then(async () => {
      if (this.options.signal?.aborted) fail('CANCELLED')
      const delay = Math.max(0, this.nextStart - this.now())
      if (delay) await (this.options.wait ?? sleep)(delay, this.options.signal)
      if (this.options.signal?.aborted) fail('CANCELLED')
      this.nextStart = this.now() + GREEN_CLIENT_LIMITS.requestSpacingMs
      const budget = deadline(this.options.signal)
      try {
        budget.check()
        const url = `${this.binding.apiUrl}/waInstance${this.binding.instanceId}/${method}/${this.binding.apiToken}` +
          (minutes === undefined ? '' : `?minutes=${minutes}`)
        const response = await budget.race(Promise.resolve().then(() => this.fetcher(url, {
          method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
          referrerPolicy: 'no-referrer', signal: budget.signal,
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })))
        try { return await readJson(response, budget) }
        finally { if (!response.bodyUsed) { try { void response.body?.cancel().catch(() => {}) } catch {} } }
      } catch (error) {
        if (error instanceof GreenClientError) throw error
        if (this.options.signal?.aborted) fail('CANCELLED')
        throw new GreenClientError('NETWORK_ERROR') // Never forward a URL-bearing provider exception.
      } finally { budget.close() }
    })
    this.serial = task.catch(() => {})
    return task
  }

  async verifyAccount(): Promise<GreenAccountEvidence> {
    const data = await this.request('getWaSettings')
    if (!record(data) || data.stateInstance !== 'authorized' || data.logoutProcess !== false) fail('INSTANCE_NOT_READY')
    if (data.phone !== this.binding.businessPhone || data.chatId !== this.binding.accountId) fail('NUMBER_UNCONFIRMED')
    return { businessPhone: this.binding.businessPhone, accountId: this.binding.accountId,
      observedAt: new Date(this.now()).toISOString(),
      historySyncProgress: typeof data.historySyncProgress === 'number' && Number.isInteger(data.historySyncProgress) &&
        data.historySyncProgress >= 0 && data.historySyncProgress <= 100 ? data.historySyncProgress : null }
  }

  async history(chatId: string, count: number = GREEN_CLIENT_LIMITS.historyCount): Promise<GreenRecord[]> {
    if (!isGreenChatId(chatId) || !Number.isInteger(count) || count < 1 || count > GREEN_CLIENT_LIMITS.historyCount) fail('CONFIG_INVALID')
    const data = await this.request('getChatHistory', { chatId, count })
    if (!Array.isArray(data) || data.length > count || data.some(row => !record(row) || row.chatId !== chatId)) fail('RESPONSE_INVALID')
    return data as GreenRecord[]
  }

  async journal(direction: 'in' | 'out', minutes: number): Promise<GreenRecord[]> {
    if (!['in', 'out'].includes(direction) || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) fail('CONFIG_INVALID')
    const data = await this.request(direction === 'in' ? 'lastIncomingMessages' : 'lastOutgoingMessages', undefined, minutes)
    const expectedType = direction === 'in' ? 'incoming' : 'outgoing'
    if (!Array.isArray(data) || data.length > GREEN_CLIENT_LIMITS.journalRows ||
        data.some(row => !record(row) || row.type !== expectedType)) fail('RESPONSE_INVALID')
    return data as GreenRecord[]
  }
}
