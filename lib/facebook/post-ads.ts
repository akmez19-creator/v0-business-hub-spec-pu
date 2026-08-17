import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { fbGet } from './graph'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Maps a Page post to the ad that promotes it.
 *
 * Every ad exposes `effective_object_story_id` (verified: 100% of ads have
 * one), which is exactly the `{page_id}_{post_id}` of the post it boosts. So
 * "which product is this person asking about" is answerable EXACTLY for
 * anyone who came from a comment - no guessing, unlike time-based inference.
 */
export type PostAd = {
  postId: string
  adId: string | null
  adName: string | null
  /** Human-readable product, derived from the ad name. */
  product: string | null
}

/** Placeholder ad names that carry no product meaning. */
const JUNK_NAMES = /^(new engagement ad|dup|copy|untitled|test)\b/i

/**
 * Turns an ad name into a product label. Three shapes exist in this account:
 *   1. "DBM - Car Wash Kit - 1"       -> the house convention (majority)
 *   2. 'Post: "Easy to use mini..."'  -> Meta's auto name, i.e. the post copy
 *   3. "New Engagement Ad"            -> junk, deliberately returns null
 */
export function productFromAdName(adName: string | null | undefined): string | null {
  if (!adName) return null
  const raw = adName.trim()
  if (!raw || JUNK_NAMES.test(raw)) return null

  const isAutoName = /^post:\s*/i.test(raw)

  // Shape 1: BRAND - Product [- VARIANT] - 3
  if (!isAutoName && raw.includes(' - ')) {
    const parts = raw
      .split(/\s+-\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length >= 2) {
      // Drop a short leading brand code (DBM/MBM) and any trailing plain
      // number, which is just the creative iteration.
      if (parts.length > 2 && parts[0].length <= 12 && !/\s/.test(parts[0])) parts.shift()
      while (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) parts.pop()
      const joined = parts.join(' - ').trim()
      if (joined) return truncate(joined)
    }
  }

  // Shape 2: strip the wrapper, quotes and marketing noise, keep first clause.
  let s = raw.replace(/^post:\s*/i, '').replace(/^["“”']+|["“”']+$/g, '')
  s = s.replace(/^[^\p{L}\p{N}]+/u, '')
  s = s.replace(
    /^(ultimate deal|new price drop|price drop|special offer|mega deal|hot deal|flash sale|new|promo|sale|deal)\s*[!:–-]*\s*/i,
    '',
  )
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  if (!s) return null
  // Post copy is a sentence, not a name: stop at the first hard break so we
  // get "BUILDECO Bamboo Charcoal Boards" and not the whole sales pitch.
  let cut = (s.split(/[\n–—|]/)[0] ?? s).trim()
  cut = (cut.split(/\s+[-—]\s+|[.!?]\s|,\s|\s+(?:Rs|only|now)\b/i)[0] ?? cut).trim()
  // Marketing copy often leads with a verb phrase ("Revolutionize Your Walls
  // Instantly with BUILDECO's ..."); the product follows the preposition.
  const after = cut.match(/\b(?:with|from)\s+(.{6,})$/i)?.[1]
  if (after && /^[\p{Lu}]/u.test(after)) cut = after.trim()
  cut = cut
    .replace(/[’']s\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    // Trailing punctuation from the original sentence.
    .replace(/[!?.,:;\s]+$/u, '')
    .trim()
  return truncate(cut.length >= 8 ? cut : s)
}

function truncate(value: string): string {
  const out = value.trim()
  return out.length > 48 ? `${out.slice(0, 48).trimEnd()}…` : out
}

const STALE_MS = 6 * 60 * 60 * 1000 // 6h - ad<->post links change slowly.
let lastSync = 0
let syncing: Promise<void> | null = null

/**
 * Walks every ad account and caches post -> ad. Deliberately cached in
 * Postgres, not memory: the map is ~2k rows and rebuilding costs many
 * paginated Graph calls, which would make the inbox crawl.
 */
async function syncPostAds(): Promise<void> {
  const db = createAdminClient()
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return
  const auth = `access_token=${encodeURIComponent(token)}`

  const accounts = await fbGet<{ data?: { id: string; name: string }[] }>(
    `${GRAPH}/me/adaccounts?fields=id,name&limit=50&${auth}`,
    { cacheTtl: STALE_MS },
  )

  const rows = new Map<
    string,
    { post_id: string; ad_id: string; ad_name: string; product: string | null; page_id: string }
  >()
  for (const account of accounts.data ?? []) {
    let url: string | null =
      `${GRAPH}/${account.id}/ads?fields=id,name,creative{effective_object_story_id}&limit=500&${auth}`
    // Cap pagination so a huge account cannot hang the request.
    for (let page = 0; page < 6 && url; page++) {
      type AdsPage = {
        data?: { id: string; name?: string; creative?: { effective_object_story_id?: string } }[]
        paging?: { next?: string }
      }
      const res: AdsPage | null = await fbGet<AdsPage>(url, { cacheTtl: STALE_MS }).catch(() => null)
      if (!res) break

      for (const ad of res.data ?? []) {
        const postId = ad.creative?.effective_object_story_id
        if (!postId || rows.has(postId)) continue
        rows.set(postId, {
          post_id: postId,
          ad_id: ad.id,
          ad_name: ad.name ?? '',
          product: productFromAdName(ad.name),
          page_id: postId.split('_')[0] ?? '',
        })
      }
      url = res.paging?.next ?? null
    }
  }

  if (rows.size === 0) return
  const all = [...rows.values()]
  for (let i = 0; i < all.length; i += 500) {
    await db.from('page_post_ads').upsert(all.slice(i, i + 500), { onConflict: 'post_id' })
  }
  lastSync = Date.now()
}

/** Refresh the cache when stale, collapsing concurrent callers into one sync. */
export async function ensurePostAdsFresh(): Promise<void> {
  if (Date.now() - lastSync < STALE_MS) return
  if (!syncing) {
    syncing = syncPostAds()
      .catch((error) => {
        console.log('[v0] post-ads: sync failed', error)
      })
      .finally(() => {
        syncing = null
      })
  }
  await syncing
}

/** Look up ads for a batch of post ids. Never throws. */
export async function getPostAds(postIds: string[]): Promise<Map<string, PostAd>> {
  const out = new Map<string, PostAd>()
  const unique = [...new Set(postIds.filter(Boolean))]
  if (unique.length === 0) return out

  try {
    const db = createAdminClient()
    let { data } = await db
      .from('page_post_ads')
      .select('post_id, ad_id, ad_name, product')
      .in('post_id', unique)

    // Cold cache (or all misses) - build it once, then retry.
    if (!data || data.length === 0) {
      await ensurePostAdsFresh()
      ;({ data } = await db
        .from('page_post_ads')
        .select('post_id, ad_id, ad_name, product')
        .in('post_id', unique))
    }

    for (const row of data ?? []) {
      out.set(row.post_id, {
        postId: row.post_id,
        adId: row.ad_id,
        adName: row.ad_name,
        product: row.product ?? productFromAdName(row.ad_name),
      })
    }
  } catch (error) {
    console.log('[v0] post-ads: lookup failed', error)
  }
  return out
}
