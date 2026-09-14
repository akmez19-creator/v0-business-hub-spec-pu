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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ---- Storefront: fully anonymous, checked BEFORE updateSession ----
  // Customers browsing /shop never sign in, and updateSession() makes a
  // getUser() network call on every request. Running it for the storefront
  // would add that latency to every product page and every media request for
  // no benefit, since nothing under /shop reads `user`. The media proxy and
  // order endpoint under /api/shop/ are covered by the same skip.
  // NOTE: this is a pass-through, NOT an auth decision - /shop has no private
  // data. Anything needing a session must stay out of this branch.
  if (pathname.startsWith('/shop') || pathname.startsWith('/api/shop/')) {
    return NextResponse.next()
  }

  // These scheduled routes check CRON_SECRET in their own handlers. Vercel
  // has no user session; do not make scheduled work depend on Supabase sign-in.
  // Keep the match exact so other API routes retain their session gate.
  if (pathname === '/api/cron/inbox-reconcile' || pathname === '/api/cron/whatsapp-green-reconcile' || pathname === '/api/cron/inbox-autopilot') {
    return NextResponse.next()
  }

  // ONE client, ONE getUser. This call is what refreshes the auth cookie, and
  // it is the only place allowed to write it.
  const { response, user } = await updateSession(request)

  // Public routes that don't need auth
  const publicRoutes = ['/auth/login', '/auth/sign-up', '/auth/sign-up-success', '/auth/error', '/auth/callback']
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return response
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

    const tokenAuthPrefixes = [
      '/api/extension',
      '/api/clients/rating',
      '/api/clients/last-delivered',
      // Inbound provider webhooks. Meta has no Supabase session, so a session
      // gate here silently 401s the handshake and no message can ever arrive.
      // These routes are NOT open: GET checks hub.verify_token and POST
      // verifies Meta's SHA-256 body signature before storing anything.
      '/api/webhooks/',
    ]
    const isTokenAuthRoute = tokenAuthPrefixes.some((p) => pathname.startsWith(p))
    if (!isTokenAuthRoute) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Redirect to login if not authenticated and trying to access protected routes
  if (!user && pathname.startsWith('/dashboard')) {
    return redirectToLogin(request)
  }

  // Redirect root path based on auth status
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = user ? '/dashboard' : '/auth/login'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
