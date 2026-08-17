import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { createProductMatcher, type MatchConfidence } from '@/lib/products/match'
import { productFromAdName, productFromCampaignName } from './ad-product-name'
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
  /** Canonical catalogue product, when the label could be resolved. */
  productId: string | null
  matchConfidence: MatchConfidence | null
  campaignId: string | null
  campaignName: string | null
  campaignObjective: string | null
  /** ACTIVE | PAUSED | ... - whether this lead source is still running. */
  adStatus: string | null
}

// Re-exported so existing importers keep working; the implementation lives in
// a dependency-free module that backfill scripts can import too.
export { productFromAdName }

export type AdCampaign = {
  campaignId: string | null
  campaignName: string | null
  /** True when the ad itself is still delivering. */
  active: boolean
}

/**
 * Campaign lookup keyed by AD id rather than post id.
 *
 * Messenger click-to-message threads arrive via the webhook with only an ad
 * id, so they never touch the post->ad cache the comment path uses. The rows
 * are already in `page_post_ads`, just indexed the other way round.
 */
export async function getCampaignsForAds(adIds: string[]): Promise<Map<string, AdCampaign>> {
  const out = new Map<string, AdCampaign>()
  const unique = [...new Set(adIds.filter(Boolean))]
  if (unique.length === 0) return out

  try {
    const db = createAdminClient()
    const { data } = await db
      .from('page_post_ads')
      .select('ad_id, campaign_id, campaign_name, ad_status')
      .in('ad_id', unique)

    for (const row of data ?? []) {
      if (!row.ad_id) continue
      out.set(row.ad_id, {
        campaignId: row.campaign_id ?? null,
        campaignName: row.campaign_name ?? null,
        active: row.ad_status === 'ACTIVE',
      })
    }
  } catch (error) {
    // Campaign context is decoration; never take down the inbox for it.
    console.log('[v0] post-ads: campaign lookup failed', error)
  }
  return out
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

  // Resolve labels onto the real catalogue while we are here, so the inbox
  // never has to fuzzy-match at read time.
  const [{ data: products }, { data: aliases }] = await Promise.all([
    db.from('products').select('id, name, category'),
    db.from('product_aliases').select('alias_name, product_id'),
  ])
  const matchProduct = createProductMatcher(products ?? [], aliases ?? [])

  type Row = {
    post_id: string
    ad_id: string
    ad_name: string
    product: string | null
    page_id: string
    product_id: string | null
    match_confidence: MatchConfidence | null
    campaign_id: string | null
    campaign_name: string | null
    campaign_objective: string | null
    ad_status: string | null
  }

  const rows = new Map<string, Row>()
  const fields =
    'id,name,effective_status,campaign{id,name,objective},creative{effective_object_story_id}'
  for (const account of accounts.data ?? []) {
    let url: string | null = `${GRAPH}/${account.id}/ads?fields=${encodeURIComponent(fields)}&limit=500&${auth}`
    // Walk every page. A truncated crawl previously left whole pages with no
    // cached ads at all, which looked like broken attribution.
    for (let page = 0; page < 25 && url; page++) {
      type AdsPage = {
        data?: {
          id: string
          name?: string
          effective_status?: string
          campaign?: { id?: string; name?: string; objective?: string }
          creative?: { effective_object_story_id?: string }
        }[]
        paging?: { next?: string }
      }
      const res: AdsPage | null = await fbGet<AdsPage>(url, { cacheTtl: STALE_MS }).catch(() => null)
      if (!res) break

      for (const ad of res.data ?? []) {
        const postId = ad.creative?.effective_object_story_id
        if (!postId) continue
        // One post can carry several ads. Prefer a live one, so the campaign
        // shown against a lead is the campaign still spending money.
        const existing = rows.get(postId)
        if (existing && existing.ad_status === 'ACTIVE' && ad.effective_status !== 'ACTIVE') continue

        // Prefer the ad name; fall back to the campaign name, which is
        // human-written and often cleaner than Meta's auto-generated copy.
        const campaignLabel = productFromCampaignName(ad.campaign?.name)
        const adLabel = productFromAdName(ad.name)
        const match = matchProduct(adLabel) ?? matchProduct(campaignLabel)
        const label = adLabel ?? campaignLabel
        rows.set(postId, {
          post_id: postId,
          ad_id: ad.id,
          ad_name: ad.name ?? '',
          product: label,
          page_id: postId.split('_')[0] ?? '',
          product_id: match?.productId ?? null,
          match_confidence: match?.confidence ?? null,
          campaign_id: ad.campaign?.id ?? null,
          campaign_name: ad.campaign?.name ?? null,
          campaign_objective: ad.campaign?.objective ?? null,
          ad_status: ad.effective_status ?? null,
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
    const columns =
      'post_id, ad_id, ad_name, product, product_id, match_confidence, campaign_id, campaign_name, campaign_objective, ad_status'
    let { data } = await db.from('page_post_ads').select(columns).in('post_id', unique)

    // Cold cache (or all misses) - build it once, then retry.
    if (!data || data.length === 0) {
      await ensurePostAdsFresh()
      ;({ data } = await db.from('page_post_ads').select(columns).in('post_id', unique))
    }

    for (const row of data ?? []) {
      out.set(row.post_id, {
        postId: row.post_id,
        adId: row.ad_id,
        adName: row.ad_name,
        product: row.product ?? productFromAdName(row.ad_name),
        productId: row.product_id ?? null,
        matchConfidence: (row.match_confidence as MatchConfidence | null) ?? null,
        campaignId: row.campaign_id ?? null,
        campaignName: row.campaign_name ?? null,
        campaignObjective: row.campaign_objective ?? null,
        adStatus: row.ad_status ?? null,
      })
    }
  } catch (error) {
    console.log('[v0] post-ads: lookup failed', error)
  }
  return out
}
