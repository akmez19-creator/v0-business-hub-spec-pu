/**
 * Joins stored ad clicks onto the cached conversations.
 *
 * Split out from backfill-inbox-cache.mjs because it touches no Graph API at
 * all - it is a pure Postgres join over data already captured by the webhook
 * (messenger_ad_refs) and the ads cache (page_post_ads). Safe to re-run at any
 * time, including while rate limited.
 *
 *   node --env-file=.env.development.local scripts/backfill-inbox-attribution.mjs
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  const { data: refs, error } = await db
    .from('messenger_ad_refs')
    .select('page_id,sender_id,ad_id')
    .not('ad_id', 'is', null)
  if (error) throw new Error(error.message)

  console.log(`[v0] ${refs.length} ad refs to apply`)
  if (refs.length === 0) return 0

  // One lookup for every ad referenced, rather than a query per thread.
  const adIds = [...new Set(refs.map((r) => r.ad_id))]
  const { data: ads } = await db
    .from('page_post_ads')
    .select('ad_id,ad_name,product,product_id,campaign_id,campaign_name')
    .in('ad_id', adIds)

  const byAd = new Map((ads ?? []).map((a) => [a.ad_id, a]))
  console.log(`[v0] ${byAd.size}/${adIds.length} ads resolved from page_post_ads`)

  let applied = 0
  let unresolved = 0
  for (const ref of refs) {
    const ad = byAd.get(ref.ad_id)
    if (!ad) {
      unresolved++
      continue
    }
    const { error: upErr, count } = await db
      .from('messenger_conversations')
      .update(
        {
          ad_id: ref.ad_id,
          ad_name: ad.ad_name ?? null,
          product: ad.product ?? null,
          product_id: ad.product_id ?? null,
          campaign_id: ad.campaign_id ?? null,
          campaign_name: ad.campaign_name ?? null,
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' },
      )
      .eq('page_id', ref.page_id)
      .eq('psid', ref.sender_id)
    if (upErr) console.log(`[v0]   update error: ${upErr.message}`)
    else applied += count ?? 0
  }

  // Unresolved is normal: the click may point at an ad the ads cache has not
  // walked yet. The ref is kept, so a later run picks it up.
  console.log(`[v0] ${unresolved} refs had no matching ad in page_post_ads (kept for a later run)`)
  return applied
}

main()
  .then((n) => console.log(`[v0] done: attribution applied to ${n} conversations`))
  .catch((e) => {
    console.error('[v0] failed:', e.message)
    process.exit(1)
  })
