export const SIGN_IN_TIMEOUT_MS = 12_000

export async function fetchWithSignInTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!url.pathname.endsWith('/auth/v1/token') || url.searchParams.get('grant_type') !== 'password') {
    return fetch(input, init)
  }

  const controller = new AbortController()
  const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const signal = upstreamSignal
    ? AbortSignal.any([upstreamSignal, controller.signal])
    : controller.signal
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('The sign-in request timed out.', 'TimeoutError')
      controller.abort(error)
      reject(error)
    }, SIGN_IN_TIMEOUT_MS)
  })

  try {
    return await Promise.race([
      (async () => {
        signal.throwIfAborted()
        const response = await fetch(input, { ...init, signal })
        // Keep the deadline through the response body, before the SDK can save
        // a session. Racing signInWithPassword itself permits late cookie writes.
        const body = await response.arrayBuffer()
        signal.throwIfAborted()
        return new Response(body.byteLength ? body : null, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      })(),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function loginErrorMessage(error: unknown): string {
  const { code, status, name } = (error ?? {}) as { code?: string; status?: number; name?: string }

  if (code === 'email_not_confirmed') {
    return 'Please confirm your email address using the link in your inbox.'
  }
  if (code === 'over_request_rate_limit' || status === 429) {
    return 'Too many sign-in attempts. Please wait a moment and try again.'
  }
  if (code === 'invalid_credentials') {
    return 'Invalid email or password.'
  }
  if (
    (status !== undefined && status >= 500) ||
    name === 'AuthRetryableFetchError' || name === 'TimeoutError' || name === 'AbortError'
  ) {
    return 'The sign-in service is not responding. Please try again in a moment.'
  }
  return 'Unable to sign in. Please try again.'
}

export function safeLoginDestination(next: string | null): string {
  const fallback = '/dashboard'
  if (!next?.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(next)) {
    return fallback
  }

  try {
    const destination = new URL(next, 'https://same-site.invalid')
    if (
      destination.origin !== 'https://same-site.invalid' ||
      destination.pathname.startsWith('//') ||
      destination.pathname.startsWith('/auth/')
    ) return fallback
    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return fallback
  }
}
