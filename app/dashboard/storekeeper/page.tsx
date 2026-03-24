import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { StorekeeperModule } from '@/components/storekeeper/storekeeper-module'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StorekeeperPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get all contractors
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name, photo_url')
    .eq('is_active', true)

  // Use SUMMARY VIEW for cash collection totals (no row limit issues)
  // Get pending cash only
  const { data: cashSummary } = await adminDb
    .from('cash_collection_summary')
    .select('contractor_id, delivery_date, pending_cash, pending_count')
    .gt('pending_count', 0)

  // Get ALL summary data for grand totals (includes collected)
  const { data: allCashSummary } = await adminDb
    .from('cash_collection_summary')
    .select('order_count, total_cash, collected_cash, pending_cash')

  // Calculate grand totals
  let totalOrders = 0, totalCash = 0, collectedCash = 0
  for (const s of allCashSummary || []) {
    totalOrders += Number(s.order_count || 0)
    totalCash += Number(s.total_cash || 0)
    collectedCash += Number(s.collected_cash || 0)
  }

  // Get total CMS returns count
  const { data: allCmsData } = await adminDb
    .from('deliveries')
    .select('stock_verified')
    .eq('status', 'cms')

  let totalReturns = 0, verifiedReturns = 0
  for (const c of allCmsData || []) {
    totalReturns++
    if (c.stock_verified) verifiedReturns++
  }

  const grandTotals = { totalOrders, totalCash, collectedCash, totalReturns, verifiedReturns }

  // Get UNVERIFIED CMS items count by contractor (for returns)
  const { data: cmsDeliveries } = await adminDb
    .from('deliveries')
    .select(`
      id, delivery_date, contractor_id, products, qty, stock_verified
    `)
    .eq('status', 'cms')
    .eq('stock_verified', false)
    .order('delivery_date', { ascending: false })

  // Build contractor cash totals from SUMMARY (no row limit issues)
  const contractorCashTotals = new Map<string, { pendingCash: number; pendingDates: Set<string> }>()
  for (const s of cashSummary || []) {
    if (!contractorCashTotals.has(s.contractor_id)) {
      contractorCashTotals.set(s.contractor_id, { pendingCash: 0, pendingDates: new Set() })
    }
    const c = contractorCashTotals.get(s.contractor_id)!
    c.pendingCash += Number(s.pending_cash || 0)
    c.pendingDates.add(s.delivery_date)
  }

  // Map CMS items
  const cmsItems = (cmsDeliveries || []).map(d => {
    const contractor = (contractors || []).find(c => c.id === d.contractor_id)
    return {
      id: d.id,
      delivery_date: d.delivery_date,
      contractor_id: d.contractor_id,
      contractor_name: contractor?.name || 'Unknown',
      contractor_photo_url: contractor?.photo_url || null,
      products: d.products,
      qty: d.qty || 1,
      stock_verified: d.stock_verified ?? false,
    }
  })

  // Build contractor list with cash totals
  const contractorList = (contractors || []).map(c => {
    const cashData = contractorCashTotals.get(c.id)
    return {
      id: c.id,
      name: c.name,
      photoUrl: c.photo_url || null,
      pendingCash: cashData?.pendingCash || 0,
      pendingDates: cashData?.pendingDates.size || 0,
    }
  }).filter(c => c.pendingCash > 0)

  return (
    <StorekeeperModule
      userId={user.id}
      contractorCashTotals={contractorList}
      cmsItems={cmsItems}
      grandTotals={grandTotals}
    />
  )
}
