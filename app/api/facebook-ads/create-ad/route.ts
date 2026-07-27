import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const GRAPH = 'https://graph.facebook.com/v21.0'

// Create a new ad by duplicating an existing ad's setup but swapping the
// creative video for a finished Reels Studio video.
// GET  ?action=ads&accountId=act_X    -> ads to pick as the source
// GET  ?action=adsets&accountId=act_X -> ad sets to pick as the destination
// POST { accountId, sourceAdId, adsetId, videoUrl, adCopy, adName }
//   1. reads the source ad's creative spec (page, CTA, link, thumbnail)
//   2. uploads the reel to the ad account via file_url (no bytes through us)
//   3. waits for Facebook to finish processing the video
//   4. creates a new creative: same spec, new video + new primary text
//   5. creates the ad in the chosen ad set, ACTIVE immediately

// Video processing can take a while
export const maxDuration = 300

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function GET(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')
  const accountId = searchParams.get('accountId')
  if (!accountId || !/^act_\d+$/.test(accountId)) {
    return NextResponse.json({ error: 'A valid accountId (act_...) is required' }, { status: 400 })
  }

  try {
    if (action === 'ads') {
      const res = await fetch(
        `${GRAPH}/${accountId}/ads?fields=id,name,effective_status,adset{id,name},campaign{name},creative{id,thumbnail_url}&limit=100&access_token=${token}`,
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        return NextResponse.json({ error: json.error?.message || 'Failed to list ads' }, { status: 502 })
      }
      return NextResponse.json({ success: true, ads: json.data ?? [] })
    }

    if (action === 'adsets') {
      const res = await fetch(
        `${GRAPH}/${accountId}/adsets?fields=id,name,effective_status,campaign{name},daily_budget&limit=100&access_token=${token}`,
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        return NextResponse.json({ error: json.error?.message || 'Failed to list ad sets' }, { status: 502 })
      }
      return NextResponse.json({ success: true, adsets: json.data ?? [] })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('create-ad GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch from Facebook' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })

  try {
    const body = (await request.json()) as {
      accountId?: string
      sourceAdId?: string
      adsetId?: string
      videoUrl?: string
      adCopy?: string
      adName?: string
    }
    const accountId = String(body.accountId || '')
    const sourceAdId = String(body.sourceAdId || '')
    const adsetId = String(body.adsetId || '')
    const videoUrl = String(body.videoUrl || '')
    const adCopy = String(body.adCopy || '').slice(0, 3000)
    const adName = String(body.adName || 'Reels Studio ad').slice(0, 200)

    if (!/^act_\d+$/.test(accountId) || !/^\d+$/.test(sourceAdId) || !/^\d+$/.test(adsetId)) {
      return NextResponse.json({ error: 'accountId, sourceAdId and adsetId are required' }, { status: 400 })
    }
    // Only accept videos from our own Supabase Storage reels bucket
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
    if (!videoUrl || !supabaseUrl || !videoUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/reels/`)) {
      return NextResponse.json({ error: 'No valid video URL provided' }, { status: 400 })
    }

    // 1. Source ad's creative spec: page id, CTA, link, thumbnail
    const srcRes = await fetch(
      `${GRAPH}/${sourceAdId}?fields=name,creative{id,object_story_spec,effective_object_story_spec,thumbnail_url}&access_token=${token}`,
    )
    const src = await srcRes.json()
    if (!srcRes.ok || src.error) {
      return NextResponse.json({ error: src.error?.message || 'Could not read the source ad' }, { status: 502 })
    }
    const spec = src.creative?.object_story_spec || src.creative?.effective_object_story_spec
    const pageId: string | undefined = spec?.page_id
    if (!pageId) {
      return NextResponse.json(
        { error: 'The source ad has no readable creative spec (dynamic/catalog ads cannot be used as source)' },
        { status: 422 },
      )
    }
    const srcVideoData = spec?.video_data
    const srcLinkData = spec?.link_data
    const callToAction = srcVideoData?.call_to_action ||
      srcLinkData?.call_to_action || { type: 'MESSAGE_PAGE', value: { link: `https://m.me/${pageId}` } }

    // 2. Upload the reel to the ad account - Facebook fetches the URL itself
    const upRes = await fetch(`${GRAPH}/${accountId}/advideos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: videoUrl, name: adName, access_token: token }),
    })
    const upJson = await upRes.json()
    if (!upRes.ok || upJson.error || !upJson.id) {
      return NextResponse.json({ error: upJson.error?.message || 'Video upload to the ad account failed' }, { status: 502 })
    }
    const videoId: string = upJson.id

    // 3. Wait for processing (ads cannot be created on an unprocessed video)
    let ready = false
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      const st = await fetch(`${GRAPH}/${videoId}?fields=status&access_token=${token}`)
      const stJson = await st.json()
      const s = stJson.status?.video_status
      if (s === 'ready') {
        ready = true
        break
      }
      if (s === 'error') {
        return NextResponse.json({ error: 'Facebook failed to process the video' }, { status: 502 })
      }
    }
    if (!ready) {
      return NextResponse.json({ error: 'Video is still processing - try again in a minute' }, { status: 504 })
    }

    // Thumbnail: prefer the new video's own, fall back to the source ad's
    let imageUrl: string | undefined
    const thumbRes = await fetch(`${GRAPH}/${videoId}/thumbnails?access_token=${token}`)
    const thumbJson = await thumbRes.json()
    const thumbs: { uri: string; is_preferred?: boolean }[] = thumbJson.data ?? []
    imageUrl = (thumbs.find((t) => t.is_preferred) || thumbs[0])?.uri
    if (!imageUrl) imageUrl = srcVideoData?.image_url || src.creative?.thumbnail_url
    if (!imageUrl) {
      return NextResponse.json({ error: 'No thumbnail available for the new video yet - try again shortly' }, { status: 502 })
    }

    // 4. New creative: same page + CTA as the source, new video + copy
    const creativeRes = await fetch(`${GRAPH}/${accountId}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: adName,
        object_story_spec: {
          page_id: pageId,
          video_data: {
            video_id: videoId,
            message: adCopy,
            image_url: imageUrl,
            ...(srcVideoData?.title ? { title: srcVideoData.title } : {}),
            call_to_action: callToAction,
          },
        },
        access_token: token,
      }),
    })
    const creativeJson = await creativeRes.json()
    if (!creativeRes.ok || creativeJson.error || !creativeJson.id) {
      return NextResponse.json({ error: creativeJson.error?.message || 'Creating the ad creative failed' }, { status: 502 })
    }

    // 5. The ad itself - ACTIVE immediately in the chosen ad set
    const adRes = await fetch(`${GRAPH}/${accountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: adName,
        adset_id: adsetId,
        creative: { creative_id: creativeJson.id },
        status: 'ACTIVE',
        access_token: token,
      }),
    })
    const adJson = await adRes.json()
    if (!adRes.ok || adJson.error || !adJson.id) {
      return NextResponse.json({ error: adJson.error?.message || 'Creating the ad failed' }, { status: 502 })
    }

    return NextResponse.json({ success: true, adId: adJson.id, videoId, creativeId: creativeJson.id, status: 'ACTIVE' })
  } catch (error) {
    console.error('create-ad POST error:', error)
    return NextResponse.json({ error: 'Ad creation failed' }, { status: 500 })
  }
}
