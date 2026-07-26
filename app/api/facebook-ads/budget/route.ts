import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Adjust a campaign's budget straight from the wall. Two actions:
//
// BOOST (percent 20 | 50): increase the REMAINING budget by the given
// percent. Daily campaigns grow the daily amount itself.
//
// OPTIMUM DECREASE (percent 'optimum'): shrink the budget to the calculated
// floor - keep what is already spent, and allocate exactly 1.25 (account
// currency) per remaining day until the campaign's end date:
//   new lifetime budget = spent so far + remaining_days x 1.25
// Daily campaigns simply get their daily budget set to 1.25/day.
// Refuses to run if the campaign is already at/below its optimum, or if a
// lifetime campaign has no end date (remaining days would be undefined).
//
// Auth-gated: only signed-in dashboard users can move money.
const OPTIMUM_PER_DAY_MINOR = 125 // 1.25 in minor units (cents)

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
    const percent: number | 'optimum' | undefined = body?.percent
    if (!campaignId || (percent !== 20 && percent !== 50 && percent !== 'optimum')) {
      return NextResponse.json(
        { error: "campaignId and percent (20 | 50 | 'optimum') are required" },
        { status: 400 },
      )
    }

    // 1. Read the current budget state (values are in minor units, cents).
    // stop_time is needed to compute the remaining days for the optimum.
    const readRes = await fetch(
      `${FACEBOOK_GRAPH_URL}/${campaignId}?fields=lifetime_budget,daily_budget,budget_remaining,stop_time&access_token=${accessToken}`,
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
    let remainingDays: number | null = null

    if (percent === 'optimum') {
      // ---- OPTIMUM DECREASE: spent + remaining_days x 1.25 ----
      if (daily > 0 && lifetime <= 0) {
        // Daily campaign: the optimum daily allocation IS 1.25/day
        if (daily <= OPTIMUM_PER_DAY_MINOR) {
          return NextResponse.json(
            { error: 'Daily budget is already at or below the 1.25/day optimum' },
            { status: 400 },
          )
        }
        field = 'daily_budget'
        newBudget = OPTIMUM_PER_DAY_MINOR
      } else if (lifetime > 0) {
        if (!current.stop_time) {
          return NextResponse.json(
            { error: 'Campaign has no end date - cannot compute remaining days for the optimum' },
            { status: 400 },
          )
        }
        const msLeft = new Date(current.stop_time).getTime() - Date.now()
        // Count today as a remaining day while the campaign is still running
        remainingDays = Math.max(1, Math.ceil(msLeft / 86_400_000))
        if (msLeft <= 0) {
          return NextResponse.json(
            { error: 'Campaign has already ended - nothing to optimize' },
            { status: 400 },
          )
        }
        const spent = Math.max(0, lifetime - remaining)
        const optimum = spent + remainingDays * OPTIMUM_PER_DAY_MINOR
        if (optimum >= lifetime) {
          return NextResponse.json(
            {
              error: `Already at/below optimum (needs ${(optimum / 100).toFixed(2)}, budget is ${(lifetime / 100).toFixed(2)})`,
            },
            { status: 400 },
          )
        }
        field = 'lifetime_budget'
        newBudget = optimum
      } else {
        return NextResponse.json(
          { error: 'This campaign has no campaign-level budget (budget may be set at ad-set level)' },
          { status: 400 },
        )
      }
    } else if (lifetime > 0) {
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
      // Optimum extras so the wall can show the math applied
      remainingDays,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update budget' },
      { status: 500 },
    )
  }
}
