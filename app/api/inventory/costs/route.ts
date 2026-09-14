import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { costsFromPurchaseOrders, resolveUnitCost, valueStock, type CostRow } from '@/lib/inventory/cost'
import { fetchAll } from '@/lib/supabase/fetch-all'

/**
 * Inventory value, and the products blocking it from being complete.
 *
 * Runs server-side with the service role for one reason: the value depends on
 * every priced purchase order, and a browser client reading a partial set would
 * silently under-report the cost of stock rather than fail.
 */

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const admin = createAdminClient()

    const [products, poRows] = await Promise.all([
      fetchAll<{
        id: string
        name: string | null
        quantity: number | null
        cost_price: number | string | null
        cost_price_at: string | null
        sold_out: boolean | null
        has_variants: boolean | null
        image_url: string | null
        sku: string | null
        category: string | null
        zone: string | null
      }>((from, to) =>
        admin
          .from('products')
          .select('id,name,quantity,cost_price,cost_price_at,sold_out,has_variants,image_url,sku,category,zone')
          .not('is_active', 'is', false)
          // Total order: without it, page 2 can repeat or skip rows of page 1.
          .order('id')
          .range(from, to),
      ),
      fetchAll<CostRow & { product_name: string | null; supplier_name: string | null }>((from, to) =>
        admin
          .from('purchase_orders')
          .select('product_id,product_name,supplier_name,qty,total_cp_import,unit_price,order_date,created_at')
          .not('product_id', 'is', null)
          .gt('total_cp_import', 0)
          .gt('qty', 0)
          .order('id')
          .range(from, to),
      ),
    ])

    const fromPo = costsFromPurchaseOrders(poRows)
    const valuation = valueStock(products, fromPo)

    // Only products with stock on the shelf can hold value, so those are the
    // ones worth chasing a cost for. A costless product with no stock changes
    // no total and would only pad the list.
    const missing = products
      .filter(p => Number(p.quantity ?? 0) > 0 && !resolveUnitCost(p, fromPo))
      .map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        image_url: p.image_url,
        quantity: Number(p.quantity ?? 0),
      }))
      .sort((a, b) => b.quantity - a.quantity)

    // Same shape for the ones already valued, so the section can show its work
    // instead of asking to be trusted.
    const valued = products
      .filter(p => Number(p.quantity ?? 0) > 0)
      .map(p => {
        const unit = resolveUnitCost(p, fromPo)
        if (!unit) return null
        const quantity = Number(p.quantity ?? 0)
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          image_url: p.image_url,
          quantity,
          unitCost: unit.cost,
          value: quantity * unit.cost,
          source: unit.source,
          poDate: unit.poDate ?? null,
          poQty: unit.poQty ?? null,
          poTotal: unit.poTotal ?? null,
          pooledFrom: unit.pooledFrom ?? 1,
          yuanUnitPrice: unit.yuanUnitPrice ?? null,
          costPriceAt: p.cost_price_at ?? null,
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b!.value ?? 0) - (a!.value ?? 0))

    // Products carrying stock with no zone. A zone is where the item physically
    // sits, so no zone means nothing is holding it - these are almost always
    // sold out with a quantity nobody cleared. Reported, never auto-corrected:
    // the quantity might equally mean the zone was just never filled in, and
    // guessing wrong silently erases counted stock.
    const zoneOf = (p: { zone: string | null }) => (p.zone ?? '').trim()
    const unzoned = products
      .filter(p => Number(p.quantity ?? 0) > 0 && !zoneOf(p))
      .map(p => {
        const quantity = Number(p.quantity ?? 0)
        const unit = resolveUnitCost(p, fromPo)
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          image_url: p.image_url,
          quantity,
          soldOut: Boolean(p.sold_out),
          value: unit ? quantity * unit.cost : null,
        }
      })
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.quantity - a.quantity)

    const unzonedValue = unzoned.reduce((sum, p) => sum + (p.value ?? 0), 0)

    return NextResponse.json({
      valuation,
      missing,
      valued,
      unzoned,
      unzonedValue,
      pricedPoCount: poRows.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to value stock' }, { status: 500 })
  }
}

/**
 * Save hand-entered landed costs.
 *
 * POST { costs: [{ productId, cost }] }  cost null clears it back to history.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const raw = Array.isArray(body?.costs) ? body.costs : []
    if (!raw.length) return NextResponse.json({ error: 'No costs supplied' }, { status: 400 })

    // Validate before writing anything. A NaN or negative reaching the database
    // either trips the CHECK mid-batch - leaving half the edits applied - or
    // stores a cost that silently corrupts the inventory total.
    const updates: Array<{ productId: string; cost: number | null }> = []
    for (const c of raw) {
      const productId = typeof c?.productId === 'string' ? c.productId : null
      if (!productId) return NextResponse.json({ error: 'A row was missing its product' }, { status: 400 })
      if (c?.cost === null || c?.cost === '' || c?.cost === undefined) {
        updates.push({ productId, cost: null })
        continue
      }
      const cost = typeof c.cost === 'number' ? c.cost : Number.parseFloat(String(c.cost))
      if (!Number.isFinite(cost) || cost <= 0) {
        return NextResponse.json(
          { error: `"${String(c.cost)}" is not a usable cost. Enter an amount in Rs greater than zero.` },
          { status: 400 },
        )
      }
      updates.push({ productId, cost: Math.round(cost * 100) / 100 })
    }

    const admin = createAdminClient()
    const now = new Date().toISOString()
    let saved = 0
    for (const u of updates) {
      const { error } = await admin
        .from('products')
        .update({ cost_price: u.cost, cost_price_at: u.cost === null ? null : now })
        .eq('id', u.productId)
      if (error) {
        // Report how far it got: silently claiming success for a partial write
        // would leave the reviewer thinking costs were captured that were not.
        return NextResponse.json({ error: error.message, saved }, { status: 500 })
      }
      saved++
    }

    return NextResponse.json({ success: true, saved })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save costs' }, { status: 500 })
  }
}
