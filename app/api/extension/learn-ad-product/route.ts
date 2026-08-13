import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const accessToken = authHeader.replace('Bearer ', '')
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const {
    data: { user },
    error,
  } = await adminSupabase.auth.getUser(accessToken)
  if (error || !user) return null
  return { user, supabase: adminSupabase }
}

/**
 * POST /api/extension/learn-ad-product  { adId, productId }
 *
 * Root-cause fix for "the ad is not being taken". Product linkage is stored per
 * CAMPAIGN in campaign_product_links, so a campaign with no row can never
 * resolve a product - for any ad in it, for any client, forever. Instead of
 * guessing on the client every time, we learn from what the agent actually did:
 * the first time someone sells a product against an unmapped campaign, we write
 * the link. Every future client from that campaign then resolves instantly.
 *
 * Deliberately conservative: an existing link is NEVER overwritten, because a
 * human mapping (or an earlier learned one) must win over a fresh guess.
 */
export async function POST(request: NextRequest) {
  try {
    const tokenAuth = await getUserFromToken(request)
    let user: { id: string } | null = tokenAuth?.user ?? null
    let supabase = tokenAuth?.supabase
    if (!user) {
      const cookieSupabase = await createClient()
      const {
        data: { user: cookieUser },
      } = await cookieSupabase.auth.getUser()
      user = cookieUser
      supabase = cookieSupabase as any
    }
    if (!user || !supabase) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }

    const body = await request.json().catch(() => ({}))
    const adId = String(body?.adId ?? '').trim()
    const productId = String(body?.productId ?? '').trim()
    if (!/^\d+$/.test(adId) || !productId) {
      return NextResponse.json({ success: false, error: 'adId and productId required' }, { status: 400, headers: corsHeaders })
    }

    // The product must be real before we teach anything from it.
    const { data: product } = await supabase.from('products').select('id, name').eq('id', productId).single()
    if (!product) {
      return NextResponse.json({ success: false, error: 'Unknown product' }, { status: 400, headers: corsHeaders })
    }

    const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Facebook access token not configured' }, { status: 500, headers: corsHeaders })
    }

    // ad -> campaign, the same hop resolve-ad uses
    const metaRes = await fetch(
      `${FACEBOOK_GRAPH_URL}/${adId}?fields=campaign_id,campaign{name},account_id&access_token=${accessToken}`,
    )
    const metaData = await metaRes.json()
    const campaignId = metaData?.campaign_id
    if (!campaignId) {
      return NextResponse.json({ success: true, learned: false, reason: 'no campaign for ad' }, { headers: corsHeaders })
    }

    // Never clobber an existing mapping.
    const { data: existing } = await supabase
      .from('campaign_product_links')
      .select('campaign_id, product_id')
      .eq('campaign_id', campaignId)
      .maybeSingle()

    if (existing?.product_id) {
      return NextResponse.json(
        { success: true, learned: false, reason: 'already linked', campaignId },
        { headers: corsHeaders },
      )
    }

    const { error: upsertError } = await supabase.from('campaign_product_links').upsert(
      {
        campaign_id: campaignId,
        campaign_name: metaData?.campaign?.name ?? null,
        product_id: productId,
        account_id: metaData?.account_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'campaign_id' },
    )

    if (upsertError) {
      return NextResponse.json({ success: false, error: upsertError.message }, { status: 500, headers: corsHeaders })
    }

    return NextResponse.json(
      { success: true, learned: true, campaignId, product: { id: product.id, name: product.name } },
      { headers: corsHeaders },
    )
  } catch (error) {
    console.error('learn-ad-product error:', error)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500, headers: corsHeaders })
  }
}
