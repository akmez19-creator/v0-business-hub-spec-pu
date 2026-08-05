import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

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
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: { user }, error } = await adminSupabase.auth.getUser(accessToken)
  if (error || !user) return null
  return { user, supabase: adminSupabase }
}

/** One selectable ad in the extension's picker. */
interface AdOption {
  /** The ad id stored on deliveries.ad_id - this is what gets submitted. */
  id: string
  /** Campaign name, shown as the ad's label in the picker. */
  name: string
  campaignId: string
  /** Currently running, so it sorts to the top of the picker. */
  active: boolean
  spend: number
  productId: string | null
  productName: string | null
}

type CachedCampaign = {
  id: string
  name: string
  status: string
  spend?: string
  ads?: { id: string; postId: string | null }[]
}

/**
 * GET /api/extension/list-ads
 *
 * Lists the ads the agent can attribute an order to, so they can pick the
 * right one from Business Suite instead of relying on auto-capture alone.
 *
 * Reads `ads_cache` (populated by /api/facebook-ads/cached) rather than
 * calling Meta directly - the picker opens instantly and costs no Graph
 * quota. The cache already carries each campaign's ads[], name and spend.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth (extension bearer token first, then cookie fallback for dashboard)
    const tokenAuth = await getUserFromToken(request)
    let user: { id: string } | null = tokenAuth?.user ?? null
    if (!user) {
      const cookieSupabase = await createClient()
      const { data: { user: cookieUser } } = await cookieSupabase.auth.getUser()
      user = cookieUser
    }
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }

    // Read with the service role: the ads cache and campaign links are shared
    // reference data, not per-user rows, so RLS would only get in the way.
    const supabase =
      tokenAuth?.supabase ??
      createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data: cached } = await supabase
      .from('ads_cache')
      .select('campaigns, last_refresh')
      .eq('cache_key', 'today_spend')
      .maybeSingle()

    const campaigns: CachedCampaign[] = (cached?.campaigns as CachedCampaign[]) || []
    if (campaigns.length === 0) {
      // No cache yet - the dashboard populates it on first load.
      return NextResponse.json(
        { success: true, ads: [], lastRefresh: null, note: 'Ads cache is empty. Open the Ads dashboard once to populate it.' },
        { headers: corsHeaders },
      )
    }

    // campaign -> product, so the agent sees what each ad is actually selling
    const { data: links } = await supabase
      .from('campaign_product_links')
      .select('campaign_id, product_id, products ( id, name )')

    const productByCampaign = new Map<string, { id: string; name: string }>()
    for (const l of (links || []) as { campaign_id: string; product_id: string; products?: { id: string; name: string } | { id: string; name: string }[] }[]) {
      // Supabase types the embedded relation as object-or-array depending on
      // the inferred cardinality; normalise both shapes.
      const p = Array.isArray(l.products) ? l.products[0] : l.products
      if (p) productByCampaign.set(l.campaign_id, { id: p.id, name: p.name })
    }

    // Flatten campaigns -> one entry per ad id
    const ads: AdOption[] = []
    for (const c of campaigns) {
      const product = productByCampaign.get(c.id) ?? null
      for (const ad of c.ads || []) {
        ads.push({
          id: ad.id,
          name: c.name,
          campaignId: c.id,
          active: c.status === 'ACTIVE',
          spend: parseFloat(c.spend || '0'),
          productId: product?.id ?? null,
          productName: product?.name ?? null,
        })
      }
    }

    // Active ads first, then by today's spend - the ad a live conversation
    // came from is almost always one that is currently running and spending.
    ads.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.spend - a.spend
    })

    return NextResponse.json(
      { success: true, ads, lastRefresh: cached?.last_refresh ?? null },
      { headers: corsHeaders },
    )
  } catch (error) {
    console.error('list-ads error:', error)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500, headers: corsHeaders })
  }
}
