import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getInboxPages } from './messages'
import { listAllComments, type CommentItem, type CommentPageStat } from './comments'
import { isRateLimit } from './rate-limit-response'

/**
 * Cache-backed reads for the comments channel.
 *
 * Comments used to be crawled from Graph on every inbox load - a nested /feed
 * call per Page, six Pages, every time - which was a major contributor to the
 * app-wide rate limit. They are now written by the `feed` webhook and read
 * back from here, with Graph reserved for an explicit refresh.
 */

type Row = {
  comment_id: string
  post_id: string
  parent_id: string | null
  page_id: string
  page_name: string | null
  author_id: string | null
  author_name: string | null
  message: string | null
  created_time: string | null
  from_page: boolean
  replied_at: string | null
  is_hidden: boolean
  like_count: number
  permalink: string | null
  post_message: string | null
  post_permalink: string | null
  ad_id: string | null
  ad_name: string | null
  product: string | null
  product_id: string | null
  campaign_id: string | null
  campaign_name: string | null
}

const COLUMNS =
  'comment_id,post_id,parent_id,page_id,page_name,author_id,author_name,message,created_time,from_page,replied_at,is_hidden,like_count,permalink,post_message,post_permalink,ad_id,ad_name,product,product_id,campaign_id,campaign_name'

/**
 * Rebuild the nested comment/reply structure the UI expects from flat rows.
 *
 * Deleted comments are excluded here rather than removed from the table: the
 * row has to survive so a later backfill cannot resurrect it.
 */
export async function listCachedComments(pageId?: string): Promise<CommentItem[]> {
  const db = createAdminClient()
  let q = db
    .from('page_comments')
    .select(COLUMNS)
    .eq('is_deleted', false)
    .order('created_time', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (pageId && pageId !== 'all') q = q.eq('page_id', pageId)

  const { data, error } = await q
  if (error) {
    console.log('[v0] comment cache: list failed', error.message)
    return []
  }

  const rows = (data ?? []) as unknown as Row[]
  const repliesByParent = new Map<string, Row[]>()
  for (const r of rows) {
    if (!r.parent_id) continue
    const list = repliesByParent.get(r.parent_id) ?? []
    list.push(r)
    repliesByParent.set(r.parent_id, list)
  }

  return rows
    .filter((r) => !r.parent_id)
    .map((r) => {
      const replies = (repliesByParent.get(r.comment_id) ?? []).sort((a, b) =>
        (a.created_time ?? '').localeCompare(b.created_time ?? ''),
      )
      return {
        id: r.comment_id,
        message: r.message ?? '',
        createdTime: r.created_time ?? new Date(0).toISOString(),
        from: r.author_id ? { id: r.author_id, name: r.author_name ?? undefined } : null,
        likeCount: r.like_count,
        fromPage: r.from_page,
        // Answered if we stamped replied_at OR a page reply sits underneath.
        needsReply: !r.from_page && !r.replied_at && !replies.some((x) => x.from_page),
        hidden: r.is_hidden,
        replies: replies.map((x) => ({
          id: x.comment_id,
          message: x.message ?? '',
          createdTime: x.created_time ?? new Date(0).toISOString(),
          from: x.author_id ? { id: x.author_id, name: x.author_name ?? undefined } : null,
          fromPage: x.from_page,
        })),
        permalink: r.permalink ?? undefined,
        postId: r.post_id,
        postMessage: r.post_message ?? '',
        postPermalink: r.post_permalink ?? undefined,
        pageId: r.page_id,
        pageName: r.page_name ?? '',
        adId: r.ad_id,
        adName: r.ad_name,
        product: r.product,
        productId: r.product_id,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
      }
    })
}

export async function cachedCommentStats(): Promise<CommentPageStat[]> {
  const items = await listCachedComments()
  const byPage = new Map<string, CommentPageStat>()
  for (const c of items) {
    const entry = byPage.get(c.pageId) ?? { id: c.pageId, name: c.pageName, needsReply: 0, total: 0 }
    entry.total += 1
    if (c.needsReply) entry.needsReply = (entry.needsReply ?? 0) + 1
    byPage.set(c.pageId, entry)
  }
  return [...byPage.values()]
}

export async function commentCacheIsEmpty(): Promise<boolean> {
  const db = createAdminClient()
  const { count } = await db.from('page_comments').select('*', { count: 'exact', head: true })
  return (count ?? 0) === 0
}

/** Pull every Page's comments from Graph and store them. Explicit refresh only. */
export async function syncComments(): Promise<{ ok: boolean; stored: number; rateLimited: boolean; error?: string }> {
  const db = createAdminClient()
  try {
    const pages = await getInboxPages()
    if (pages.length === 0) return { ok: false, stored: 0, rateLimited: false, error: 'No Page reachable' }

    const { comments } = await listAllComments(pages)
    const rows: Record<string, unknown>[] = []

    for (const c of comments) {
      rows.push(toRow(c, null))
      for (const r of c.replies) {
        rows.push({
          comment_id: r.id,
          post_id: c.postId,
          parent_id: c.id,
          page_id: c.pageId,
          page_name: c.pageName,
          author_id: r.from?.id ?? null,
          author_name: r.from?.name ?? null,
          message: r.message,
          created_time: r.createdTime,
          from_page: r.fromPage,
          // Explicit, not omitted: a batched upsert sends the union of all
          // keys, so a missing one becomes an explicit NULL and violates the
          // NOT NULL constraint instead of using the column default.
          is_hidden: false,
          like_count: 0,
          updated_at: new Date().toISOString(),
        })
      }
    }

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db
        .from('page_comments')
        .upsert(rows.slice(i, i + 200), { onConflict: 'comment_id' })
      if (error) console.log('[v0] comment sync: upsert failed', error.message)
    }

    await db.from('inbox_sync_state').upsert(
      { key: 'comments', last_run_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_error: null },
      { onConflict: 'key' },
    )
    return { ok: true, stored: rows.length, rateLimited: false }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'comment sync failed'
    await db.from('inbox_sync_state').upsert(
      { key: 'comments', last_run_at: new Date().toISOString(), last_error: error },
      { onConflict: 'key' },
    )
    return { ok: false, stored: 0, rateLimited: isRateLimit(e), error }
  }
}

function toRow(c: CommentItem, parentId: string | null): Record<string, unknown> {
  return {
    comment_id: c.id,
    post_id: c.postId,
    parent_id: parentId,
    page_id: c.pageId,
    page_name: c.pageName,
    author_id: c.from?.id ?? null,
    author_name: c.from?.name ?? null,
    message: c.message,
    created_time: c.createdTime,
    from_page: c.fromPage,
    is_hidden: c.hidden,
    like_count: c.likeCount,
    permalink: c.permalink ?? null,
    post_message: c.postMessage,
    post_permalink: c.postPermalink ?? null,
    ad_id: c.adId ?? null,
    ad_name: c.adName ?? null,
    product: c.product ?? null,
    product_id: c.productId ?? null,
    campaign_id: c.campaignId ?? null,
    campaign_name: c.campaignName ?? null,
    updated_at: new Date().toISOString(),
  }
}
