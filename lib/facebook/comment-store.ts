import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getPostAds } from './post-ads'

/**
 * Persistence for Page comments, fed by the `feed` webhook.
 *
 * Comments were previously crawled from Graph on every inbox load - one nested
 * /feed call per page, six pages, every time - which was a major contributor to
 * the app-wide rate limit. They now arrive as they happen and are read back
 * from Postgres.
 */

export type FeedComment = {
  commentId: string
  postId: string
  parentId?: string | null
  pageId: string
  authorId?: string | null
  authorName?: string | null
  message?: string | null
  createdTime?: string | null
  raw?: unknown
}

/**
 * Insert or update a comment.
 *
 * When the PAGE is the author this is our own reply, so the comment it answers
 * is stamped `replied_at`. That is what stops a question you already answered
 * - from here, Business Suite, or the Facebook app - from sitting in the
 * "needs reply" count forever.
 */
export async function upsertComment(c: FeedComment): Promise<void> {
  if (!c.commentId || !c.pageId) return
  const db = createAdminClient()

  const fromPage = Boolean(c.authorId && c.authorId === c.pageId)
  const attribution = await attributionForPost(c.postId)

  const { error } = await db.from('page_comments').upsert(
    {
      comment_id: c.commentId,
      post_id: c.postId,
      parent_id: c.parentId ?? null,
      page_id: c.pageId,
      author_id: c.authorId ?? null,
      // Null for public commenters: Meta withholds `from` without Page Public
      // Content Access. Expected - the UI renders "Facebook user".
      author_name: c.authorName ?? null,
      message: c.message ?? null,
      created_time: c.createdTime ?? new Date().toISOString(),
      from_page: fromPage,
      raw: c.raw ?? null,
      updated_at: new Date().toISOString(),
      ...attribution,
    },
    { onConflict: 'comment_id' },
  )
  if (error) {
    console.log('[v0] comment store: upsert failed', error.message)
    return
  }

  if (fromPage && c.parentId) {
    await db
      .from('page_comments')
      .update({ replied_at: c.createdTime ?? new Date().toISOString() })
      .eq('comment_id', c.parentId)
  }
}

/** Soft delete. Hard-deleting would let the next backfill resurrect the row. */
export async function markCommentDeleted(commentId: string): Promise<void> {
  const db = createAdminClient()
  await db
    .from('page_comments')
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('comment_id', commentId)
}

/** Named to stay distinct from `comments.setCommentHidden`, which calls Graph. */
export async function markCommentHidden(commentId: string, hidden: boolean): Promise<void> {
  const db = createAdminClient()
  await db
    .from('page_comments')
    .update({ is_hidden: hidden, updated_at: new Date().toISOString() })
    .eq('comment_id', commentId)
}

/** Reuse the post->ad cache so a comment inherits its post's product. */
async function attributionForPost(postId: string) {
  try {
    const ads = await getPostAds([postId])
    const ad = ads.get(postId)
    if (!ad) return {}
    return {
      ad_id: ad.adId ?? null,
      ad_name: ad.adName ?? null,
      product: ad.product ?? null,
      product_id: ad.productId ?? null,
      campaign_id: ad.campaignId ?? null,
      campaign_name: ad.campaignName ?? null,
    }
  } catch {
    return {}
  }
}
