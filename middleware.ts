import { updateSession } from '@/lib/supabase/proxy'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Sends an unauthenticated visitor to the login form, remembering exactly
 * where they were so they can be put back there afterwards.
 *
 * Two bugs this fixes, both reported as "I have to log in again and it dumps
 * me at the top":
 *  - the destination was thrown away entirely, so every recovery landed on
 *    /dashboard - a storekeeper mid-count lost his place and his scroll;
 *  - `nextUrl.clone()` keeps the SEARCH PARAMS, so a redirect from
 *    `/stock-in?date=2026-08-24` produced `/auth/login?date=2026-08-24`,
 *    leaking a stale filter onto the login screen.
 */
function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone()
  const from = `${request.nextUrl.pathname}${request.nextUrl.search}`
  url.pathname = '/auth/login'
  url.search = '' // drop the previous page's params before adding our own
  // Only ever a path on this site, never an absolute URL - an open `next=`
  // that accepts a full URL is a redirect vector.
  if (from !== '/' && !from.startsWith('//')) url.searchParams.set('next', from)
  return NextResponse.redirect(url)
}

function withSessionCookies(response: NextResponse, sessionResponse: NextResponse) {
  sessionResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie))
  return response
}

function authUnavailableResponse(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Retry-After': '15' }
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({
      error: 'Sign-in verification is temporarily unavailable. Please try again shortly.',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    }, { status: 503, headers })
  }
  return new NextResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Temporarily unavailable | Business Hub</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a1a;color:#fafafa;font:16px/1.6 system-ui,sans-serif}main{max-width:30rem;padding:2rem}h1{font-size:1.5rem;line-height:1.3}p{color:#d4d4d8}a{display:inline-block;margin-top:1rem;padding:.65rem 1.1rem;border-radius:.5rem;background:#fb923c;color:#171717;font-weight:600;text-decoration:none}a:focus-visible{outline:3px solid #fafafa;outline-offset:4px}</style>
</head><body><main><h1>Sign-in service temporarily unavailable</h1>
<p>We could not verify your session. Please try again in a moment. You do not need to sign out.</p>
<a href="">Reload page</a></main></body></html>`, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // These pages render without a session. In particular, an expired cookie
  // must not make the login/recovery screen wait on the service it recovers.
  // The callback exchanges and validates its own code in its route handler.
  const publicRoutes = ['/auth/login', '/auth/sign-up', '/auth/sign-up-success', '/auth/error', '/auth/callback']
  if (publicRoutes.includes(pathname)) return NextResponse.next()

  // ---- Storefront: fully anonymous, checked BEFORE updateSession ----
  // Customers browsing /shop never sign in, and updateSession() makes a
  // getUser() network call on every request. Running it for the storefront
  // would add that latency to every product page and every media request for
  // no benefit, since nothing under /shop reads `user`. The media proxy and
  // order endpoint under /api/shop/ are covered by the same skip.
  // NOTE: this is a pass-through, NOT an auth decision - /shop has no private
  // data. Anything needing a session must stay out of this branch.
  if (pathname === '/shop' || pathname.startsWith('/shop/') || pathname.startsWith('/api/shop/')) {
    return NextResponse.next()
  }

  // These scheduled routes check CRON_SECRET in their own handlers. Vercel
  // has no user session; do not make scheduled work depend on Supabase sign-in.
  // Keep the match exact so other API routes retain their session gate.
  if (pathname === '/api/cron/inbox-reconcile' || pathname === '/api/cron/inbox-autopilot' || pathname === '/api/cron/inbox-followups') {
    return NextResponse.next()
  }

  // Provider signatures, not staff cookies, authenticate inbound webhooks.
  if (pathname.startsWith('/api/webhooks/')) return NextResponse.next()

  const tokenAuthPrefixes = ['/api/extension', '/api/clients/rating', '/api/clients/last-delivered']
  const isTokenAuthRoute = tokenAuthPrefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))
  if (isTokenAuthRoute && /^Bearer\s+\S+/i.test(request.headers.get('authorization') ?? '')) {
    return NextResponse.next()
  }

  // ONE client, ONE getUser. This call is what refreshes the auth cookie, and
  // it is the only place allowed to write it.
  const { response, user, authUnavailable } = await updateSession(request)

  // An unavailable auth service is not an invalid session. Return a retryable
  // response without clearing cookies, redirecting to login, or passing an
  // unverified request to a protected handler that may mutate data.
  if (authUnavailable) {
    return withSessionCookies(authUnavailableResponse(request), response)
  }

  // ---- API auth gate ----
  // Every /api route requires a signed-in session, EXCEPT routes that
  // validate their own Bearer token inside the handler (Chrome extension +
  // shared dashboard/extension endpoints). A Bearer header only grants
  // passage on those prefixes - it is still verified by the route itself.
  // Unauthenticated API calls get a 401 JSON response, never a redirect.
  if (pathname.startsWith('/api') && !user) {
    // Genuinely public, kept separate from the Bearer-token list below so the
    // distinction stays visible: the storefront is browsed by customers who
    // never sign in, so these must answer anonymously.
    //   /api/shop/media - read-only media proxy, locked to an allowlist of
    //                     supplier CDNs (see the route).
    //   /api/shop/order - accepts a new order. Server-side priced: it trusts
    //                     only product ids + quantities from the browser and
    //                     recomputes every amount from the database.
    const publicApiPrefixes = ['/api/shop/']
    if (publicApiPrefixes.some((p) => pathname.startsWith(p))) {
      return response
    }

    if (!isTokenAuthRoute) {
      return withSessionCookies(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), response)
    }
  }

  // Redirect to login if not authenticated and trying to access protected routes
  if (!user && pathname.startsWith('/dashboard')) {
    return withSessionCookies(redirectToLogin(request), response)
  }

  // Redirect root path based on auth status
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = user ? '/dashboard' : '/auth/login'
    return withSessionCookies(NextResponse.redirect(url), response)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
