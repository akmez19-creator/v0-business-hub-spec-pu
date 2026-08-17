import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPages } from '@/lib/facebook/messages'
import { isRateLimit, rateLimitResponse } from '@/lib/facebook/rate-limit-response'
import { cachedPageStats, cacheIsEmpty, listCachedConversations } from '@/lib/messenger/cache'
import { syncConversations } from '@/lib/messenger/sync'

/**
 * Messenger conversations, served from Postgres.
 *
 * Reads no longer touch the Graph API. Every load used to re-walk
 * /conversations across all six Pages, which exhausted Meta's app-wide hourly
 * cap and surfaced as "(#4) Application request limit reached" - misread as a
 * dead token. Threads now arrive by webhook and are read back from the cache,
 * so browsing is free.
 *
 * Graph is contacted only when explicitly asked (`?refresh=1`) or when the
 * cache has never been populated.
 *
 * Defaults to every Page merged into one recency-sorted list, because five of
 * the six Pages carry live traffic and a single-Page default silently hides
 * the rest. `?pageId=<id>` narrows to one Page.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const params = new URL(request.url).searchParams
    const requested = params.get('pageId') ?? 'all'
    const wantsRefresh = params.get('refresh') === '1'

    const empty = await cacheIsEmpty()
    let rateLimited = false
    let syncError: string | undefined

    if (wantsRefresh || empty) {
      const result = await syncConversations()
      rateLimited = result.rateLimited
      syncError = result.error
      // A throttle with nothing cached is the only case with nothing to show.
      if (!result.ok && result.rateLimited && (await cacheIsEmpty())) {
        return rateLimitResponse(new Error(result.error ?? 'rate limited'))
      }
    }

    const conversations = await listCachedConversations({
      pageId: requested === 'all' ? undefined : requested,
      limit: 200,
    })

    // Page list for the rail. Cheap and cached upstream, but the cache is a
    // sufficient fallback if Graph is throttled - a stale rail beats an error.
    let pageRefs: { id: string; name: string }[] = []
    try {
      pageRefs = (await getInboxPages()).map((p) => ({ id: p.id, name: p.name }))
    } catch {
      pageRefs = (await cachedPageStats()).map((p) => ({ id: p.id, name: p.name }))
    }
    if (pageRefs.length === 0) pageRefs = (await cachedPageStats()).map((p) => ({ id: p.id, name: p.name }))

    const stats = await cachedPageStats()
    const pageStats = requested === 'all' ? stats : stats.filter((p) => p.id === requested)

    return NextResponse.json({
      success: true,
      scope: requested,
      source: 'cache',
      rateLimited,
      syncError: rateLimited ? syncError : undefined,
      pages: pageRefs,
      pageStats,
      conversations,
    })
  } catch (e) {
    // Throttling is transient and must never be reported as a token problem.
    if (isRateLimit(e)) return rateLimitResponse(e)
    const message = e instanceof Error ? e.message : 'Failed to load conversations'
    console.log('[v0] inbox list failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
