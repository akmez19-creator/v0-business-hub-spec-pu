import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserClient } from '@supabase/ssr'
import { fetchWithSignInTimeout, loginErrorMessage, safeLoginDestination, SIGN_IN_TIMEOUT_MS } from '../lib/supabase/sign-in'

const base = 'https://signin-test.supabase.co'
const endpoint = `${base}/auth/v1/token?grant_type=password`
const credentials = { email: 'test@example.invalid', password: 'test-only-password' }
const user = {
  id: 'f18bd9c2-f00a-48a9-b5d3-13b5b6a58dfe',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-09-17T00:00:00.000Z',
}

function tokenResponse() {
  return new Response(JSON.stringify({
    access_token: 'test-only-access-token',
    refresh_token: 'test-only-refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  }), { headers: { 'Content-Type': 'application/json' } })
}

function browserClient() {
  const cookies = new Map<string, string>()
  const writes = vi.fn((updates: Array<{ name: string; value: string }>) => {
    for (const cookie of updates) cookies.set(cookie.name, cookie.value)
  })
  const client = createBrowserClient(base, 'test-only-anon-key', {
    isSingleton: false,
    global: { fetch: fetchWithSignInTimeout },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll: writes,
    },
  })
  return { client, cookies, writes }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('password sign-in deadline', () => {
  it('saves a healthy native Supabase session without another user lookup', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => tokenResponse())
    vi.stubGlobal('fetch', fetcher)
    const { client, cookies } = browserClient()
    const { data, error } = await client.auth.signInWithPassword(credentials)
    expect(error).toBeNull()
    expect(data.user?.id).toBe(user.id)
    expect(data.session?.access_token).toBe('test-only-access-token')
    expect(cookies.get('sb-signin-test-auth-token')).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(endpoint)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a stalled request and leaves no session or unused timer', async () => {
    let signal!: AbortSignal
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init!.signal!
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetcher)
    const { client, writes } = browserClient()
    const pending = client.auth.signInWithPassword(credentials)
    await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS)
    const { data, error } = await pending
    expect(signal.aborted).toBe(true)
    expect(data.session).toBeNull()
    expect(loginErrorMessage(error)).toContain('not responding')
    expect(writes).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the deadline active when headers arrive but the body stalls', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { body = controller },
    }), { headers: { 'Content-Type': 'application/json' } })))
    const { client, writes } = browserClient()
    const pending = client.auth.signInWithPassword(credentials)
    await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS)
    const result = await pending
    expect(result.data.session).toBeNull()
    expect(loginErrorMessage(result.error)).toContain('not responding')
    body.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores late success even if a fetch implementation disregards cancellation', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
    const { client, writes } = browserClient()
    const pending = client.auth.signInWithPassword(credentials)
    await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS)
    expect((await pending).data.session).toBeNull()
    finish(tokenResponse())
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows retry after timeout without accepting the first attempt later', async () => {
    let finishFirst!: (response: Response) => void
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve }))
      .mockImplementationOnce(async () => tokenResponse())
    vi.stubGlobal('fetch', fetcher)
    const { client, cookies, writes } = browserClient()
    const first = client.auth.signInWithPassword(credentials)
    await vi.advanceTimersByTimeAsync(SIGN_IN_TIMEOUT_MS)
    expect((await first).error).not.toBeNull()
    const retry = await client.auth.signInWithPassword(credentials)
    expect(retry.error).toBeNull()
    expect(cookies.get('sb-signin-test-auth-token')).toBeTruthy()
    const writeCount = writes.mock.calls.length
    finishFirst(tokenResponse())
    await vi.advanceTimersByTimeAsync(0)
    expect(writes).toHaveBeenCalledTimes(writeCount)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves caller cancellation', async () => {
    const controller = new AbortController()
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init!.signal!
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })))
    const pending = fetchWithSignInTimeout(endpoint, { signal: controller.signal }).catch(error => error)
    controller.abort(new DOMException('Cancelled by caller', 'AbortError'))
    expect((await pending).name).toBe('AbortError')
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    '/rest/v1/profiles?select=id', '/auth/v1/user',
    '/auth/v1/token?grant_type=refresh_token', '/auth/v1/signup',
  ])('does not change requests to %s', async path => {
    const response = new Response('{}')
    const fetcher = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetcher)
    const init = { method: 'POST' }
    expect(await fetchWithSignInTimeout(`${base}${path}`, init)).toBe(response)
    expect(fetcher).toHaveBeenCalledWith(`${base}${path}`, init)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([429, 500, 503, 504])('recovers from upstream HTTP %s without a session', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Private provider diagnostic' }), {
      status, headers: { 'Content-Type': 'application/json' },
    })))
    const { client, writes } = browserClient()
    const result = await client.auth.signInWithPassword(credentials)
    expect(result.data.session).toBeNull()
    expect(loginErrorMessage(result.error)).toContain(status === 429 ? 'Too many' : 'not responding')
    expect(loginErrorMessage(result.error)).not.toContain('Private provider diagnostic')
    expect(writes).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers from a thrown network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const { client, writes } = browserClient()
    const result = await client.auth.signInWithPassword(credentials)
    expect(result.data.session).toBeNull()
    expect(loginErrorMessage(result.error)).toContain('not responding')
    expect(writes).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('safe login messages and redirects', () => {
  it.each([
    [{ code: 'invalid_credentials', message: 'Account does not exist' }, 'Invalid email or password.'],
    [{ code: 'email_not_confirmed' }, 'Please confirm your email address using the link in your inbox.'],
    [{ status: 429 }, 'Too many sign-in attempts. Please wait a moment and try again.'],
    [new Error('Private unexpected detail'), 'Unable to sign in. Please try again.'],
  ])('shows actionable errors without private provider details', (error, message) => {
    expect(loginErrorMessage(error)).toBe(message)
  })

  it('keeps a local destination, query, and anchor', () => {
    expect(safeLoginDestination('/dashboard/stock-in?date=2026-09-17#orders'))
      .toBe('/dashboard/stock-in?date=2026-09-17#orders')
  })

  it.each([
    null, '', 'https://external.invalid', '//external.invalid', '/\\external.invalid',
    '/\n/external.invalid', 'javascript:alert(1)', '/path/..//external.invalid', '/auth/login',
  ])('rejects unsafe or looping destination %s', next => {
    expect(safeLoginDestination(next)).toBe('/dashboard')
  })
})
