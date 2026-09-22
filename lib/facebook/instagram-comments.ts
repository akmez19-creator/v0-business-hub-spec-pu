import { fbGet, fbWrite, FbGraphError } from './graph'
import type { FbPage } from './pages'
import type { CommentItem, CommentPageStat, CommentReply } from './comments'
import { getProductMatcher } from '@/lib/products/catalogue'
import { ownedBy, type AdMedia } from './instagram-attribution'

export { ownedBy, type AdMedia }

/**
 * Instagram comments as part of the same inbox channel as Facebook comments.
 *
 * THE POSTS ARE NOT ON THE PROFILE. Measured 22 Sep: both linked accounts
 * (@murmadebymoris, 1,223 followers, and @eliteeos123) report `media_count` 0
 * and return nothing on /media, /stories, /tags or /live_media - the business
 * publishes nothing organically. Every Instagram comment it receives is on an
 * AD post, which is a dark post: it exists only as an ad creative and never
 * appears on the profile grid or its /media edge.
 *
 * So the media ids are collected from the ad creatives
 * (`effective_instagram_media_id`) rather than from the Instagram account.
 * A scan of 110 active ad posts found 13 carrying 19 comments, 0 unreadable -
 * real buying questions ("Price??", "How to order pls", "Logation,price") that
 * nobody had answered because this channel did not exist.
 *
 * Reading uses the Page token of the Page the Instagram account is linked to.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Ad posts change slowly; the comments on them are what we actually re-read. */
const AD_MEDIA_TTL = 10 * 60 * 1000
const COMMENT_TTL = 60 * 1000

export type IgAccount = { igId: string; username: string; page: FbPage }

type RawIgComment = {
  id: string
  text?: string
  username?: string
  timestamp: string
  like_count?: number
  hidden?: boolean
  from?: { id: string; username?: string }
  replies?: { data?: RawIgComment[] }
}

/** The Instagram account linked to each Page, skipping Pages that have none. */
export async function listInstagramAccounts(pages: FbPage[]): Promise<IgAccount[]> {
  const settled = await Promise.allSettled(
    pages.map(async (page) => {
      const json = await fbGet<{ instagram_business_account?: { id: string; username?: string } }>(
        `${GRAPH}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(page.access_token)}`,
        { cacheTtl: AD_MEDIA_TTL },
      )
      const ig = json.instagram_business_account
      return ig?.id ? { igId: ig.id, username: ig.username ?? 'instagram', page } : null
    }),
  )
  return settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
}

/**
 * Instagram media ids that belong to this Page's ads.
 *
 * Walks the ad accounts the token can see and keeps the creatives whose
 * Instagram media is owned by this Page's Instagram account. `ad_account_id`
 * is not enough to attribute a post to a Page, so the owner check is the
 * media's own read: if the Page token can read it, the Page can act on it.
 */
async function adMediaForPage(page: FbPage, adAccountIds: string[]): Promise<Map<string, AdMedia>> {
  const media = new Map<string, AdMedia>()
  // Ad accounts are independent reads, so they go out together rather than one
  // after another. Serially this was the bulk of a 10s refresh.
  const settled = await Promise.allSettled(
    adAccountIds.map((acct) =>
      fbGet<{ data?: { id: string; name?: string; creative?: { effective_instagram_media_id?: string; instagram_permalink_url?: string; instagram_user_id?: string } }[] }>(
        `${GRAPH}/${acct}/ads?fields=id,name,creative{effective_instagram_media_id,instagram_permalink_url,instagram_user_id}` +
          `&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=50&access_token=${encodeURIComponent(page.access_token)}`,
        { cacheTtl: AD_MEDIA_TTL },
      ),
    ),
  )
  for (const r of settled) {
    // One unreadable ad account must not blank the channel.
    if (r.status !== 'fulfilled') continue
    for (const ad of r.value.data ?? []) {
      const id = ad.creative?.effective_instagram_media_id
      if (id && !media.has(id)) {
        media.set(id, {
          adId: ad.id,
          adName: ad.name ?? '',
          permalink: ad.creative?.instagram_permalink_url,
          // Which Instagram account published the ad. Every token sees every
          // ad account here, so this - not the ad account - is what says
          // whose post it is.
          igUserId: ad.creative?.instagram_user_id ?? null,
        })
      }
    }
  }
  return media
}

