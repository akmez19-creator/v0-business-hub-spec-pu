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
    const status: string | undefined = body?.status
    if (!campaignId || (status !== 'ACTIVE' && status !== 'PAUSED')) {
      return NextResponse.json(
        { error: 'campaignId and status (ACTIVE | PAUSED) are required' },
        { status: 400 },
      )
    }

    const res = await fetch(`${FACEBOOK_GRAPH_URL}/${campaignId}`, {
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

    return NextResponse.json({ success: true, campaignId, status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update campaign' },
      { status: 500 },
    )
  }
}
