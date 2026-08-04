import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getManageablePages } from '@/lib/facebook/pages'
import { fbPostJson, fbDetail } from '@/lib/facebook/write'

export const maxDuration = 300

const FACEBOOK_GRAPH_URL = 'https://graph.facebook.com/v21.0'

/** Testing spend is always $1/day, clamped server-side. */
const DEFAULT_DAILY_BUDGET_USD = 1

/**
 * Publish the organic post FIRST, then boost that same post N hours later.
 *
 * The delay is the whole point: an ad built on a post that already carries
 * likes and comments inherits that social proof, whereas an ad created at the
 * same instant as its post starts from zero.
 *
 * Every transition is guarded by a status check (pending -> posted -> boosted)
 * so a retry, a double-click, or two overlapping cron runs cannot publish the
 * post twice or create the ad twice.
 */

interface SyncRow {
  id: string
  post_id: string | null
  page_id: string | null
  message: string | null
  image_url: string | null
  publish_at: string | null
  boost_after_hours: number
  boost_at: string | null
  adset_id: string | null
  daily_budget_usd: number
  status: string
  created_ad_id: string | null
}

/** Schedule a new post -> boost job. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()
    const pageId: string | undefined = typeof body?.pageId === 'string' ? body.pageId : undefined
    const message: string = typeof body?.message === 'string' ? body.message : ''
    const imageUrl: string | null = typeof body?.imageUrl === 'string' ? body.imageUrl : null
    const productId: string | null = typeof body?.productId === 'string' ? body.productId : null
    const adsetId: string | null = typeof body?.adsetId === 'string' ? body.adsetId : null
    // An already-published post can be scheduled for boosting too
    const existingPostId: string | null = typeof body?.postId === 'string' ? body.postId : null

    // Clamp the delay to something sane. 0 would defeat the purpose of the
    // feature, and a year-long delay is certainly a mistake.
    const rawHours = Number(body?.boostAfterHours)
    const boostAfterHours = Number.isFinite(rawHours) ? Math.min(Math.max(Math.round(rawHours), 1), 720) : 24

    if (!pageId) return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
    if (!existingPostId && !message.trim() && !imageUrl) {
      return NextResponse.json({ error: 'A message or image is required to publish a post' }, { status: 400 })
    }

    const publishAt = body?.publishAt ? new Date(body.publishAt) : new Date()
    const publishIso = Number.isFinite(publishAt.getTime()) ? publishAt.toISOString() : new Date().toISOString()
    // If the post already exists, the boost clock starts now.
    const boostAt = new Date(
      (existingPostId ? Date.now() : new Date(publishIso).getTime()) + boostAfterHours * 3_600_000,
    ).toISOString()

    const { data, error } = await supabase
      .from('post_ad_sync')
      .insert({
        product_id: productId,
        page_id: pageId,
        post_id: existingPostId,
        message: message || null,
        image_url: imageUrl,
        publish_at: publishIso,
        boost_after_hours: boostAfterHours,
        boost_at: boostAt,
        adset_id: adsetId,
        daily_budget_usd: DEFAULT_DAILY_BUDGET_USD,
        status: existingPostId ? 'posted' : 'pending',
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, job: data })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to schedule the post' },
      { status: 500 },
    )
  }
}

/** List scheduled jobs. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('post_ad_sync')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ jobs: data ?? [] })
}

/**
 * Runner: publish anything due, boost anything ripe.
 *
 * Called from the UI ("Run due jobs") rather than an unattended cron, matching
 * the same suggest-only posture as the kill rule - this creates ads that spend
 * money, so a human stays in the loop.
 */