function toItem(account: IgAccount, mediaId: string, ad: { adId: string; adName: string; permalink?: string }, c: RawIgComment): CommentItem {
  // Instagram identifies the Page's own voice by username, not by Page id.
  const isUs = (name?: string) => Boolean(name) && name === account.username
  const replies: CommentReply[] = (c.replies?.data ?? []).map((r) => ({
    id: r.id,
    message: r.text ?? '',
    createdTime: r.timestamp,
    from: r.username ? { id: r.from?.id ?? r.username, name: r.username } : null,
    fromPage: isUs(r.username),
  }))
  const fromPage = isUs(c.username)
  return {
    id: c.id,
    platform: 'instagram',
    message: c.text ?? '',
    createdTime: c.timestamp,
    // Meta withholds the commenter's id on some ad posts; the username is then
    // all we have, and it is still what an agent needs to recognise them.
    from: c.username ? { id: c.from?.id ?? c.username, name: c.username } : null,
    likeCount: c.like_count ?? 0,
    fromPage,
    needsReply: !fromPage && !replies.some((r) => r.fromPage),
    hidden: c.hidden ?? false,
    replies,
    permalink: ad.permalink,
    postId: mediaId,
    postMessage: ad.adName,
    postPermalink: ad.permalink,
    pageId: account.page.id,
    pageName: `${account.page.name} · Instagram`,
    adId: ad.adId,
    adName: ad.adName,
  }
}

/**
 * The ad accounts whose creatives may carry Instagram posts. Cached, because
 * this is the same short list on every refresh.
 */
export async function listAdAccountIds(): Promise<string[]> {
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return []
  const json = await fbGet<{ data?: { id: string }[] }>(
    `${GRAPH}/me/adaccounts?fields=id&limit=50&access_token=${encodeURIComponent(token)}`,
    { cacheTtl: 30 * 60 * 1000 },
  )
  return (json.data ?? []).map((a) => a.id)
}

/** Every Instagram comment on this account's active ad posts, newest first. */
export async function listInstagramComments(
  account: IgAccount,
  adAccountIds: string[],
  /**
   * The ad-media map, when the caller already built it. The ad scan returns the
   * same creatives no matter which Page token asks, so building it per account
   * fetched identical data once per account - and because the token is part of
   * the request URL, the response cache could not collapse them either.
   */
  shared?: Map<string, AdMedia>,
): Promise<CommentItem[]> {
  const media = shared ?? (await adMediaForPage(account.page, adAccountIds))
  if (!media.size) return []

  const out: CommentItem[] = []
  // Only this account's own posts. Every Page token can read every ad account,
  // so without this each linked account would scan all of them and the same
  // comment would arrive once per account (measured: 32 rows for 16 comments).
  const entries = ownedBy(media, account.igId)
  if (!entries.length) return []
  // Graph's multi-get reads every post's comments in ONE request. Asking each
  // ad post separately meant 50 calls in 7 serial rounds (~6s) to surface 6
  // comments, because almost every ad post has none; batched it is ~1s.
  const size = 50
  for (let i = 0; i < entries.length; i += size) {
    const batch = entries.slice(i, i + size)
    try {
      const json = await fbGet<Record<string, { comments?: { data?: RawIgComment[] } }>>(
        `${GRAPH}/?ids=${batch.map(([id]) => id).join(',')}` +
          `&fields=comments{id,text,username,timestamp,like_count,hidden,from,replies{id,text,username,timestamp,from}}` +
          `&access_token=${encodeURIComponent(account.page.access_token)}`,
        { cacheTtl: COMMENT_TTL },
      )
      for (const [mediaId, ad] of batch) {
        for (const c of json?.[mediaId]?.comments?.data ?? []) out.push(toItem(account, mediaId, ad, c))
      }
    } catch (e) {
      // Multi-get is all-or-nothing: one deleted or unreadable post fails the
      // whole request. Fall back to reading this batch one post at a time so a
      // single bad id cannot hide every comment on the account.
      console.log(`[v0] instagram comments: batch of ${batch.length} failed, retrying singly:`, e instanceof Error ? e.message : e)
      const settled = await Promise.allSettled(
        batch.map(async ([mediaId, ad]) => {
          const json = await fbGet<{ data?: RawIgComment[] }>(
            `${GRAPH}/${mediaId}/comments?fields=id,text,username,timestamp,like_count,hidden,from,` +
              `replies{id,text,username,timestamp,from}&limit=25&access_token=${encodeURIComponent(account.page.access_token)}`,
            { cacheTtl: COMMENT_TTL },
          )
          return (json.data ?? []).map((c) => toItem(account, mediaId, ad, c))
        }),
      )
      for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value)
    }
  }

  // An Instagram ad post has no post copy to fall back on, so the ad name is
  // the only product label available.
  try {
    const matchProduct = await getProductMatcher()
    for (const c of out) {
      const match = matchProduct(c.adName ?? null)
      if (match) {
        c.product = match.productName
        c.productId = match.productId
        c.productCategory = match.category
      }
    }
  } catch (error) {
    console.log('[v0] instagram comments: product match failed', error)
  }

  out.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())
  return out
}

