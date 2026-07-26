import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Boost a campaign's budget straight from the wall: increase the REMAINING
// budget by the given percent (20 or 50). We read the campaign's current
// budget + budget_remaining from the Graph API server-side, add
// remaining * percent to the budget, and write it back. Works for both
// lifetime-budget and daily-budget campaigns (daily has no meaningful
// "remaining", so we grow the daily budget itself by the percent).
// Auth-gated: only signed-in dashboard users can move money.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  if (!accessToken) {
    return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const campaignId: string | undefined = typeof body?.campaignId === 'string' ? body.campaignId : undefined
    const percent: number | undefined = body?.percent
    if (!campaignId || (percent !== 20 && percent !== 50)) {
      return NextResponse.json(
        { error: 'campaignId and percent (20 | 50) are required' },
        { status: 400 },
      )
    }

    // 1. Read the current budget state (values are in minor units, cents)
    const readRes = await fetch(
      `${FACEBOOK_GRAPH_URL}/${campaignId}?fields=lifetime_budget,daily_budget,budget_remaining&access_token=${accessToken}`,
    )
    const current = await readRes.json()
    if (!readRes.ok || current.error) {
      return NextResponse.json(
        { error: current.error?.message || 'Could not read current budget from Facebook' },
        { status: 502 },
      )
    }

    const lifetime = current.lifetime_budget ? Number.parseInt(current.lifetime_budget, 10) : 0
    const daily = current.daily_budget ? Number.parseInt(current.daily_budget, 10) : 0
    const remaining = current.budget_remaining ? Number.parseInt(current.budget_remaining, 10) : 0

    let field: 'lifetime_budget' | 'daily_budget'
    let newBudget: number
    if (lifetime > 0) {
      // Lifetime campaign: add percent-of-REMAINING on top of the total
      const boost = Math.round((remaining > 0 ? remaining : lifetime) * (percent / 100))
      if (boost <= 0) {
        return NextResponse.json({ error: 'Nothing left to boost on this campaign' }, { status: 400 })
      }
      field = 'lifetime_budget'
      newBudget = lifetime + boost
    } else if (daily > 0) {
      // Daily campaign: no real "remaining" - grow the daily budget itself
      field = 'daily_budget'
      newBudget = Math.round(daily * (1 + percent / 100))
    } else {
      return NextResponse.json(
        { error: 'This campaign has no campaign-level budget (budget may be set at ad-set level)' },
        { status: 400 },
      )
    }

    // 2. Write the new budget back
    const writeRes = await fetch(`${FACEBOOK_GRAPH_URL}/${campaignId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [field]: String(newBudget), access_token: accessToken }),
    })
    const writeJson = await writeRes.json()
    if (!writeRes.ok || writeJson.error) {
      return NextResponse.json(
        { error: writeJson.error?.message || 'Facebook rejected the budget change' },
        { status: 502 },
      )
    }

    return NextResponse.json({
      success: true,
      campaignId,
      field,
      // Minor units -> whole currency for the confirmation toast
      previous: Math.round((field === 'lifetime_budget' ? lifetime : daily) / 100),
      next: Math.round(newBudget / 100),
      remainingBefore: Math.round(remaining / 100),
      percent,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update budget' },
      { status: 500 },
    )
  }
}
