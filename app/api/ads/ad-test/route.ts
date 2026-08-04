import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fbPostJson, fbDetail } from '@/lib/facebook/write'
import { usdToRs } from '@/lib/ads/currency'

export const maxDuration = 300

const FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v21.0'

/**
 * Every testing ad runs at $1/day. Enforced HERE, server-side, and never taken
 * from the request body: a tampered or buggy client must not be able to launch
 * three ads at $1,000/day. Facebook wants the daily budget in cents.
 */
const TEST_DAILY_BUDGET_USD = 1
const TEST_DAILY_BUDGET_CENTS = String(TEST_DAILY_BUDGET_USD * 100)

/** How many variants a single test runs. */
const VARIANTS = 3

/**
 * Launch a 3-variant test off one source ad.
 *
 * Variants are created SEQUENTIALLY, not in parallel. Facebook rate-limits ad
 * creation aggressively, and a parallel burst gets throttled into partial
 * failure with no clear indication of which variant died.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  if (!accessToken) {
    return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const sourceAdId: string | undefined = typeof body?.sourceAdId === 'string' ? body.sourceAdId : undefined
    const productId: string | null = typeof body?.productId === 'string' ? body.productId : null
    const labelBase: string = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : 'Test'

    if (!sourceAdId) return NextResponse.json({ error: 'sourceAdId is required' }, { status: 400 })

    // Read the source ad's ad set so each variant lands in the same targeting
    const srcRes = await fetch(
      `${FACEBOOK_GRAPH_URL}/${sourceAdId}?fields=name,adset_id,account_id,creative{id}&access_token=${accessToken}`,
    )
    const src = await srcRes.json()
    if (!srcRes.ok || src.error) {
      return NextResponse.json(
        { error: fbDetail(src.error) || 'Could not read the source ad' },
        { status: 502 },
      )
    }
    const adsetId: string | undefined = src.adset_id
    const accountId: string | undefined = src.account_id
    const creativeId: string | undefined = src.creative?.id
    if (!adsetId || !accountId || !creativeId) {
      return NextResponse.json({ error: 'Source ad is missing its ad set or creative' }, { status: 400 })
    }

    // Pin the ad set to $1/day so the variants cannot inherit a large budget.
    const budgetRes = await fbPostJson(`${FACEBOOK_GRAPH_URL}/${adsetId}`, {
      daily_budget: TEST_DAILY_BUDGET_CENTS,
      access_token: accessToken,
    })
    // A refused budget change is not fatal on its own (the ad set may use a
    // campaign-level budget), but it MUST be surfaced - otherwise a "$1 test"
    // could quietly be spending far more than the label claims.
    const budgetWarning = budgetRes.ok ? null : fbDetail(budgetRes.json.error) || 'Could not force the $1/day budget'

    const created: Array<{ adId: string; label: string }> = []
    const failed: Array<{ label: string; error: string }> = []

    for (let i = 0; i < VARIANTS; i++) {
      const label = `${labelBase} - V${i + 1}`
      const res = await fbPostJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/ads`, {
        name: label,
        adset_id: adsetId,
        creative: { creative_id: creativeId },
        // Variants start PAUSED. Three ads going live the instant a button is
        // clicked is not something that should happen without a second look.
        status: 'PAUSED',
        access_token: accessToken,
      })
      if (res.ok && res.json.id) {
        created.push({ adId: res.json.id as string, label })
      } else {
        failed.push({ label, error: fbDetail(res.json.error) || 'Facebook rejected this variant' })
      }
    }

    if (created.length === 0) {
      return NextResponse.json(
        { error: failed[0]?.error || 'No variants could be created', failed },
        { status: 502 },
      )
    }

    const { data: test, error } = await supabase
      .from('ad_tests')
      .insert({
        product_id: productId,
        source_ad_id: sourceAdId,
        variant_ads: created,
        daily_budget_usd: TEST_DAILY_BUDGET_USD,
        status: 'running',
        notes: budgetWarning,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      test,
      created,
      // Partial success is reported honestly rather than as a clean win: if
      // only 2 of 3 variants exist, the comparison is not what was asked for.
      failed,
      budgetWarning,
      dailyBudgetUsd: TEST_DAILY_BUDGET_USD,
      dailyBudgetRs: usdToRs(TEST_DAILY_BUDGET_USD),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to launch the ad test' },
      { status: 500 },
    )
  }
}

/** Running tests, with each variant's live spend and attributed clients. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tests, error } = await supabase
    .from('ad_tests')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  const enriched = []
  for (const t of tests ?? []) {
    const variants = Array.isArray(t.variant_ads) ? (t.variant_ads as Array<{ adId: string; label: string }>) : []
    const adIds = variants.map((v) => v.adId)

    // Clients per variant straight from deliveries
    const clientsByAd = new Map<string, number>()
    if (adIds.length > 0) {
      const { data: deliveries } = await supabase.from('deliveries').select('ad_id').in('ad_id', adIds)
      for (const d of deliveries ?? []) {
        const id = (d as { ad_id?: string | null }).ad_id
        if (id) clientsByAd.set(id, (clientsByAd.get(id) ?? 0) + 1)
      }
    }

    // Spend per variant, one batched call
    const spendByAd = new Map<string, number>()
    if (accessToken && adIds.length > 0) {
      try {
        const res = await fetch(
          `${FACEBOOK_GRAPH_URL}/?ids=${adIds.join(',')}&fields=effective_status,insights.fields(spend)&access_token=${accessToken}`,
        )
        const json = await res.json()
        if (res.ok && !json.error) {
          for (const id of adIds) {
            const spend = Number(json?.[id]?.insights?.data?.[0]?.spend ?? 0) || 0
            spendByAd.set(id, spend)
          }
        }
      } catch {
        /* spend is best-effort; client counts still render */
      }
    }

    enriched.push({
      ...t,
      variants: variants.map((v) => {
        const spendUsd = spendByAd.get(v.adId) ?? 0
        const clients = clientsByAd.get(v.adId) ?? 0
        return {
          ...v,
          spendUsd,
          spendRs: usdToRs(spendUsd),
          clients,
          costPerClientRs: clients > 0 ? usdToRs(spendUsd) / clients : null,
        }
      }),
    })
  }

  return NextResponse.json({ tests: enriched })
}
