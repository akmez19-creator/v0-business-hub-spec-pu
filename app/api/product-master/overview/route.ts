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

    const [{ data: products }, { data: aliases }, { data: pos }, { data: links }, { data: cache }, { data: deliveries }] =
      await Promise.all([
        admin.from('products').select('id, name, sku, category, price, quantity, image_url, is_active').order('name'),
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
      ])

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
        soldOut: (p.quantity ?? 0) <= 0,
        activeCampaigns: ads?.campaigns ?? 0,
        activeAds: ads?.ads ?? 0,
        clientsPerDay: clientsToday.get(p.id) ?? 0,
        clientsPerWeek: clientsWeek.get(p.id) ?? 0,
        openPOs: productPos.length,
        openPOQty: productPos.reduce((s, po) => s + (po.qty || 0), 0),
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
