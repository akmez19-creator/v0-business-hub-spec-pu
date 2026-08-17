import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPage, getInboxPages } from '@/lib/facebook/messages'
import { getCapabilities } from '@/lib/facebook/capabilities'
import { isRateLimit, rateLimitResponse } from '@/lib/facebook/rate-limit-response'
import { deleteComment, likeComment, replyToComment, setCommentHidden } from '@/lib/facebook/comments'
import {
  cachedCommentStats,
  commentCacheIsEmpty,
  listCachedComments,
  syncComments,
} from '@/lib/facebook/comment-cache'
import { markCommentDeleted, markCommentHidden } from '@/lib/facebook/comment-store'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Page comments as an inbox channel.
 *
 * Mirrors the Messenger route: merged across every Page by default, narrowed
 * with `?pageId=<id>`. The token is checked for pages_read_user_content BEFORE
 * calling Graph, so a missing scope produces one precise setup panel instead
 * of six identical #200 errors.
 */

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function GET(request: Request) {
  try {
    if (!(await requireUser())) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'no-token',
        error: 'FACEBOOK_ACCESS_TOKEN is not set.',
      })
    }

    const params = new URL(request.url).searchParams
    const requested = params.get('pageId') ?? 'all'
    const wantsRefresh = params.get('refresh') === '1'

    // Capabilities are a LIVE Graph call, so it must not gate cached reads.
    // While throttled it reports no scopes, which is indistinguishable from a
    // genuinely missing permission - blocking on it would hide 1000+ comments
    // we already hold locally and wrongly advise regenerating the token.
    const hasCache = !(await commentCacheIsEmpty())
    let channel: Awaited<ReturnType<typeof getCapabilities>>['channels']['comments'] | undefined
    try {
      channel = (await getCapabilities(token)).channels.comments
    } catch {
      channel = undefined // throttled or unreachable; cache still serves
    }

    // Only refuse when the permission is genuinely missing AND we have nothing
    // cached to show.
    if (channel && !channel.available && !hasCache) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'scope',
        missing: channel.missing,
        capability: channel,
        error: channel.reason,
      })
    }

    // Graph is touched only on an explicit refresh, or to fill an empty cache.
    let rateLimited = false
    let syncError: string | undefined
    if (wantsRefresh || !hasCache) {
      const result = await syncComments()
      rateLimited = result.rateLimited
      syncError = result.error
      // Only surface the throttle when there is genuinely nothing to show.
      if (!result.ok && result.rateLimited && !hasCache) {
        return rateLimitResponse(new Error(result.error ?? 'rate limited'))
      }
    }

    const comments = await listCachedComments(requested === 'all' ? undefined : requested)
    const stats = await cachedCommentStats()

    // Page names come from the cache. Asking Graph here would put a live call
    // back on every load, which is the thing this cache exists to avoid.
    let pageRefs = stats.map((p) => ({ id: p.id, name: p.name }))
    if (pageRefs.length === 0) {
      try {
        pageRefs = (await getInboxPages()).map((p) => ({ id: p.id, name: p.name }))
      } catch {
        pageRefs = []
      }
    }

    return NextResponse.json({
      success: true,
      scope: requested,
      source: 'cache',
      rateLimited,
      syncError: rateLimited ? syncError : undefined,
      pages: pageRefs,
      pageStats: requested === 'all' ? stats : stats.filter((p) => p.id === requested),
      capability: channel,
      comments,
    })
  } catch (e) {
    // Throttling is transient and must never be reported as a token problem.
    if (isRateLimit(e)) return rateLimitResponse(e)
    const message = e instanceof Error ? e.message : 'Failed to load comments'
    console.log('[v0] comments list failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

type Action = 'reply' | 'hide' | 'unhide' | 'delete' | 'like'

export async function POST(request: Request) {
  try {
    if (!(await requireUser())) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = (await request.json()) as {
      action?: Action
      commentId?: string
      pageId?: string
      message?: string
    }
    const { action, commentId, pageId } = body

    if (!action || !commentId || !pageId) {
      return NextResponse.json(
        { success: false, error: 'action, commentId and pageId are required' },
        { status: 400 },
      )
    }

    // The Page comes from the comment, never from whatever is on screen - in
    // the merged view they are usually different Pages.
    const page = await getInboxPage(pageId)
    if (!page) return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 })

    switch (action) {
      // Each action writes through to the cache as well as Graph. The `feed`
      // webhook will report the same change moments later and simply overwrite
      // with identical data, but doing it here means the UI updates at once
      // instead of appearing to do nothing until the webhook lands.
      case 'reply': {
        const message = (body.message ?? '').trim()
        if (!message) return NextResponse.json({ success: false, error: 'Message is empty' }, { status: 400 })
        const res = await replyToComment(page, commentId, message)
        await createAdminClient()
          .from('page_comments')
          .update({ replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('comment_id', commentId)
        return NextResponse.json({ success: true, id: res.id })
      }
      case 'hide':
        await setCommentHidden(page, commentId, true)
        await markCommentHidden(commentId, true)
        return NextResponse.json({ success: true })
      case 'unhide':
        await setCommentHidden(page, commentId, false)
        await markCommentHidden(commentId, false)
        return NextResponse.json({ success: true })
      case 'delete':
        await deleteComment(page, commentId)
        await markCommentDeleted(commentId)
        return NextResponse.json({ success: true })
      case 'like':
        await likeComment(page, commentId)
        return NextResponse.json({ success: true })
      default:
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Comment action failed'
    console.log('[v0] comment action failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
