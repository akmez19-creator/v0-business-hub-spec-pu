// Rebuilds page_post_ads: post -> ad -> campaign -> catalogue product.
//
// Run with:
//   node --env-file=.env.development.local scripts/sync-post-ads.mjs
//
// Imports the SAME modules the app uses (via a tiny TS transpile) rather than
// reimplementing the parsing, so the cache can never drift from what the inbox
// renders. The app refreshes this itself every 6h; this script is for forcing
// a rebuild after changing the matcher.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Transpiles a dependency-free TS module and imports it. */
async function loadModule(path) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

const { productFromAdName, productFromCampaignName } = await loadModule(
  'lib/facebook/ad-product-name.ts',
)
const { createProductMatcher } = await loadModule('lib/products/match.ts')

const token = process.env.FACEBOOK_ACCESS_TOKEN
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const get = async (url) => {
  try {
    return await (await fetch(url)).json()
  } catch (error) {
    return { error: { message: String(error) } }
  }
}

const [{ data: products }, { data: aliases }] = await Promise.all([
  db.from('products').select('id, name, category'),
  db.from('product_aliases').select('alias_name, product_id'),
])
const matchProduct = createProductMatcher(products ?? [], aliases ?? [])
console.log(`catalogue=${products?.length ?? 0} aliases=${aliases?.length ?? 0}`)

const accounts = await get(`${GRAPH}/me/adaccounts?fields=id,name&limit=100&access_token=${token}`)
const fields =
  'id,name,effective_status,campaign{id,name,objective},creative{effective_object_story_id}'

const rows = new Map()
for (const account of accounts.data ?? []) {
  let url = `${GRAPH}/${account.id}/ads?fields=${encodeURIComponent(fields)}&limit=500&access_token=${token}`
  for (let page = 0; page < 25 && url; page++) {
    const res = await get(url)
    if (res.error) {
      console.log(`  ! ${account.name}: ${String(res.error.message).slice(0, 60)}`)
      break
    }
    for (const ad of res.data ?? []) {
      const postId = ad.creative?.effective_object_story_id
      if (!postId) continue
      // One post can carry several ads; prefer a live one so the campaign
      // shown against a lead is the one still spending money.
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

const all = [...rows.values()]
for (let i = 0; i < all.length; i += 500) {
  const { error } = await db.from('page_post_ads').upsert(all.slice(i, i + 500), {
    onConflict: 'post_id',
  })
  if (error) {
    console.log(`upsert failed at ${i}: ${error.message}`)
    process.exit(1)
  }
}

const linked = all.filter((r) => r.product_id).length
const active = all.filter((r) => r.ad_status === 'ACTIVE').length
const campaigns = new Set(all.map((r) => r.campaign_id).filter(Boolean))
const confidence = {}
for (const r of all) if (r.match_confidence) confidence[r.match_confidence] = (confidence[r.match_confidence] ?? 0) + 1

console.log(
  `cached=${all.length} linked=${linked} (${Math.round((100 * linked) / all.length)}%) ` +
    `activeAds=${active} campaigns=${campaigns.size}`,
)
console.log('confidence:', JSON.stringify(confidence))
