import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInboxPage, getInboxPages } from '@/lib/facebook/messages'
import { getCapabilities } from '@/lib/facebook/capabilities'
import {
  deleteComment,
  likeComment,
  listAllComments,
  listPageComments,
  replyToComment,
  setCommentHidden,
} from '@/lib/facebook/comments'

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

    const caps = await getCapabilities(token)
    const channel = caps.channels.comments
    if (!channel.available) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'scope',
        missing: channel.missing,
        capability: channel,
        error: channel.reason,
      })
    }

    const requested = new URL(request.url).searchParams.get('pageId') ?? 'all'
    const pages = await getInboxPages()
    const pageRefs = pages.map((p) => ({ id: p.id, name: p.name }))

    if (pages.length === 0) {
      return NextResponse.json({
        success: false,
        needsPermission: true,
        reason: 'no-page',
        error: 'No Facebook Page is reachable with the configured access token.',
      })
    }

    if (requested === 'all') {
      const { comments, pageStats, allFailed } = await listAllComments(pages)
      if (allFailed) {
        return NextResponse.json({
          success: false,
          needsPermission: true,
          reason: 'scope',
          pages: pageRefs,
          capability: channel,
          error: pageStats.find((p) => p.error)?.error ?? 'Every Page failed to load.',
        })
      }
      return NextResponse.json({
        success: true,
        scope: 'all',
        pages: pageRefs,
        pageStats,
        capability: channel,
        comments,
      })
    }

    const page = await getInboxPage(requested)
    if (!page) {
      return NextResponse.json({ success: false, needsPermission: true, reason: 'no-page', error: 'Page not found.' })
    }

    const comments = await listPageComments(page)
    return NextResponse.json({
      success: true,
      scope: page.id,
      page: { id: page.id, name: page.name },
      pages: pageRefs,
      pageStats: [
        {
          id: page.id,
          name: page.name,
          needsReply: comments.filter((c) => c.needsReply).length,
          total: comments.length,
        },
      ],
      capability: channel,
      comments,
    })
  } catch (e) {
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
      case 'reply': {
        const message = (body.message ?? '').trim()
        if (!message) return NextResponse.json({ success: false, error: 'Message is empty' }, { status: 400 })
        const res = await replyToComment(page, commentId, message)
        return NextResponse.json({ success: true, id: res.id })
      }
      case 'hide':
        await setCommentHidden(page, commentId, true)
        return NextResponse.json({ success: true })
      case 'unhide':
        await setCommentHidden(page, commentId, false)
        return NextResponse.json({ success: true })
      case 'delete':
        await deleteComment(page, commentId)
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
