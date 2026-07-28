import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getManageablePages } from '@/lib/facebook/pages'
import { fbGet } from '@/lib/facebook/graph'

// Video-processing polls + backoff retries can exceed the default duration
export const maxDuration = 300

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Facebook throttling codes (#4 app-level, #17 user-level, #32 page-level,
// #613 custom, 8000x ads-specific). Writes retry through these with backoff
// so a boost never dies halfway because the hourly window was momentarily full.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004])
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function postJson(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; json: Record<string, unknown> & { error?: { message?: string; code?: number; error_subcode?: number; error_user_title?: string; error_user_msg?: string } } }> {
  const waits = [2000, 8000, 30000]
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && !json.error) return { ok: true, json }
    const code = json.error?.code as number | undefined
    if (attempt < waits.length && code !== undefined && RATE_LIMIT_CODES.has(code)) {
      await sleep(waits[attempt])
      continue
    }
    return { ok: false, json }
  }
}

// A creative built on a just-published video post fails with Facebook's
// transient "Something went wrong" (code 1/2) until the video finishes
// processing. This resolves the REAL post id (video posts sometimes get a
// feed id different from pageId_videoId) and waits until the object is ready.
async function resolveBoostPost(
  boostPostId: string,
  userToken: string,
): Promise<{ postId: string; ready: boolean }> {
  const [pageId, objectId] = boostPostId.split('_')
  let pageToken = userToken
  try {
    const pages = await getManageablePages(userToken)
    pageToken = pages.find((p) => p.id === pageId)?.access_token || userToken
  } catch {
    /* page token is a nice-to-have */
  }
  const enc = encodeURIComponent(pageToken)

  // Wait for video processing (poll up to ~50s)
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${FACEBOOK_GRAPH_URL}/${objectId}?fields=status&access_token=${enc}`)
      const json = await res.json()
      const status: string | undefined = json?.status?.video_status
      if (!res.ok || json.error || status === undefined) break // not a video - nothing to wait for
      if (status === 'ready') break
      if (status === 'error') return { postId: boostPostId, ready: false }
      await sleep(5000)
    } catch {
      break
    }
  }

  // Confirm the composite post id exists; if not, find the feed post that
  // wraps this video (its attachment target id equals the video id)
  try {
    const check = await fetch(`${FACEBOOK_GRAPH_URL}/${boostPostId}?fields=id&access_token=${enc}`)
    const checkJson = await check.json()
    if (check.ok && checkJson.id) return { postId: boostPostId, ready: true }
    const feed = await fetch(
      `${FACEBOOK_GRAPH_URL}/${pageId}/posts?fields=id,attachments{target{id}}&limit=25&access_token=${enc}`,
    )
    const feedJson = await feed.json()
    for (const post of feedJson.data || []) {
      const targets = (post.attachments?.data || []).map((a: { target?: { id?: string } }) => a.target?.id)
      if (targets.includes(objectId)) return { postId: post.id, ready: true }
    }
  } catch {
    /* fall through with the original id */
  }
  return { postId: boostPostId, ready: true }
}

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
      // Discovers via /me/accounts AND ad-account promote_pages, because
      // Facebook hides pages that weren't ticked during the app login flow
      const pages = await getManageablePages(accessToken)
      if (pages.length === 0) {
        return NextResponse.json({ error: 'Failed to list pages' }, { status: 502 })
      }
      return NextResponse.json({ pages: pages.map((p) => ({ id: p.id, name: p.name })) })
    }

    if (action === 'posts') {
      const pageId = searchParams.get('pageId')
      if (!pageId) {
        return NextResponse.json({ error: 'pageId required' }, { status: 400 })
      }
      // Use the page's own token so unpublished/dark posts are included too
      const pages = await getManageablePages(accessToken)
      const page = pages.find((p) => p.id === pageId)
      const pageToken: string = page?.access_token || accessToken
      // Cached 2 min: opening the picker repeatedly must not burn quota
      let json: { data?: Array<{ id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string }> }
      try {
        json = await fbGet(
          `${FACEBOOK_GRAPH_URL}/${pageId}/posts?fields=id,message,created_time,permalink_url,full_picture&limit=50&access_token=${encodeURIComponent(pageToken)}`,
          { cacheTtl: 2 * 60 * 1000 },
        )
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to list posts' }, { status: 502 })
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

    const fbDetail = (err: { error_user_title?: string; error_user_msg?: string; message?: string } | undefined) =>
      [err?.error_user_title, err?.error_user_msg].filter(Boolean).join(': ') || err?.message || ''

    // ---- BOOST PATH: rebuild instead of deep copy -------------------------
    // Deep copy drags the source ads' creatives along, and Facebook rejects
    // any that contain the deprecated standard_enhancements field. Since a
    // boost replaces every creative anyway, we rebuild: shallow-copy the
    // campaign (budget/objective), recreate each ad set (targeting/schedule)
    // pointed at the post's page, then create one fresh ad per ad set.
    if (boostPostId) {
      const postPageId = boostPostId.split('_')[0]

      // Fresh video posts need processing time + sometimes a different feed id
      const resolved = await resolveBoostPost(boostPostId, accessToken)
      if (!resolved.ready) {
        return NextResponse.json(
          { error: 'Facebook could not process the video for this post. Re-publish it and try again.' },
          { status: 502 },
        )
      }
      const storyId = resolved.postId

      // Source config: campaign + its ad sets
      const srcRes = await fetch(
        `${FACEBOOK_GRAPH_URL}/${campaignId}?fields=account_id,lifetime_budget,adsets.limit(100){targeting,optimization_goal,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,promoted_object,destination_type,end_time,adset_schedule,pacing_type}&access_token=${accessToken}`,
      )
      const src = await srcRes.json()
      if (!srcRes.ok || src.error) {
        return NextResponse.json({ error: fbDetail(src.error) || 'Could not read the source campaign' }, { status: 502 })
      }
      const accountId: string = src.account_id
      const srcAdsets: Array<{
        targeting?: unknown
        optimization_goal?: string
        billing_event?: string
        bid_strategy?: string
        bid_amount?: number
        daily_budget?: string
        lifetime_budget?: string
        promoted_object?: { page_id?: string; [k: string]: unknown }
        destination_type?: string
        end_time?: string
        adset_schedule?: unknown
        pacing_type?: unknown
      }> = src.adsets?.data || []
      if (srcAdsets.length === 0) {
        return NextResponse.json({ error: 'The source campaign has no ad sets to copy' }, { status: 400 })
      }

      // 1. Shallow copy the campaign (objective, budget, special categories)
      const shell = await postJson(`${FACEBOOK_GRAPH_URL}/${campaignId}/copies`, {
        deep_copy: false,
        status_option: 'PAUSED',
        access_token: accessToken,
      })
      const newCampaignId: string | undefined =
        (shell.json.copied_campaign_id as string) || (shell.json.id as string)
      if (!shell.ok || !newCampaignId) {
        return NextResponse.json(
          { error: fbDetail(shell.json.error) || 'Facebook rejected the campaign copy' },
          { status: 502 },
        )
      }
      await postJson(`${FACEBOOK_GRAPH_URL}/${newCampaignId}`, { name: commonName, access_token: accessToken })

      // 2. One boost creative for the whole campaign. Messaging destinations
      // (Messenger/WhatsApp) need the multi-destination asset_feed_spec plus
      // individual enhancement features (standard_enhancements is deprecated).
      const isMessaging = srcAdsets.some((a) => /MESSENGER|WHATSAPP|MESSAGING/.test(a.destination_type || ''))
      const creativeBody: Record<string, unknown> = {
        name: `${commonName} - boosted post`,
        object_story_id: storyId,
        access_token: accessToken,
      }
      if (isMessaging) {
        creativeBody.asset_feed_spec = {
          optimization_type: 'DOF_MESSAGING_DESTINATION',
          call_to_actions: [
            { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER', link: 'https://fb.com/messenger_doc/' } },
            { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP', link: 'https://api.whatsapp.com/send' } },
          ],
        }
        creativeBody.degrees_of_freedom_spec = {
          creative_features_spec: {
            image_brightness_and_contrast: { enroll_status: 'OPT_OUT' },
            enhance_cta: { enroll_status: 'OPT_OUT' },
            text_optimizations: { enroll_status: 'OPT_OUT' },
          },
        }
      }
      // Codes 1/2 = Facebook's transient "Something went wrong. Please try
      // again later" - common right after publishing while the post settles.
      // Retry those too, on top of postJson's built-in rate-limit retries.
      let creative = await postJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/adcreatives`, creativeBody)
      for (const wait of [8000, 20000]) {
        if (creative.ok) break
        const code = creative.json.error?.code
        if (code !== 1 && code !== 2) break
        await sleep(wait)
        creative = await postJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/adcreatives`, creativeBody)
      }
      if (!creative.ok) {
        const code = creative.json.error?.code
        const hint =
          code === 1 || code === 2
            ? ' The post may still be settling on Facebook - wait a minute and hit Duplicate again.'
            : ''
        return NextResponse.json(
          { error: (fbDetail(creative.json.error) || 'Could not create the boost creative') + hint, newCampaignId },
          { status: 502 },
        )
      }
      const creativeId = creative.json.id as string

      // 3. Recreate each ad set + one fresh ad inside it
      let adSetCount = 0
      let adCount = 0
      let failures = 0
      let lastError = ''
      const startTime = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      const defaultEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
      const campaignHasLifetime = Boolean(src.lifetime_budget)

      for (const as of srcAdsets) {
        const adsetBody: Record<string, unknown> = {
          name: commonName,
          campaign_id: newCampaignId,
          targeting: as.targeting,
          optimization_goal: as.optimization_goal,
          billing_event: as.billing_event,
          status: 'PAUSED',
          start_time: startTime,
          // The post's page replaces the source page so the boosted post and
          // the promoted page always match (Facebook requires this)
          promoted_object: { page_id: postPageId },
          access_token: accessToken,
        }
        if (as.end_time) adsetBody.end_time = as.end_time
        else if (campaignHasLifetime || as.lifetime_budget) adsetBody.end_time = defaultEnd
        if (as.bid_strategy) adsetBody.bid_strategy = as.bid_strategy
        if (as.bid_amount) adsetBody.bid_amount = as.bid_amount
        if (as.daily_budget) adsetBody.daily_budget = as.daily_budget
        if (as.lifetime_budget) adsetBody.lifetime_budget = as.lifetime_budget
        if (as.destination_type) adsetBody.destination_type = as.destination_type
        if (as.adset_schedule) adsetBody.adset_schedule = as.adset_schedule
        if (as.pacing_type) adsetBody.pacing_type = as.pacing_type

        const asResult = await postJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/adsets`, adsetBody)
        if (!asResult.ok || !asResult.json.id) {
          failures++
          lastError = fbDetail(asResult.json.error) || lastError
          continue
        }
        adSetCount++

        const adResult = await postJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/ads`, {
          name: commonName,
          adset_id: asResult.json.id,
          creative: { creative_id: creativeId },
          status: 'PAUSED',
          access_token: accessToken,
        })
        if (adResult.ok && adResult.json.id) adCount++
        else {
          failures++
          lastError = fbDetail(adResult.json.error) || lastError
        }
      }

      if (adCount === 0) {
        return NextResponse.json(
          { error: lastError || 'The campaign copy was created but no ads could be built', newCampaignId },
          { status: 502 },
        )
      }

      // Verify by reading the tree back from Facebook - the success screen
      // reports CONFIRMED counts, not just what the create calls claimed
      let verified: { adSets: number; ads: number } | undefined
      try {
        const check = await fetch(
          `${FACEBOOK_GRAPH_URL}/${newCampaignId}?fields=adsets.limit(100){id,ads.limit(10){id}}&access_token=${accessToken}`,
        )
        const checkJson = await check.json()
        if (check.ok && !checkJson.error) {
          const sets: Array<{ ads?: { data?: unknown[] } }> = checkJson.adsets?.data || []
          verified = {
            adSets: sets.length,
            ads: sets.reduce((n, s) => n + (s.ads?.data?.length || 0), 0),
          }
        }
      } catch {
        /* verification is best-effort */
      }

      return NextResponse.json({
        success: true,
        newCampaignId,
        commonName,
        renamed: { campaign: 1, adSets: adSetCount, ads: adCount },
        boosted: { post: boostPostId, ads: adCount, error: lastError || undefined },
        verified,
        adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId}&selected_campaign_ids=${newCampaignId}`,
        failures,
        status: 'PAUSED',
      })
    }

    // ---- NO-BOOST PATH: plain deep copy + rename --------------------------
    // 1. Deep copy: clones ad sets + ads, starts PAUSED
    const copyResult = await postJson(`${FACEBOOK_GRAPH_URL}/${campaignId}/copies`, {
      deep_copy: true,
      status_option: 'PAUSED',
      access_token: accessToken,
    })
    const copyJson = copyResult.json
    if (!copyResult.ok) {
      // Surface Facebook's human-readable details - "Invalid parameter" alone
      // hides the actual reason (e.g. objective not copyable, account limits)
      let detail = fbDetail(copyJson.error) || 'Facebook rejected the campaign copy'
      // Legacy creatives with the deprecated standard_enhancements field
      // cannot be deep-copied at all - but the boost path rebuilds the ads
      // with fresh creatives, so it sidesteps the problem entirely
      if (copyJson.error?.error_subcode === 3858504 || /standard enhancements/i.test(detail)) {
        detail += ' Tip: select a "Post to boost" - that path rebuilds the ads with fresh creatives and avoids this Facebook limitation.'
      }
      return NextResponse.json({ error: detail }, { status: 502 })
    }
    // /copies returns { copied_campaign_id } (sometimes { id })
    const newCampaignId: string | undefined =
      (copyJson.copied_campaign_id as string | undefined) || (copyJson.id as string | undefined)
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

    // 3. Rename everything to the SAME common name (retries on rate limit)
    const rename = async (id: string) => {
      const r = await postJson(`${FACEBOOK_GRAPH_URL}/${id}`, { name: commonName, access_token: accessToken })
      return r.ok
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
