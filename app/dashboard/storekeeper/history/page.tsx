import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { HistoryPage } from '@/components/storekeeper/history-page'

export default async function HistoryRoute() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) redirect('/dashboard')

  // Get all collection sessions
  const { data: sessions } = await adminDb.from('cash_collection_sessions')
    .select('*')
    .order('collection_date', { ascending: false })
    .limit(100)

  const { data: contractors } = await adminDb.from('contractors').select('id, name').eq('is_active', true)
  const { data: riders } = await adminDb.from('riders').select('id, name, contractor_id').eq('is_active', true)

  // Use database aggregation to avoid 1000 row limit
  // Get cash collection summary from view
  const { data: cashSummary } = await adminDb.from('cash_collection_summary')
    .select('delivery_date, order_count, total_cash, collected_cash, pending_cash')

  // Get CMS/return items for return counts
  const { data: cmsData } = await adminDb.from('deliveries')
    .select('delivery_date, stock_verified')
    .eq('status', 'cms')

  // Build daily summaries from aggregated data
  const dateMap = new Map<string, {
    date: string; totalOrders: number; totalAmount: number
    totalCash: number; collectedCash: number; pendingCash: number
    totalBank: number; totalReturns: number; verifiedReturns: number
    riderCount: number
  }>()

  // Add cash data from summary view
  for (const s of (cashSummary || [])) {
    const date = s.delivery_date
    if (!date) continue
    if (!dateMap.has(date)) {
      dateMap.set(date, { date, totalOrders: 0, totalAmount: 0, totalCash: 0, collectedCash: 0, pendingCash: 0, totalBank: 0, totalReturns: 0, verifiedReturns: 0, riderCount: 0 })
    }
    const d = dateMap.get(date)!
    d.totalOrders += Number(s.order_count || 0)
    d.totalCash += Number(s.total_cash || 0)
    d.collectedCash += Number(s.collected_cash || 0)
    d.pendingCash += Number(s.pending_cash || 0)
  }

  // Add return data
  for (const c of (cmsData || [])) {
    const date = c.delivery_date
    if (!date) continue
    if (!dateMap.has(date)) {
      dateMap.set(date, { date, totalOrders: 0, totalAmount: 0, totalCash: 0, collectedCash: 0, pendingCash: 0, totalBank: 0, totalReturns: 0, verifiedReturns: 0, riderCount: 0 })
    }
    const d = dateMap.get(date)!
    d.totalReturns++
    if (c.stock_verified) d.verifiedReturns++
  }

  const dailySummaries = [...dateMap.values()]
    .sort((a, b) => b.date.localeCompare(a.date))

  const sessionList = (sessions || []).map(s => {
    const contractor = (contractors || []).find(c => c.id === s.contractor_id)
    const rider = (riders || []).find(r => r.id === s.rider_id)
    return {
      id: s.id, collection_date: s.collection_date,
      contractor_name: contractor?.name || 'Unknown',
      rider_name: rider?.name || null,
      expected_cash: Number(s.expected_cash || 0),
      collected_cash: Number(s.collected_cash || 0),
      shortage: Number(s.shortage || 0),
      surplus: Number(s.surplus || 0),
      status: s.status, notes: s.notes,
    }
  })

  return <HistoryPage dailySummaries={dailySummaries} sessions={sessionList} />
}
