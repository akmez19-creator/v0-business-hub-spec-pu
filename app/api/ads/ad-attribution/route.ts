import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fbGetAll } from '@/lib/facebook/graph'
import { usdToRs } from '@/lib/ads/currency'
import { evaluateAd, type AdPerformance } from '@/lib/ads/kill-rule'

const FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v21.0'

/**
 * Exact client count per AD (not per campaign, not per product).
 *
 * The data for this already existed: deliveries.ad_id is populated on the
 * overwhelming majority of rows. What was missing was anything that grouped by
 * it - the TV wall groups by product, so an individual ad's client count was
 * never visible even though it was recorded.
 *
 * Deliveries with a NULL ad_id are counted and returned separately rather than
 * dropped. That number matters: an unattributed delivery looks exactly like
 * "this ad got no clients" to the kill rule, so it has to stay visible.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  if (!accessToken) {
    return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const accountId = searchParams.get('accountId')
  const since = searchParams.get('since')
  const until = searchParams.get('until')
  if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })

  try {
    // ── 1. Clients per ad, straight from deliveries ──
    let q = supabase.from('deliveries').select('ad_id, product_id, entry_date')
    if (since) q = q.gte('entry_date', since)
    if (until) q = q.lte('entry_date', until)
    const { data: deliveries, error: dErr } = await q
    if (dErr) throw new Error(dErr.message)

    const clientsByAd = new Map<string, number>()
    let unattributed = 0
    for (const d of deliveries ?? []) {
      const adId = (d as { ad_id?: string | null }).ad_id
      if (!adId) {
        unattributed++
        continue
      }
      clientsByAd.set(adId, (clientsByAd.get(adId) ?? 0) + 1)
    }

    // ── 2. Ad-level spend, one call via field expansion ──
    // Same quota-saving shape the campaigns route uses: asking for insights as
    // a nested field costs one call for the whole page instead of one per ad.
    const timeRange =
      since && until ? `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` : ''
    const ads = await fbGetAll<{
      id: string
      name: string
      effective_status: string
      created_time: string
      campaign?: { id: string; name: string }
      insights?: { data?: Array<{ spend?: string }> }
    }>(
      `${FACEBOOK_GRAPH_URL}/${accountId}/ads` +
        `?fields=id,name,effective_status,created_time,campaign{id,name},insights.fields(spend)` +
        `&access_token=${accessToken}&limit=500${timeRange}`,
      { cacheTtl: 2 * 60 * 1000 },
    )

    // ── 3. Kill state, so an already-killed ad is not re-flagged ──
    const { data: killState } = await supabase
      .from('ad_kill_state')
      .select('ad_id, killed_at, reactivated_at')
    const killByAd = new Map(
      (killState ?? []).map((k) => [
        (k as { ad_id: string }).ad_id,
        k as { killed_at: string | null; reactivated_at: string | null },
      ]),
    )

    // ── 4. Join ──
    const rows = (ads ?? []).map((ad) => {
      const spendUsd = Number(ad.insights?.data?.[0]?.spend ?? 0) || 0
      const clients = clientsByAd.get(ad.id) ?? 0
      const ks = killByAd.get(ad.id)
      const perf: AdPerformance = {
        adId: ad.id,
        adName: ad.name,
        spendUsd,
        clients,
        createdAt: ad.created_time ?? null,
        status: ad.effective_status,
        killedAt: ks?.killed_at ?? null,
        reactivatedAt: ks?.reactivated_at ?? null,
      }
      const verdict = evaluateAd(perf)
      const spendRs = usdToRs(spendUsd)
      return {
        adId: ad.id,
        adName: ad.name,
        campaignId: ad.campaign?.id ?? null,
        campaignName: ad.campaign?.name ?? null,
        status: ad.effective_status,
        createdTime: ad.created_time ?? null,
        clients,
        spendUsd,
        spendRs,
        // null rather than 0 when there are no clients: "no data" and
        // "costs Rs 0 per client" are very different claims
        costPerClientRs: clients > 0 ? spendRs / clients : null,
        killed: Boolean(ks?.killed_at && !ks?.reactivated_at),
        shouldKill: verdict.kill,
        verdictReason: verdict.reason,
      }
    })

    rows.sort((a, b) => b.spendRs - a.spendRs)

    return NextResponse.json({
      ads: rows,
      unattributedDeliveries: unattributed,
      totalDeliveries: deliveries?.length ?? 0,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build ad attribution' },
      { status: 500 },
    )
  }
}
