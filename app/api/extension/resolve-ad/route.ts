import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Validate the extension's bearer token and return an admin client for querying
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const accessToken = authHeader.replace('Bearer ', '')
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user }, error } = await adminSupabase.auth.getUser(accessToken)
  if (error || !user) return null
  return { user, supabase: adminSupabase }
}

// GET /api/extension/resolve-ad?adId=123 -> resolves the product linked to the ad's campaign
export async function GET(request: NextRequest) {
  try {
    // Auth (token first, then cookie fallback for dashboard usage)
    const tokenAuth = await getUserFromToken(request)
    let user: { id: string } | null = tokenAuth?.user ?? null
    let supabase = tokenAuth?.supabase
    if (!user) {
      const cookieSupabase = await createClient()
      const { data: { user: cookieUser } } = await cookieSupabase.auth.getUser()
      user = cookieUser
      supabase = cookieSupabase as any
    }
    if (!user || !supabase) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }

    const adId = request.nextUrl.searchParams.get('adId')?.trim()
    if (!adId || !/^\d+$/.test(adId)) {
      return NextResponse.json({ success: true, product: null }, { headers: corsHeaders })
    }

    const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Facebook access token not configured' }, { status: 500, headers: corsHeaders })
    }

    // Ask Meta which campaign this ad belongs to
    const metaRes = await fetch(`${FACEBOOK_GRAPH_URL}/${adId}?fields=campaign_id&access_token=${accessToken}`)
    const metaData = await metaRes.json()
    const campaignId = metaData?.campaign_id
    if (!campaignId) {
      // Ad not found or has no campaign - not an error, just no match
      return NextResponse.json({ success: true, product: null }, { headers: corsHeaders })
    }

    // Look up the product linked to that campaign
    const { data: link } = await supabase
      .from('campaign_product_links')
      .select('product_id, products ( id, name, price )')
      .eq('campaign_id', campaignId)
      .single()

    const product = link?.products || null
    return NextResponse.json({ success: true, campaignId, product }, { headers: corsHeaders })
  } catch (error) {
    console.error('resolve-ad error:', error)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500, headers: corsHeaders })
  }
}
