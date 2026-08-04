import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Turn a Facebook campaign ON (ACTIVE) or OFF (PAUSED) straight from the
// wall. Auth-gated: only signed-in dashboard users can flip ad status.
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
    // The Rs 150 kill rule acts on a single AD, not a whole campaign - pausing
    // the campaign would take down its sibling ads too. Graph accepts `status`
    // on /{ad_id} exactly as it does on /{campaign_id}, so the same handler
    // serves both; campaignId behaviour is unchanged.
    const adId: string | undefined = typeof body?.adId === 'string' ? body.adId : undefined
    const status: string | undefined = body?.status

    const targetId = adId || campaignId
    const targetKind = adId ? 'ad' : 'campaign'
    if (!targetId || (status !== 'ACTIVE' && status !== 'PAUSED')) {
      return NextResponse.json(
        { error: 'campaignId or adId, plus status (ACTIVE | PAUSED), are required' },
        { status: 400 },
      )
    }

    const res = await fetch(`${FACEBOOK_GRAPH_URL}/${targetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status, access_token: accessToken }),
    })
    const json = await res.json()

    if (!res.ok || json.error) {
      return NextResponse.json(
        { error: json.error?.message || 'Facebook rejected the status change' },
        { status: 502 },
      )
    }

    return NextResponse.json({ success: true, id: targetId, kind: targetKind, campaignId, adId, status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update campaign' },
      { status: 500 },
    )
  }
}
