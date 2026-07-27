import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Campaign creation by duplication: deep-copy an existing campaign (Graph
// API /copies clones the campaign + its ad sets + its ads), then rename the
// new campaign, EVERY ad set, and EVERY ad to one identical common name.
// The copy always starts PAUSED so no money moves until it's reviewed.
// Auth-gated like the budget route.
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
    const commonName: string = typeof body?.commonName === 'string' ? body.commonName.trim() : ''
    if (!campaignId || !commonName) {
      return NextResponse.json({ error: 'campaignId and commonName are required' }, { status: 400 })
    }
    if (commonName.length > 200) {
      return NextResponse.json({ error: 'commonName is too long (max 200 chars)' }, { status: 400 })
    }

    // 1. Deep copy: clones ad sets + ads, starts PAUSED
    const copyRes = await fetch(`${FACEBOOK_GRAPH_URL}/${campaignId}/copies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deep_copy: true,
        status_option: 'PAUSED',
        access_token: accessToken,
      }),
    })
    const copyJson = await copyRes.json()
    if (!copyRes.ok || copyJson.error) {
      return NextResponse.json(
        { error: copyJson.error?.message || 'Facebook rejected the campaign copy' },
        { status: 502 },
      )
    }
    // /copies returns { copied_campaign_id } (sometimes { id })
    const newCampaignId: string | undefined = copyJson.copied_campaign_id || copyJson.id
    if (!newCampaignId) {
      return NextResponse.json({ error: 'Copy succeeded but no new campaign id was returned' }, { status: 502 })
    }

    // 2. Read the copied tree: ad sets + ads
    const treeRes = await fetch(
      `${FACEBOOK_GRAPH_URL}/${newCampaignId}?fields=name,adsets.limit(100){id,name,ads.limit(200){id,name}}&access_token=${accessToken}`,
    )
    const tree = await treeRes.json()
    if (!treeRes.ok || tree.error) {
      return NextResponse.json(
        { error: tree.error?.message || 'Copied, but could not read the new campaign tree', newCampaignId },
        { status: 502 },
      )
    }

    // 3. Rename everything to the SAME common name
    const rename = async (id: string) => {
      const r = await fetch(`${FACEBOOK_GRAPH_URL}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: commonName, access_token: accessToken }),
      })
      const j = await r.json()
      return r.ok && !j.error
    }

    let adSetCount = 0
    let adCount = 0
    let failures = 0

    if (!(await rename(newCampaignId))) failures++

    const adsets: { id: string; ads?: { data?: { id: string }[] } }[] = tree.adsets?.data || []
    for (const adset of adsets) {
      if (await rename(adset.id)) adSetCount++
      else failures++
      const ads = adset.ads?.data || []
      for (const ad of ads) {
        if (await rename(ad.id)) adCount++
        else failures++
      }
    }

    return NextResponse.json({
      success: true,
      newCampaignId,
      commonName,
      renamed: { campaign: 1, adSets: adSetCount, ads: adCount },
      failures,
      status: 'PAUSED',
    })
  } catch (error) {
    console.error('duplicate campaign error:', error)
    return NextResponse.json({ error: 'Duplication failed' }, { status: 500 })
  }
}
