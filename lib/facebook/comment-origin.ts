import 'server-only'

import { fbGet } from './graph'
import type { FbPage } from './pages'
import { getProductMatcher } from '@/lib/products/catalogue'
import { getPostAds, productFromAdName, type PostAd } from './post-ads'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Recovers "which product is this Messenger thread about" for threads that
 * began as a comment private-reply.
 *
 * THE KEY IS `comment_id`, NOT THE POST LINK. The notice message carries a
 * `story_fbid=pfbid...` token that Graph flatly refuses to resolve (error
 * 100) and the page is behind a login wall, so scraping it is a dead end.
 * But the SAME url ends in `comment_id=<numeric>`, and that id IS queryable:
 * GET /{comment_id}?fields=permalink_url returns a permalink containing the
 * real numeric post id. Measured: 97% of notices carry a comment_id and 88%
 * of those resolve to a post - and it is EXACT, not a timestamp guess.
 *
 * From the post we get the product two ways, in order of confidence:
 *   1. the post is an ad creative  -> the ad's own product name
 *   2. the post is organic         -> derive it from the post copy
 */

/** Text Facebook injects when a thread starts from a comment. */
const NOTICE = /commented on your post|responding to a user comment|facebook\.com\/reel/i

export type ThreadOrigin = {
  postId: string
  ad: PostAd | null
  /** Product label, from the ad when possible, else from the post copy. */
  product: string | null
  /** Catalogue id, resolved from whichever label we ended up with. */
  productId: string | null
  productCategory: string | null
}

/** Extract the numeric post id from a comment permalink. */
function postIdFromPermalink(permalink: string): string | null {
  const patterns = [
    /\/reel\/(\d+)/,
    /\/posts\/(\d+)/,
    /\/videos\/(\d+)/,
    /[?&]story_fbid=(\d+)/,
    /\/photos\/[^/]+\/(\d+)/,
  ]
  for (const re of patterns) {
    const m = permalink.match(re)
    if (m) return m[1]
  }
  return null
}

/**
 * Resolve origins for threads that contain a comment notice.
 * `threads` maps a conversation id to the notice's message text.
 */
export async function resolveCommentOrigins(
  page: FbPage,
  threads: { id: string; notice: string }[],
): Promise<Map<string, ThreadOrigin>> {
  const out = new Map<string, ThreadOrigin>()
  if (threads.length === 0) return out
  const token = encodeURIComponent(page.access_token)

  try {
    // 1. notice text -> comment id -> post id (one Graph call per thread,
    //    cached hard because a comment's post never changes).
    const staged: { id: string; postId: string }[] = []
    const resolvedPostIds = new Set<string>()

    await Promise.all(
      threads.map(async (thread) => {
        const commentId = thread.notice.match(/comment_id=(\d+)/)?.[1]
        if (!commentId) return

        const comment = await fbGet<{ permalink_url?: string }>(
          `${GRAPH}/${commentId}?fields=permalink_url&access_token=${token}`,
          { cacheTtl: 24 * 60 * 60 * 1000 },
        ).catch(() => null)
        if (!comment?.permalink_url) return

        const postId = postIdFromPermalink(comment.permalink_url)
        if (!postId) return
        // Graph wants the qualified {page}_{post} form for reads.
        const qualified = postId.includes('_') ? postId : `${page.id}_${postId}`
        staged.push({ id: thread.id, postId: qualified })
        resolvedPostIds.add(qualified)
      }),
    )
    if (staged.length === 0) return out

    // 2. Prefer the ad's product name - the post may be a boosted creative.
    const ads = await getPostAds([...resolvedPostIds])

    // 3. Organic posts have no ad, so fall back to their own copy.
    const needsCopy = [...resolvedPostIds].filter((id) => !ads.get(id)?.product)
    const copyByPost = new Map<string, string>()
    await Promise.all(
      needsCopy.map(async (postId) => {
        const post = await fbGet<{ message?: string }>(
          `${GRAPH}/${postId}?fields=message&access_token=${token}`,
          { cacheTtl: 24 * 60 * 60 * 1000 },
        ).catch(() => null)
        const label = productFromAdName(post?.message)
        if (label) copyByPost.set(postId, label)
      }),
    )

    // Organic posts never went through the ads cache, so their label has not
    // been matched against the catalogue yet.
    const matchProduct = await getProductMatcher()

    for (const s of staged) {
      const ad = ads.get(s.postId) ?? null
      const product = ad?.product ?? copyByPost.get(s.postId) ?? null
      const match = ad?.productId ? null : matchProduct(product)
      out.set(s.id, {
        postId: s.postId,
        ad,
        product,
        productId: ad?.productId ?? match?.productId ?? null,
        productCategory: match?.category ?? null,
      })
    }
  } catch (error) {
    console.log('[v0] comment-origin: resolve failed', error)
  }
  return out
}

/** Pull the notice MESSAGE TEXT out of a thread, if any. */
export function findNotice(
  messages: { message?: string; created_time?: string }[] | undefined,
): string | null {
  // Graph returns messages newest-first, so the first hit is the customer's
  // most recent interest - which is what the inbox should surface.
  for (const m of messages ?? []) {
    if (m.message && NOTICE.test(m.message) && /comment_id=\d+/.test(m.message)) return m.message
  }
  return null
}
