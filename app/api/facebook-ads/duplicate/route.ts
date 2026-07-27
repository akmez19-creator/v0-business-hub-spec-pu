import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Campaign creation by duplication: deep-copy an existing campaign (Graph
// API /copies clones the campaign + its ad sets + its ads), then rename the
// new campaign, EVERY ad set, and EVERY ad to one identical common name.
// Optionally re-points every copied ad at a chosen page post (boost), and
// the copy always starts PAUSED so no money moves until it's reviewed.
// Auth-gated like the budget route.

// GET ?action=pages           -> pages the token manages
// GET ?action=posts&pageId=.. -> recent posts of that page (for the boost picker)
export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  try {
    if (action === 'pages') {
      const res = await fetch(
        `${FACEBOOK_GRAPH_URL}/me/accounts?fields=id,name&limit=100&access_token=${encodeURIComponent(accessToken)}`,
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        return NextResponse.json({ error: json.error?.message || 'Failed to list pages' }, { status: 502 })
      }
      return NextResponse.json({ pages: (json.data || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })) })
    }

    if (action === 'posts') {
      const pageId = searchParams.get('pageId')
      if (!pageId) {
        return NextResponse.json({ error: 'pageId required' }, { status: 400 })
      }
      // Use the page's own token so unpublished/dark posts are included too
      const pageRes = await fetch(
        `${FACEBOOK_GRAPH_URL}/me/accounts?fields=id,access_token&limit=100&access_token=${encodeURIComponent(accessToken)}`,
      )
      const pageJson = await pageRes.json()
      const page = (pageJson.data || []).find((p: { id: string }) => p.id === pageId)
      const pageToken: string = page?.access_token || accessToken
      const res = await fetch(
        `${FACEBOOK_GRAPH_URL}/${pageId}/posts?fields=id,message,created_time,permalink_url,full_picture&limit=50&access_token=${encodeURIComponent(pageToken)}`,
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        return NextResponse.json({ error: json.error?.message || 'Failed to list posts' }, { status: 502 })
      }
      const posts = (json.data || []).map(
        (p: { id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string }) => ({
          id: p.id,
          message: (p.message || '').slice(0, 160),
          created_time: p.created_time || '',
          permalink_url: p.permalink_url || '',
          full_picture: p.full_picture || '',
        }),
      )
      return NextResponse.json({ posts })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('duplicate GET error:', error)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

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
    // Optional: page post id ("pageid_postid") every copied ad should boost
    const boostPostId: string = typeof body?.boostPostId === 'string' ? body.boostPostId.trim() : ''
    if (!campaignId || !commonName) {
      return NextResponse.json({ error: 'campaignId and commonName are required' }, { status: 400 })
    }
    if (boostPostId && !/^\d+_\d+$/.test(boostPostId)) {
      return NextResponse.json({ error: 'boostPostId must look like pageid_postid' }, { status: 400 })
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
      // Surface Facebook's human-readable details - "Invalid parameter" alone
      // hides the actual reason (e.g. objective not copyable, account limits)
      const fbErr = copyJson.error
      const detail = [fbErr?.error_user_title, fbErr?.error_user_msg].filter(Boolean).join(': ')
      return NextResponse.json(
        { error: detail || fbErr?.message || 'Facebook rejected the campaign copy' },
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
    const allAdIds: string[] = []
    for (const adset of adsets) {
      if (await rename(adset.id)) adSetCount++
      else failures++
      const ads = adset.ads?.data || []
      for (const ad of ads) {
        allAdIds.push(ad.id)
        if (await rename(ad.id)) adCount++
        else failures++
      }
    }

    // 4. Optionally boost a chosen page post: one creative pointing at the
    // post, then every copied ad is re-pointed at that creative
    let boosted = 0
    let boostError = ''
    if (boostPostId && allAdIds.length > 0) {
      const acctRes = await fetch(`${FACEBOOK_GRAPH_URL}/${newCampaignId}?fields=account_id&access_token=${accessToken}`)
      const acctJson = await acctRes.json()
      const accountId: string | undefined = acctJson.account_id
      if (!accountId) {
        boostError = 'Could not resolve the ad account for the new campaign'
      } else {
        const creativeRes = await fetch(`${FACEBOOK_GRAPH_URL}/act_${accountId}/adcreatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${commonName} - boosted post`,
            object_story_id: boostPostId,
            access_token: accessToken,
          }),
        })
        const creativeJson = await creativeRes.json()
        if (!creativeRes.ok || creativeJson.error) {
          const fbErr = creativeJson.error
          boostError =
            [fbErr?.error_user_title, fbErr?.error_user_msg].filter(Boolean).join(': ') ||
            fbErr?.message ||
            'Could not create the boost creative'
        } else {
          for (const adId of allAdIds) {
            const r = await fetch(`${FACEBOOK_GRAPH_URL}/${adId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creative: { creative_id: creativeJson.id }, access_token: accessToken }),
            })
            const j = await r.json()
            if (r.ok && !j.error) boosted++
            else failures++
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      newCampaignId,
      commonName,
      renamed: { campaign: 1, adSets: adSetCount, ads: adCount },
      boosted: boostPostId ? { post: boostPostId, ads: boosted, error: boostError || undefined } : undefined,
      failures,
      status: 'PAUSED',
    })
  } catch (error) {
    console.error('duplicate campaign error:', error)
    return NextResponse.json({ error: 'Duplication failed' }, { status: 500 })
  }
}
