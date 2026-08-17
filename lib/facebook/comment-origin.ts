import 'server-only'

import { fbGet } from './graph'
import type { FbPage } from './pages'
import { getPostAds, type PostAd } from './post-ads'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Recovers "which product is this Messenger thread about" for threads that
 * began as a comment private-reply.
 *
 * WHY THIS IS NEEDED: Meta strips ad attribution from historical Messenger
 * threads, and the `story_fbid=pfbid...` link inside the notice message is an
 * OPAQUE token that Graph refuses to resolve (error 100). Commenter names are
 * withheld too, so a name join is impossible.
 *
 * WHAT WORKS: Facebook posts the notice into the thread within seconds of the
 * comment being made. Matching those two timestamps on the same Page pins a
 * single post - measured 93% unambiguous, versus 12.9% for guessing from
 * daily ad volume. It is still an INFERENCE, so callers surface it as
 * "likely" rather than as certain attribution.
 */

/** Text Facebook injects when a thread starts from a comment. */
const NOTICE = /commented on your post|responding to a user comment/i

/** A comment within this window of the notice is treated as its trigger. */
const NEAR_MS = 10 * 60 * 1000

export type ThreadOrigin = {
  postId: string
  ad: PostAd | null
  /** Minutes between the comment and the notice - smaller is stronger. */
  gapMinutes: number
}

type FeedPost = {
  id: string
  comments?: { data?: { created_time: string }[] }
}

/** Comment timestamps for a Page, newest posts first. */
async function commentTimeline(page: FbPage, postLimit: number) {
  const url =
    `${GRAPH}/${page.id}/feed?fields=${encodeURIComponent('id,comments.limit(80){created_time}')}` +
    `&limit=${postLimit}&access_token=${encodeURIComponent(page.access_token)}`
  // Cheap to reuse across the whole inbox render.
  const json = await fbGet<{ data?: FeedPost[] }>(url, { cacheTtl: 5 * 60 * 1000 }).catch(() => null)

  const timeline: { t: number; postId: string }[] = []
  for (const post of json?.data ?? []) {
    for (const c of post.comments?.data ?? []) {
      const t = new Date(c.created_time).getTime()
      if (Number.isFinite(t)) timeline.push({ t, postId: post.id })
    }
  }
  return timeline
}

/**
 * Resolve origins for threads whose messages contain a comment notice.
 * `threads` maps a conversation id to its notice timestamp.
 */
export async function resolveCommentOrigins(
  page: FbPage,
  threads: { id: string; noticeTime: string }[],
  postLimit = 40,
): Promise<Map<string, ThreadOrigin>> {
  const out = new Map<string, ThreadOrigin>()
  if (threads.length === 0) return out

  try {
    const timeline = await commentTimeline(page, postLimit)
    if (timeline.length === 0) return out

    const postIds = new Set<string>()
    const staged: { id: string; postId: string; gapMinutes: number }[] = []

    for (const thread of threads) {
      const noticeAt = new Date(thread.noticeTime).getTime()
      if (!Number.isFinite(noticeAt)) continue

      const near = timeline.filter((c) => Math.abs(c.t - noticeAt) <= NEAR_MS)
      const candidates = new Set(near.map((c) => c.postId))
      // Ambiguous (or nothing close) - stay silent rather than guess wrong.
      if (candidates.size !== 1) continue

      const postId = near[0].postId
      const gap = Math.min(...near.map((c) => Math.abs(c.t - noticeAt)))
      postIds.add(postId)
      staged.push({ id: thread.id, postId, gapMinutes: Math.round(gap / 60000) })
    }

    const ads = await getPostAds([...postIds])
    for (const s of staged) {
      out.set(s.id, { postId: s.postId, ad: ads.get(s.postId) ?? null, gapMinutes: s.gapMinutes })
    }
  } catch (error) {
    console.log('[v0] comment-origin: resolve failed', error)
  }
  return out
}

/** Pull the notice timestamp out of a thread's messages, if any. */
export function findNotice(
  messages: { message?: string; created_time?: string }[] | undefined,
): string | null {
  for (const m of messages ?? []) {
    if (m.message && NOTICE.test(m.message) && m.created_time) return m.created_time
  }
  return null
}