export async function PATCH() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  if (!accessToken) {
    return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const results: Array<{ id: string; action: string; ok: boolean; detail?: string }> = []

  try {
    const pages = await getManageablePages(accessToken).catch(() => [])
    const tokenFor = (pageId: string) =>
      pages.find((p) => p.id === pageId)?.access_token || accessToken

    // ── 1. Publish due posts ──
    const { data: toPost } = await supabase
      .from('post_ad_sync')
      .select('*')
      .eq('status', 'pending')
      .lte('publish_at', now)
    for (const job of (toPost ?? []) as SyncRow[]) {
      if (!job.page_id) continue
      // Claim the row before calling Facebook. If two runners overlap, only one
      // sees status still 'pending', so the post cannot be published twice.
      const { data: claimed } = await supabase
        .from('post_ad_sync')
        .update({ status: 'posting', updated_at: now })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('id')
      if (!claimed || claimed.length === 0) continue

      const pageToken = tokenFor(job.page_id)
      const endpoint = job.image_url ? 'photos' : 'feed'
      const payload: Record<string, unknown> = job.image_url
        ? { url: job.image_url, caption: job.message ?? '', access_token: pageToken }
        : { message: job.message ?? '', access_token: pageToken }

      const res = await fbPostJson(`${FACEBOOK_GRAPH_URL}/${job.page_id}/${endpoint}`, payload)
      if (res.ok) {
        const rawId = (res.json.post_id as string) || (res.json.id as string)
        const postId = rawId?.includes('_') ? rawId : `${job.page_id}_${rawId}`
        await supabase
          .from('post_ad_sync')
          .update({
            post_id: postId,
            status: 'posted',
            // Boost clock starts at ACTUAL publish time, not the planned one,
            // so a job that ran late still gets its full engagement window.
            boost_at: new Date(Date.now() + job.boost_after_hours * 3_600_000).toISOString(),
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        results.push({ id: job.id, action: 'posted', ok: true, detail: postId })
      } else {
        await supabase
          .from('post_ad_sync')
          .update({ status: 'failed', error: fbDetail(res.json.error) || 'Publish failed', updated_at: new Date().toISOString() })
          .eq('id', job.id)
        results.push({ id: job.id, action: 'post', ok: false, detail: fbDetail(res.json.error) })
      }
    }

    // ── 2. Boost ripe posts ──
    const { data: toBoost } = await supabase
      .from('post_ad_sync')
      .select('*')
      .eq('status', 'posted')
      .lte('boost_at', now)
    for (const job of (toBoost ?? []) as SyncRow[]) {
      if (!job.post_id || !job.adset_id) {
        results.push({
          id: job.id,
          action: 'boost',
          ok: false,
          detail: job.adset_id ? 'Missing post id' : 'No ad set chosen for this job',
        })
        continue
      }
      const { data: claimed } = await supabase
        .from('post_ad_sync')
        .update({ status: 'boosting', updated_at: now })
        .eq('id', job.id)
        .eq('status', 'posted')
        .select('id')
      if (!claimed || claimed.length === 0) continue

      // Resolve the ad account that owns the target ad set
      const asRes = await fetch(`${FACEBOOK_GRAPH_URL}/${job.adset_id}?fields=account_id&access_token=${accessToken}`)
      const asJson = await asRes.json()
      const accountId: string | undefined = asJson?.account_id
      if (!accountId) {
        await supabase
          .from('post_ad_sync')
          .update({ status: 'posted', error: 'Could not resolve the ad account', updated_at: new Date().toISOString() })
          .eq('id', job.id)
        results.push({ id: job.id, action: 'boost', ok: false, detail: 'Could not resolve the ad account' })
        continue
      }

      const creative = await fbPostJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/adcreatives`, {
        name: `Boost ${job.post_id}`,
        object_story_id: job.post_id,
        access_token: accessToken,
      })
      if (!creative.ok || !creative.json.id) {
        // Back to 'posted' rather than 'failed': the post is live and healthy,
        // only the boost failed, so a later run can retry it.
        await supabase
          .from('post_ad_sync')
          .update({ status: 'posted', error: fbDetail(creative.json.error) || 'Creative failed', updated_at: new Date().toISOString() })
          .eq('id', job.id)
        results.push({ id: job.id, action: 'boost', ok: false, detail: fbDetail(creative.json.error) })
        continue
      }

      const ad = await fbPostJson(`${FACEBOOK_GRAPH_URL}/act_${accountId}/ads`, {
        name: `Boosted ${new Date().toISOString().slice(0, 10)}`,
        adset_id: job.adset_id,
        creative: { creative_id: creative.json.id },
        status: 'PAUSED',
        access_token: accessToken,
      })
      if (ad.ok && ad.json.id) {
        await supabase
          .from('post_ad_sync')
          .update({ status: 'boosted', created_ad_id: ad.json.id as string, error: null, updated_at: new Date().toISOString() })
          .eq('id', job.id)
        results.push({ id: job.id, action: 'boosted', ok: true, detail: ad.json.id as string })
      } else {
        await supabase
          .from('post_ad_sync')
          .update({ status: 'posted', error: fbDetail(ad.json.error) || 'Ad creation failed', updated_at: new Date().toISOString() })
          .eq('id', job.id)
        results.push({ id: job.id, action: 'boost', ok: false, detail: fbDetail(ad.json.error) })
      }
    }

    return NextResponse.json({ success: true, processed: results.length, results })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Runner failed', results },
      { status: 500 },
    )
  }
}
