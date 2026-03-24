import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ReturnsPage } from '@/components/storekeeper/returns-page'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StockInPage({ searchParams }: { searchParams: Promise<{ date?: string; contractor?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) redirect('/dashboard')

  // Get ALL return deliveries:
  // 1. CMS status deliveries (full returns)
  const { data: cmsStatusDeliveries } = await adminDb
    .from('deliveries')
    .select('id, products, qty, delivery_date, stock_verified, stock_verified_at, rider_id, contractor_id, status, return_product, sales_type')
    .eq('status', 'cms')
    .order('delivery_date', { ascending: false })

  // 2. Deliveries with sales_type in (exchange, trade_in, refund) that have return_product
  const { data: returnTypeDeliveries } = await adminDb
    .from('deliveries')
    .select('id, products, qty, delivery_date, stock_verified, stock_verified_at, rider_id, contractor_id, status, return_product, sales_type')
    .in('sales_type', ['exchange', 'trade_in', 'refund'])
    .not('return_product', 'is', null)
    .order('delivery_date', { ascending: false })

  // Merge and dedupe
  const allReturns = [...(cmsStatusDeliveries || []), ...(returnTypeDeliveries || [])]
  const seenIds = new Set<string>()
  const cmsDeliveries = allReturns.filter(d => {
    if (seenIds.has(d.id)) return false
    seenIds.add(d.id)
    return true
  })

  // Get return_collections (submitted by contractors/riders)
  const { data: returnCollections } = await adminDb
    .from('return_collections')
    .select('id, rider_id, product_name, qty, collection_date, verified, verified_at, condition, notes')
    .order('collection_date', { ascending: false })

  // Get riders and contractors
  const { data: riders } = await adminDb.from('riders').select('id, name, contractor_id')
  const { data: contractors } = await adminDb.from('contractors').select('id, name')

  const riderMap = new Map((riders || []).map(r => [r.id, r.name]))
  const riderToContractor = new Map((riders || []).map(r => [r.id, r.contractor_id]))
  const contractorMap = new Map((contractors || []).map(c => [c.id, c.name]))

  // Get unique dates from both deliveries and return_collections
  const deliveryDates = (cmsDeliveries || []).map(d => d.delivery_date)
  const returnDates = (returnCollections || []).map(r => r.collection_date)
  const dates = [...new Set([...deliveryDates, ...returnDates])].filter(Boolean).sort().reverse()
  const selectedDate = params.date || dates[0] || new Date().toISOString().split('T')[0]

  // Helper to build contractor data from both deliveries and return_collections
  function buildContractorData(deliveries: typeof cmsDeliveries, returns: typeof returnCollections) {
    const groups = new Map<string, {
      id: string
      name: string
      items: { id: string; product: string; qty: number; date: string; riderName: string; verified: boolean; salesType?: string; source: 'delivery' | 'return_collection' }[]
      pendingQty: number
      verifiedQty: number
    }>()

    // Process deliveries (CMS/exchange/trade_in/refund)
    for (const d of deliveries || []) {
      const cId = d.contractor_id
      const cName = contractorMap.get(cId) || 'Unknown'
      if (!groups.has(cId)) {
        groups.set(cId, { id: cId, name: cName, items: [], pendingQty: 0, verifiedQty: 0 })
      }
      const c = groups.get(cId)!
      const qty = d.qty || 1
      const isReturnType = d.sales_type && ['exchange', 'trade_in', 'refund'].includes(d.sales_type)
      const productName = isReturnType ? (d.return_product || d.products || 'Unknown Product') : (d.products || 'Unknown Product')
      c.items.push({
        id: d.id,
        product: productName,
        qty,
        date: d.delivery_date,
        riderName: riderMap.get(d.rider_id) || 'Unknown',
        verified: d.stock_verified || false,
        salesType: d.sales_type || (d.status === 'cms' ? 'cms' : undefined),
        source: 'delivery',
      })
      if (d.stock_verified) {
        c.verifiedQty += qty
      } else {
        c.pendingQty += qty
      }
    }

    // Process return_collections (submitted by riders)
    for (const r of returns || []) {
      const cId = riderToContractor.get(r.rider_id) || ''
      if (!cId) continue
      const cName = contractorMap.get(cId) || 'Unknown'
      if (!groups.has(cId)) {
        groups.set(cId, { id: cId, name: cName, items: [], pendingQty: 0, verifiedQty: 0 })
      }
      const c = groups.get(cId)!
      const qty = r.qty || 1
      c.items.push({
        id: r.id,
        product: r.product_name || 'Unknown Product',
        qty,
        date: r.collection_date,
        riderName: riderMap.get(r.rider_id) || 'Unknown',
        verified: r.verified || false,
        salesType: r.condition || 'return',
        source: 'return_collection',
      })
      if (r.verified) {
        c.verifiedQty += qty
      } else {
        c.pendingQty += qty
      }
    }

    return Array.from(groups.values()).filter(c => c.items.length > 0)
  }

  // Build data for selected date
  const dayDeliveries = (cmsDeliveries || []).filter(d => d.delivery_date === selectedDate)
  const dayReturns = (returnCollections || []).filter(r => r.collection_date === selectedDate)
  const contractorsByDate = buildContractorData(dayDeliveries, dayReturns)

  // Build data for ALL pending (regardless of date)
  const allPendingDeliveries = (cmsDeliveries || []).filter(d => !d.stock_verified)
  const allPendingReturns = (returnCollections || []).filter(r => !r.verified)
  const allContractorsWithPending = buildContractorData(allPendingDeliveries, allPendingReturns)

  // Total pending across all dates
  const totalPendingAll = allPendingDeliveries.reduce((sum, d) => sum + (d.qty || 1), 0) + 
                          allPendingReturns.reduce((sum, r) => sum + (r.qty || 1), 0)

  return (
    <ReturnsPage
      userId={user.id}
      contractors={contractorsByDate}
      allContractors={allContractorsWithPending}
      selectedDate={selectedDate}
      availableDates={dates}
      totalPendingAll={totalPendingAll}
      selectedContractorId={params.contractor || null}
    />
  )
}
