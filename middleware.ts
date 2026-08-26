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
  // ONE client, ONE getUser. This call is what refreshes the auth cookie, and
  // it is the only place allowed to write it.
  const { response, user } = await updateSession(request)

  const { pathname } = request.nextUrl

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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
