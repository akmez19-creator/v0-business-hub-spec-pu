import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

const AUTH_TIMEOUT_MS = 8_000

type AuthResult = {
  user: User | null
  authTimedOut: boolean
  authUnavailable: boolean
}

/**
 * Refreshes the session cookie and returns BOTH the response and the user.
 *
 * The user is returned deliberately. Callers used to build a second
 * `createServerClient` and call `getUser()` again, which cost an extra auth
 * round-trip on every request and - because that second client had a no-op
 * `setAll` - threw away any rotated refresh token it happened to fetch. This
 * is the one client allowed to touch auth cookies.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })
  const controller = new AbortController()
  let finished = false
  const pendingCookieClears: Array<() => void> = []
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<AuthResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort()
      resolve({ user: null, authTimedOut: true, authUnavailable: true })
    }, AUTH_TIMEOUT_MS)
  })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (input, init) => {
          // One deadline covers refresh + user lookup. SDK retries must not
          // start another network request after middleware has returned.
          controller.signal.throwIfAborted()
          return fetch(input, {
            ...init,
            cache: 'no-store',
            signal: init?.signal
              ? AbortSignal.any([controller.signal, init.signal])
              : controller.signal,
          })
        },
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          if (finished) return
          const applyCookies = () => {
            const previousCookies = supabaseResponse.cookies.getAll()
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            )
            supabaseResponse = NextResponse.next({ request })
            previousCookies.forEach(cookie => supabaseResponse.cookies.set(cookie))
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options),
            )
          }
          // Auth can clear storage on a non-retryable 500 or invalid JSON.
          // Defer deletions until we know this is a rejected session, not an
          // outage. Successful rotations still reach the browser on a 503.
          if (cookiesToSet.every(({ value }) => value === '')) {
            pendingCookieClears.push(applyCookies)
          } else {
            applyCookies()
          }
        },
      },
    },
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getUser() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  // Vercel's routing deadline is 25s. Aborting the fetch alone is not enough:
  // Auth's refresh retry/backoff can outlive it, so also bound the whole call.
  let result: AuthResult
  try {
    result = await Promise.race([
      supabase.auth.getUser().then(({ data, error }): AuthResult => ({
        user: error ? null : data.user,
        authTimedOut: false,
        authUnavailable: Boolean(error && ![400, 401, 403].includes(error.status ?? 0)),
      })).catch((): AuthResult => ({
        user: null,
        authTimedOut: false,
        authUnavailable: true,
      })),
      deadline,
    ])
    if (!result.authUnavailable) pendingCookieClears.forEach(apply => apply())
  } finally {
    finished = true
    clearTimeout(timeout)
    controller.abort()
  }
  if (result.authUnavailable) {
    console.error(`[middleware] Supabase authentication ${result.authTimedOut ? `exceeded ${AUTH_TIMEOUT_MS}ms` : 'is unavailable'}; retaining session cookies`)
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  // The route gating that used to live here now happens in middleware.ts, which
  // owns every redirect so the "where was I" handling exists in one place.
  return { response: supabaseResponse, ...result }
}
