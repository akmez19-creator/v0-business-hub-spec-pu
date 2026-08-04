import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Product Master overview: one call returning the canonical product list
// enriched with merged intelligence - open POs, active ads (from the ads
// cache), and client demand (deliveries per day / per week) matched via
// product_id, validated aliases, or exact name.

const norm = (s: string) => s.trim().toLowerCase()

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const admin = createAdminClient()
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [{ data: products }, { data: aliases }, { data: pos }, { data: links }, { data: cache }, { data: deliveries }, { data: postRows }] =
      await Promise.all([
        // promo_price rides along so Reels Studio can prefill the "was / now"
        // tag straight from Product Master. is_b1g1 and bundle_prices come too:
        // in practice almost no product carries a promo price, so these offers
        // are what the promo tag actually has to work with.
        admin
          .from('products')
          .select(
            'id, name, sku, category, price, promo_price, quantity, image_url, is_active, sold_out, is_b1g1, bundle_prices',
          )
          .order('name'),
        admin.from('product_aliases').select('alias_name, product_id'),
        admin
          .from('purchase_orders')
          .select('id, product_id, product_name, status, qty, unit_price, supplier_name, tracking_number, created_at')
          .not('status', 'in', '("received","cancelled")'),
        admin.from('campaign_product_links').select('campaign_id, product_id'),
        admin.from('ads_cache').select('campaigns').eq('cache_key', 'today_spend').single(),
        admin
          .from('deliveries')
          .select('product_id, products, created_at')
          .gte('created_at', since.toISOString()),
        admin.from('product_posts').select('product_id'),
      ])

    // ---- Post library count per product ----
    const postsByProduct = new Map<string, number>()
    for (const row of postRows || []) {
      if (!row.product_id) continue
      postsByProduct.set(row.product_id, (postsByProduct.get(row.product_id) || 0) + 1)
    }

    // alias name -> product id (for matching deliveries/POs still unlinked)
    const aliasMap = new Map<string, string>()
    for (const a of aliases || []) aliasMap.set(norm(a.alias_name), a.product_id)
    const nameMap = new Map<string, string>()
    for (const p of products || []) nameMap.set(norm(p.name), p.id)

    const resolveProduct = (productId: string | null, rawName: string | null): string | null => {
      if (productId) return productId
      if (!rawName) return null
      const n = norm(rawName)
      return nameMap.get(n) ?? aliasMap.get(n) ?? null
    }

    // ---- Active ads per product (campaign links x ads cache) ----
    const activeCampaignAds = new Map<string, number>() // campaign_id -> active ads count
    const campaigns = Array.isArray(cache?.campaigns) ? (cache!.campaigns as any[]) : []
    for (const c of campaigns) {
      if (c?.status === 'ACTIVE') activeCampaignAds.set(String(c.id), Array.isArray(c.ads) ? c.ads.length : 0)
    }
    const adsByProduct = new Map<string, { campaigns: number; ads: number }>()
    for (const link of links || []) {
      if (!link.product_id || !activeCampaignAds.has(String(link.campaign_id))) continue
      const entry = adsByProduct.get(link.product_id) || { campaigns: 0, ads: 0 }
      entry.campaigns += 1
      entry.ads += activeCampaignAds.get(String(link.campaign_id)) || 0
      adsByProduct.set(link.product_id, entry)
    }

    // ---- Clients per day / per week ----
    const clientsToday = new Map<string, number>()
    const clientsWeek = new Map<string, number>()
    for (const d of deliveries || []) {
      const pid = resolveProduct(d.product_id, d.products)
      if (!pid) continue
      clientsWeek.set(pid, (clientsWeek.get(pid) || 0) + 1)
      if (new Date(d.created_at) >= todayStart) clientsToday.set(pid, (clientsToday.get(pid) || 0) + 1)
    }

    // ---- Open POs per product ----
    const posByProduct = new Map<string, any[]>()
    for (const po of pos || []) {
      const pid = resolveProduct(po.product_id, po.product_name)
      if (!pid) continue
      const list = posByProduct.get(pid) || []
      list.push(po)
      posByProduct.set(pid, list)
    }

    // ---- Aliases per product (for the expanded row) ----
    const aliasesByProduct = new Map<string, string[]>()
    for (const a of aliases || []) {
      const list = aliasesByProduct.get(a.product_id) || []
      list.push(a.alias_name)
      aliasesByProduct.set(a.product_id, list)
    }

    const overview = (products || []).map((p) => {
      const ads = adsByProduct.get(p.id)
      const productPos = posByProduct.get(p.id) || []
      return {
        ...p,
        // Sold-out is a MANUAL flag toggled by the user, never derived from stock
        soldOut: p.sold_out === true,
        activeCampaigns: ads?.campaigns ?? 0,
        activeAds: ads?.ads ?? 0,
        clientsPerDay: clientsToday.get(p.id) ?? 0,
        clientsPerWeek: clientsWeek.get(p.id) ?? 0,
        openPOs: productPos.length,
        openPOQty: productPos.reduce((s, po) => s + (po.qty || 0), 0),
        postsCount: postsByProduct.get(p.id) ?? 0,
        pos: productPos,
        aliases: aliasesByProduct.get(p.id) ?? [],
      }
    })

    return NextResponse.json({ success: true, products: overview })
  } catch (error) {
    console.error('overview error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load overview' }, { status: 500 })
  }
}

// PATCH: user-initiated edits to a single product. Handles the sold-out flag
// and the promo price; only the keys actually present in the body are written,
// so sending one never clears the other.
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const productId: string = String(body?.productId || '')

    if (!productId) {
      return NextResponse.json({ success: false, error: 'productId is required' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}

    if ('soldOut' in body) patch.sold_out = body.soldOut === true

    if ('promoPrice' in body) {
      // Empty string / null clears the promo; anything else must be a real,
      // non-negative number or we reject rather than writing NaN
      const raw = body.promoPrice
      if (raw === null || raw === '') {
        patch.promo_price = null
      } else {
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ success: false, error: 'promoPrice must be a positive number' }, { status: 400 })
        }
        patch.promo_price = n
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from('products').update(patch).eq('id', productId)
    if (error) throw error

    return NextResponse.json({ success: true, productId, ...patch })
  } catch (error) {
    console.error('product patch error:', error)
    return NextResponse.json({ success: false, error: 'Failed to update product' }, { status: 500 })
  }
}
