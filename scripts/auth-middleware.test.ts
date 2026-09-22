import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'
import { updateSession } from '../lib/supabase/proxy'

const cookieName = 'sb-timeout-test-auth-token'
const user = {
  id: '1e53c8b4-d3ea-4d97-a7ef-662096d5caec',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-09-17T00:00:00.000Z',
}

function session(expired = false, accessToken = 'test-only-access-token') {
  return {
    access_token: accessToken,
    refresh_token: 'test-only-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + (expired ? -3600 : 3600),
    token_type: 'bearer',
    user,
  }
}

function request(path: string, options: { expired?: boolean; anonymous?: boolean; bearer?: string } = {}) {
  const headers = new Headers()
  if (!options.anonymous) {
    const cookie = `base64-${Buffer.from(JSON.stringify(session(options.expired))).toString('base64url')}`
    headers.set('cookie', `${cookieName}=${cookie}`)
  }
  if (options.bearer) headers.set('authorization', options.bearer)
  return new NextRequest(new URL(path, 'https://app.example.test'), { headers })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stalledFetch() {
  const signals: AbortSignal[] = []
  const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) throw new Error('Authentication fetch has no cancellation signal')
    signals.push(signal)
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, signals }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://timeout-test.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-only-anon-key')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  // Drain the SDK's bounded backoff using fake time; no request may reach
  // fetch after the request-scoped controller has been aborted.
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('middleware route boundaries', () => {
  it.each([
    '/auth/login', '/auth/sign-up', '/auth/sign-up-success', '/auth/error', '/auth/callback',
    '/shop', '/shop/products', '/api/shop/media', '/api/webhooks/messenger',
    '/api/cron/inbox-reconcile',
    '/api/cron/inbox-autopilot', '/api/cron/inbox-followups',
  ])('%s does not refresh an expired staff cookie', async path => {
    const { fetcher } = stalledFetch()
    const response = await middleware(request(path, { expired: true }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(fetcher).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves a bearer-authenticated extension request to its own handler', async () => {
    const { fetcher } = stalledFetch()
    const response = await middleware(request('/api/extension/orders', { expired: true, bearer: 'Bearer test-only-token' }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['/api/private', '/api/cron/inbox-followups/extra', '/api/extension-other'])('does not exempt %s from the session gate', async path => {
    const { fetcher } = stalledFetch()
    const response = await middleware(request(path, { anonymous: true, bearer: 'Bearer not-a-session' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('remembers the full destination for a genuinely signed-out visitor', async () => {
    const response = await middleware(request('/dashboard/stock-in?date=2026-09-17', { anonymous: true }))
    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
    expect(location.searchParams.get('next')).toBe('/dashboard/stock-in?date=2026-09-17')
    expect(location.searchParams.has('date')).toBe(false)
  })
})

describe('bounded authentication and cookie lifecycle', () => {
  it('validates a healthy session and clears the unused deadline timer', async () => {
    const fetcher = vi.fn(async () => json(user))
    vi.stubGlobal('fetch', fetcher)
    const result = await updateSession(request('/dashboard'))
    expect(result.user?.id).toBe(user.id)
    expect(result.authUnavailable).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('aborts a stalled auth request within 8 seconds (expired: %s)', async expired => {
    const { fetcher, signals } = stalledFetch()
    const incoming = request('/dashboard', { expired })
    const originalCookie = incoming.cookies.get(cookieName)?.value
    const pending = updateSession(incoming)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await pending
    expect(result.authTimedOut).toBe(true)
    expect(result.authUnavailable).toBe(true)
    expect(result.user).toBeNull()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(result.response.cookies.getAll()).toEqual([])
    expect(incoming.cookies.get(cookieName)?.value).toBe(originalCookie)
    await vi.advanceTimersByTimeAsync(32_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.response.cookies.getAll()).toEqual([])
  })

  it.each([500, 503, 504, 429])('treats upstream HTTP %s as unavailable, not signed out', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Temporarily unavailable' }, status)))
    const response = await middleware(request('/api/private'))
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('AUTH_SERVICE_UNAVAILABLE')
    expect(response.headers.get('retry-after')).toBe('15')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('x-middleware-next')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
    expect(response.cookies.getAll()).toEqual([])
  })

  it('does not clear an expired session when the auth gateway returns invalid HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Gateway error</html>', { status: 500 })))
    const incoming = request('/dashboard', { expired: true })
    const originalCookie = incoming.cookies.get(cookieName)?.value
    const result = await updateSession(incoming)
    expect(result.authUnavailable).toBe(true)
    expect(result.response.cookies.getAll()).toEqual([])
    expect(incoming.cookies.get(cookieName)?.value).toBe(originalCookie)
  })

  it('does not clear an expired session when refresh returns a JSON 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Database unavailable' }, 500)))
    const incoming = request('/dashboard', { expired: true })
    const originalCookie = incoming.cookies.get(cookieName)?.value
    const result = await updateSession(incoming)
    expect(result.authUnavailable).toBe(true)
    expect(result.response.cookies.getAll()).toEqual([])
    expect(incoming.cookies.get(cookieName)?.value).toBe(originalCookie)
  })

  it('honors a definitive invalid refresh token and forwards the cookie deletion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Invalid Refresh Token', error_code: 'refresh_token_not_found' }, 400)))
    const response = await middleware(request('/dashboard', { expired: true }))
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')!).pathname).toBe('/auth/login')
    expect(response.cookies.get(cookieName)?.value).toBe('')
    expect(response.cookies.get(cookieName)?.maxAge).toBe(0)
  })

  it('keeps rotated cookies on a root redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/token')
      ? json(session(false, 'rotated-test-only-token'))
      : json(user)))
    const response = await middleware(request('/', { expired: true }))
    expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard')
    const encoded = response.cookies.get(cookieName)?.value
    expect(encoded).toBeTruthy()
    const stored = JSON.parse(Buffer.from(encoded!.slice('base64-'.length), 'base64url').toString())
    expect(stored.access_token).toBe('rotated-test-only-token')
  })

  it('preserves a successful refresh even when the subsequent user lookup stalls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/token')) return json(session(false, 'rotated-before-outage'))
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
      })
    }))
    const pending = middleware(request('/dashboard?tab=stock', { expired: true }))
    await vi.advanceTimersByTimeAsync(8_000)
    const response = await pending
    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBeNull()
    const body = await response.text()
    expect(body).toContain('Sign-in service temporarily unavailable')
    expect(body).toContain('href=""')
    const encoded = response.cookies.get(cookieName)?.value
    expect(encoded).toBeTruthy()
    expect(JSON.parse(Buffer.from(encoded!.slice(7), 'base64url').toString()).access_token).toBe('rotated-before-outage')
  })

  it('ignores a late refresh response after the deadline', async () => {
    let finishFetch!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finishFetch = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const incoming = request('/dashboard', { expired: true })
    const originalCookie = incoming.cookies.get(cookieName)?.value
    const pending = updateSession(incoming)
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await pending
    finishFetch(json(session(false, 'too-late-token')))
    await vi.advanceTimersByTimeAsync(0)
    expect(result.authTimedOut).toBe(true)
    expect(result.response.cookies.getAll()).toEqual([])
    expect(incoming.cookies.get(cookieName)?.value).toBe(originalCookie)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
