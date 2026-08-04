import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { usdToRs } from '@/lib/ads/currency'
import { KILL_SPEND_RS } from '@/lib/ads/kill-rule'

const FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v21.0'

/**
 * Confirm a kill. SUGGEST-ONLY by design: this only ever runs because a human
 * clicked the button on a specific ad.
 *
 * Nothing in the codebase calls this on a schedule, and that is deliberate.
 * Attribution can gap (a delivery that loses its ad_id looks identical to "this
 * ad produced nothing"), so an unattended job could pause profitable ads
 * overnight with no one watching.
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
    const adId: string | undefined = typeof body?.adId === 'string' ? body.adId : undefined
    const adName: string | undefined = typeof body?.adName === 'string' ? body.adName : undefined
    const action: string = body?.action === 'reactivate' ? 'reactivate' : 'kill'
    const spendUsd = Number(body?.spendUsd) || 0
    const clients = Number(body?.clients) || 0
    const reason: string = typeof body?.reason === 'string' ? body.reason : `Rs ${KILL_SPEND_RS}+ spent, no clients`

    if (!adId) return NextResponse.json({ error: 'adId is required' }, { status: 400 })

    const status = action === 'reactivate' ? 'ACTIVE' : 'PAUSED'

    // Facebook first. If the pause fails there is nothing to record, and
    // writing the row anyway would make a live ad look dead in the dashboard.
    const res = await fetch(`${FACEBOOK_GRAPH_URL}/${adId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status, access_token: accessToken }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      return NextResponse.json(
        { error: json?.error?.message || `Facebook rejected the ${action}` },
        { status: 502 },
      )
    }

    if (action === 'reactivate') {
      // reactivated_at re-arms the rule and gives the ad a fresh 24h window,
      // so reviving an ad does not get it instantly re-flagged on old spend.
      const { error } = await supabase
        .from('ad_kill_state')
        .update({ reactivated_at: new Date().toISOString(), killed_at: null })
        .eq('ad_id', adId)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, adId, status })
    }

    const { error } = await supabase.from('ad_kill_state').upsert(
      {
        ad_id: adId,
        ad_name: adName ?? null,
        killed_at: new Date().toISOString(),
        spend_rs: usdToRs(spendUsd),
        clients,
        reason,
        killed_by: user.id,
        // Clearing any previous revival is what makes the kill stick: the
        // evaluator skips rows with killed_at set and no reactivated_at.
        reactivated_at: null,
      },
      { onConflict: 'ad_id' },
    )
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, adId, status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update kill state' },
      { status: 500 },
    )
  }
}

/** Ads already killed, so the UI can show them as permanently off. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ad_kill_state')
    .select('*')
    .not('killed_at', 'is', null)
    .is('reactivated_at', null)
    .order('killed_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ killed: data ?? [] })
}