/** Instagram comments across every linked account, merged with per-account stats. */
export async function listAllInstagramComments(
  pages: FbPage[],
  adAccountIds?: string[],
): Promise<{ comments: CommentItem[]; pageStats: CommentPageStat[] }> {
  const accounts = await listInstagramAccounts(pages)
  if (!accounts.length) return { comments: [], pageStats: [] }

  const accountIds = adAccountIds ?? (await listAdAccountIds())
  if (!accountIds.length) return { comments: [], pageStats: [] }

  // Scanned once and shared: the creatives are the same for every account, and
  // each one is attributed by its own instagram_user_id further down.
  const media = await adMediaForPage(accounts[0].page, accountIds)

  const settled = await Promise.allSettled(accounts.map((a) => listInstagramComments(a, accountIds, media)))
  const comments: CommentItem[] = []
  const pageStats: CommentPageStat[] = []

  settled.forEach((r, i) => {
    const account = accounts[i]
    const name = `${account.page.name} · Instagram`
    // Stats are keyed by the OWNING FACEBOOK PAGE, not the Instagram account:
    // the rows carry that page_id and the page filter reads it, so a separate
    // "ig:" key would render a chip that matches nothing.
    const id = account.page.id
    if (r.status === 'fulfilled') {
      comments.push(...r.value)
      pageStats.push({ id, name: account.page.name, needsReply: r.value.filter((c) => c.needsReply).length, total: r.value.length })
    } else {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.log('[v0] instagram comments: account failed', name, message)
      pageStats.push({ id, name: account.page.name, needsReply: null, total: 0, error: message,
        rateLimited: r.reason instanceof FbGraphError && r.reason.isRateLimit })
    }
  })

  comments.sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())
  return { comments, pageStats }
}

/**
 * Instagram accounts that are advertising but are NOT linked to any Facebook
 * Page we hold a token for.
 *
 * Their ad posts collect real comments (measured 22 Sep: "Price??", "Yes I
 * want one of those" on Destockage ads) which we can read but cannot answer -
 * a private reply has to be sent by the Page that owns the Instagram account.
 * Rather than store comments no agent can action, the channel reports them so
 * the account can be linked to its Page in Meta, after which they flow in.
 */
export async function unlinkedInstagramAdAccounts(pages: FbPage[]): Promise<{ igUserId: string; ads: number }[]> {
  const accounts = await listInstagramAccounts(pages)
  if (!pages.length) return []
  const linked = new Set(accounts.map((a) => a.igId))
  const media = await adMediaForPage(pages[0], await listAdAccountIds())
  const counts = new Map<string, number>()
  for (const ad of media.values()) {
    if (!ad.igUserId || linked.has(ad.igUserId)) continue
    counts.set(ad.igUserId, (counts.get(ad.igUserId) ?? 0) + 1)
  }
  return [...counts.entries()].map(([igUserId, ads]) => ({ igUserId, ads })).sort((a, b) => b.ads - a.ads)
}

/** Reply publicly underneath an Instagram comment. */
export async function replyToInstagramComment(page: FbPage, commentId: string, message: string) {
  const body = new URLSearchParams({ message, access_token: page.access_token })
  return fbWrite<{ id: string }>(`${GRAPH}/${commentId}/replies`, { body })
}

/**
 * Send the commenter a private Instagram message, the same "answer the price
 * question privately" move the Facebook channel makes. One per comment.
 *
 * This is the Send API, NOT the /conversations read that currently times out
 * for Made By Moris, so it is unaffected by that outage.
 */
export async function sendInstagramPrivateReply(
  page: FbPage,
  commentId: string,
  text: string,
): Promise<{ ok: true; messageId: string | null }> {
  const url = `${GRAPH}/${page.id}/messages?access_token=${encodeURIComponent(page.access_token)}`
  const body = new URLSearchParams({
    recipient: JSON.stringify({ comment_id: commentId }),
    message: JSON.stringify({ text }),
  })
  // retries 0: a private reply is allowed once per comment, so a retry after an
  // ambiguous failure risks either a duplicate or burning the single allowance.
  const res = await fbWrite<{ message_id?: unknown }>(url, { body, retries: 0 })
  const id = typeof res?.message_id === 'string' && res.message_id.trim() ? res.message_id : null
  return { ok: true, messageId: id }
}

/** Hide or unhide an Instagram comment. */
export async function setInstagramCommentHidden(page: FbPage, commentId: string, hidden: boolean) {
  const body = new URLSearchParams({ hide: String(hidden), access_token: page.access_token })
  return fbWrite<{ success: boolean }>(`${GRAPH}/${commentId}`, { body })
}

/** Delete the Page's own Instagram comment or reply. */
export async function deleteInstagramComment(page: FbPage, commentId: string) {
  return fbWrite<{ success: boolean }>(
    `${GRAPH}/${commentId}?access_token=${encodeURIComponent(page.access_token)}`,
    { method: 'DELETE' },
  )
}
