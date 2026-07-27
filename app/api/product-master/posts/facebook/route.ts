import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Pulls ALL existing Facebook ad posts (creative text) from the cached
// campaigns, attributes each to an inventory product via
// campaign_product_links, and returns them for the Manage Posts dialog.
// These are the user's real, live posts - importable into product_posts.

interface CachedAd {
  id: string
  postId?: string
}

interface CachedCampaign {
  id: string
  name: string
  status: string
  accountId: string
  ads?: CachedAd[]
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) {
      return NextResponse.json({ success: false, error: 'Facebook token not configured' }, { status: 500 })
    }

    const admin = createAdminClient()
    const [{ data: cache }, { data: links }, { data: products }, { data: imported }] = await Promise.all([
      admin.from('ads_cache').select('campaigns').eq('cache_key', 'today_spend').single(),
      admin.from('campaign_product_links').select('campaign_id, product_id'),
      admin.from('products').select('id, name'),
      // Already-imported FB posts (tracked via source ad id in post_type suffix-free content)
      admin.from('product_posts').select('content').eq('post_type', 'fb_imported'),
    ])

    const campaigns = (cache?.campaigns ?? []) as CachedCampaign[]
    const productById = new Map((products ?? []).map((p) => [p.id, p.name]))
    const productByCampaign = new Map((links ?? []).map((l) => [l.campaign_id, l.product_id]))
    const importedAdIds = new Set(
      (imported ?? []).map((r) => (r.content as { sourceAdId?: string })?.sourceAdId).filter(Boolean),
    )

    // Collect ad ids - ACTIVE campaigns first so live posts always make the
    // cut, then recent paused ones (cap at 300 = 6 Graph batch calls)
    const adMeta: { adId: string; campaign: CachedCampaign }[] = []
    const sorted = [...campaigns].sort((a, b) => {
      const aActive = a.status === 'ACTIVE' ? 0 : 1
      const bActive = b.status === 'ACTIVE' ? 0 : 1
      return aActive - bActive
    })
    for (const c of sorted) {
      for (const ad of c.ads ?? []) {
        if (ad.id) adMeta.push({ adId: ad.id, campaign: c })
      }
    }
    const capped = adMeta.slice(0, 300)

    // Batch-fetch creatives, 50 ids per request (Graph API limit).
    // effective_object_story_id (pageId_postId) gives the post permalink.
    const creatives = new Map<
      string,
      { body?: string; title?: string; name?: string; status?: string; postUrl?: string }
    >()
    for (let i = 0; i < capped.length; i += 50) {
      const ids = capped
        .slice(i, i + 50)
        .map((a) => a.adId)
        .join(',')
      const url = `https://graph.facebook.com/v21.0/?ids=${ids}&fields=name,status,creative{body,title,effective_object_story_id}&access_token=${encodeURIComponent(token)}`
      const res = await fetch(url)
      if (!res.ok) continue
      const json = (await res.json()) as Record<
        string,
        {
          name?: string
          status?: string
          creative?: { body?: string; title?: string; effective_object_story_id?: string }
        }
      >
      for (const [id, ad] of Object.entries(json)) {
        const storyId = ad.creative?.effective_object_story_id
        creatives.set(id, {
          body: ad.creative?.body,
          title: ad.creative?.title,
          name: ad.name,
          status: ad.status,
          postUrl: storyId ? `https://www.facebook.com/${storyId}` : undefined,
        })
      }
    }

    // Deduplicate identical creative bodies (same post reused across ads)
    const seenBodies = new Set<string>()
    const posts = capped
      .map(({ adId, campaign }) => {
        const cr = creatives.get(adId)
        if (!cr?.body) return null
        const bodyKey = cr.body.slice(0, 200)
        if (seenBodies.has(bodyKey)) return null
        seenBodies.add(bodyKey)
        const productId = productByCampaign.get(campaign.id) ?? null
        return {
          adId,
          adName: cr.name ?? '',
          adStatus: cr.status ?? 'UNKNOWN',
          campaignId: campaign.id,
          campaignName: campaign.name,
          title: cr.title ?? '',
          body: cr.body,
          postUrl: cr.postUrl ?? null,
          productId,
          productName: productId ? (productById.get(productId) ?? null) : null,
          imported: importedAdIds.has(adId),
        }
      })
      .filter(Boolean)

    return NextResponse.json({ success: true, posts, totalAds: adMeta.length })
  } catch (error) {
    console.error('facebook posts error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load Facebook posts' }, { status: 500 })
  }
}

// POST: import a Facebook post into product_posts so it becomes managed
// and feeds the AI knowledge centre for its product
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const adId: string = String(body?.adId || '')
    const text: string = String(body?.body || '').slice(0, 6000)
    const productId: string | null = body?.productId ? String(body.productId) : null
    const productName: string = String(body?.productName || body?.campaignName || 'Unknown product').slice(0, 200)

    if (!adId || !text) {
      return NextResponse.json({ success: false, error: 'adId and body are required' }, { status: 400 })
    }

    // First line is a natural hook; rest is the body
    const lines = text.split('\n').filter((l) => l.trim())
    const hook = (lines[0] ?? '').slice(0, 500)
    const rest = lines.slice(1).join('\n').slice(0, 4000)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('product_posts')
      .insert({
        product_id: productId,
        product_name: productName,
        post_type: 'fb_imported',
        tone: 'imported',
        language: 'en',
        content: {
          hook,
          body: rest,
          cta: '',
          hashtags: '',
          raw: text,
          sourceAdId: adId,
          sourceCampaign: String(body?.campaignName || '').slice(0, 200),
          postUrl: body?.postUrl ? String(body.postUrl).slice(0, 500) : '',
        },
        offers_used: [],
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) throw error

    return NextResponse.json({ success: true, id: data.id })
  } catch (error) {
    console.error('facebook post import error:', error)
    return NextResponse.json({ success: false, error: 'Failed to import post' }, { status: 500 })
  }
}
