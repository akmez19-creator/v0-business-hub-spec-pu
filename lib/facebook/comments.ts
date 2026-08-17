import { fbGet, fbWrite } from './graph'
import type { FbPage } from './pages'
import { getPostAds } from './post-ads'

/**
 * Page comments as an inbox channel.
 *
 * Comments are fetched through a NESTED feed query - one Graph call per Page
 * instead of one per post - because the naive "list posts, then list comments
 * per post" shape costs 60+ calls across six Pages and burns the hourly quota
 * that publishing and boosting depend on.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

export type CommentAuthor = { id: string; name?: string }

export type CommentReply = {
  id: string
  message: string
  createdTime: string
  from: CommentAuthor | null
  fromPage: boolean
}

export type CommentItem = {
  id: string
  message: string
  createdTime: string
  from: CommentAuthor | null
  likeCount: number
  /** True when the comment was written by the Page itself, not a customer. */
  fromPage: boolean
  /** True when nobody from the Page has replied underneath it yet. */
  needsReply: boolean
  hidden: boolean
  replies: CommentReply[]
  permalink?: string
  postId: string
  postMessage: string
  postPermalink?: string
  pageId: string
  pageName: string
  /**
   * The ad promoting this comment's post, via `effective_object_story_id`.
   * EXACT, not inferred - the comment is physically attached to the post.
   */
  adId?: string | null
  adName?: string | null
  /** Readable product label derived from the ad name. */
  product?: string | null
}

export type CommentPageStat = {
  id: string
  name: string
  /** Comments awaiting a reply, or null when the Page could not be read. */
  needsReply: number | null
  total: number
  error?: string
}

type RawReply = {
  id: string
  message?: string
  created_time: string
  from?: CommentAuthor
}

type RawComment = {
  id: string
  message?: string
  created_time: string
  from?: CommentAuthor
  like_count?: number
  is_hidden?: boolean
  permalink_url?: string
  comments?: { data?: RawReply[] }
}

type RawPost = {
  id: string
  message?: string
  created_time: string
  permalink_url?: string
  comments?: { data?: RawComment[] }
}

// One request per Page: posts, their comments, and each comment's replies.
const FEED_FIELDS =
  'id,message,created_time,permalink_url,' +
  'comments.limit(25).order(reverse_chronological){' +
  'id,message,created_time,from,like_count,is_hidden,permalink_url,' +
  'comments.limit(10){id,message,created_time,from}}'

function toItem(page: FbPage, post: RawPost, c: RawComment): CommentItem {
  const replies: CommentReply[] = (c.comments?.data ?? []).map((r) => ({
    id: r.id,
    message: r.message ?? '',
    createdTime: r.created_time,
    from: r.from ?? null,
    fromPage: r.from?.id === page.id,
  }))

  const fromPage = c.from?.id === page.id
  return {
    id: c.id,
    message: c.message ?? '',
    createdTime: c.created_time,
    from: c.from ?? null,
    likeCount: c.like_count ?? 0,
    fromPage,
    // The Page's own comments never need a reply, and neither does one the
    // Page has already answered underneath.
    needsReply: !fromPage && !replies.some((r) => r.fromPage),
    hidden: c.is_hidden ?? false,
    replies,
    permalink: c.permalink_url,
    postId: post.id,
    postMessage: post.message ?? '',
    postPermalink: post.permalink_url,
    pageId: page.id,
    pageName: page.name,
  }
}

/** Every comment on a Page's recent posts, newest first. */
export async function listPageComments(page: FbPage, postLimit = 15): Promise<CommentItem[]> {
  const url =
    `${GRAPH}/${page.id}/feed?fields=${encodeURIComponent(FEED_FIELDS)}` +
    `&limit=${postLimit}&access_token=${encodeURIComponent(page.access_token)}`

  const json = await fbGet<{ data?: RawPost[] }>(url, { cacheTtl: 60 * 1000 })

  const out: CommentItem[] = []
  for (const post of json.data ?? []) {
    for (const c of post.comments?.data ?? []) out.push(toItem(page, post, c))
  }

  // Attach the promoting ad. Done here (not in listAllComments) so the
  // single-Page view gets it too.
  try {
    const ads = await getPostAds(out.map((c) => c.postId))
    for (const c of out) {
      const ad = ads.get(c.postId)
      if (!ad) continue
      c.adId = ad.adId
      c.adName = ad.adName
      c.product = ad.product
    }
  } catch (error) {
    console.log('[v0] comments: ad lookup failed', error)
  }

  out.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())
  return out
}

/**
 * Comments across every Page, merged and recency-sorted.
 *
 * allSettled, not all: one Page losing its role or hitting a throttle must not
 * blank the whole channel. A failed Page contributes no rows and is named.
 */
export async function listAllComments(
  pages: FbPage[],
  postLimit = 15,
): Promise<{ comments: CommentItem[]; pageStats: CommentPageStat[]; allFailed: boolean }> {
  const settled = await Promise.allSettled(pages.map((p) => listPageComments(p, postLimit)))

  const comments: CommentItem[] = []
  const pageStats: CommentPageStat[] = []
  let failures = 0

  settled.forEach((r, i) => {
    const page = pages[i]
    if (r.status === 'fulfilled') {
      comments.push(...r.value)
      pageStats.push({
        id: page.id,
        name: page.name,
        needsReply: r.value.filter((c) => c.needsReply).length,
        total: r.value.length,
      })
    } else {
      failures++
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.log('[v0] comments: page failed', page.name, message)
      pageStats.push({ id: page.id, name: page.name, needsReply: null, total: 0, error: message })
    }
  })

  comments.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())
  pageStats.sort((a, b) => a.name.localeCompare(b.name))

  return { comments, pageStats, allFailed: pages.length > 0 && failures === pages.length }
}

/** Reply underneath a comment, as the Page that owns the post. */
export async function replyToComment(page: FbPage, commentId: string, message: string) {
  const body = new URLSearchParams({ message, access_token: page.access_token })
  return fbWrite<{ id: string }>(`${GRAPH}/${commentId}/comments`, { body })
}

/** Hide or unhide a comment (moderation, needs pages_manage_engagement). */
export async function setCommentHidden(page: FbPage, commentId: string, hidden: boolean) {
  const body = new URLSearchParams({ is_hidden: String(hidden), access_token: page.access_token })
  return fbWrite<{ success: boolean }>(`${GRAPH}/${commentId}`, { body })
}

/** Permanently delete a comment. */
export async function deleteComment(page: FbPage, commentId: string) {
  return fbWrite<{ success: boolean }>(
    `${GRAPH}/${commentId}?access_token=${encodeURIComponent(page.access_token)}`,
    { method: 'DELETE' },
  )
}

/** Like a customer's comment as the Page. */
export async function likeComment(page: FbPage, commentId: string) {
  const body = new URLSearchParams({ access_token: page.access_token })
  return fbWrite<{ success: boolean }>(`${GRAPH}/${commentId}/likes`, { body })
}
