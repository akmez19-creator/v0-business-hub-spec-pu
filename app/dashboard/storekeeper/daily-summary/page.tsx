import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DailySummaryPage } from '@/components/storekeeper/daily-summary-page'

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const adminDb = createAdminClient()
  const params = await searchParams

  // Get available dates - from both sessions AND direct storekeeper collections
  const { data: sessionDatesData } = await adminDb
    .from('cash_collection_sessions')
    .select('collection_date')
    .order('collection_date', { ascending: false })
    .limit(30)

  // Also get dates from deliveries collected directly by storekeeper
  const { data: deliveryDatesData } = await adminDb
    .from('deliveries')
    .select('cash_collected_at')
    .eq('cash_collected', true)
    .eq('cash_collected_by', user.id)
    .not('cash_collected_at', 'is', null)
    .order('cash_collected_at', { ascending: false })
    .limit(100)

  // Also get dates from returns verified by storekeeper (from return_collections table)
  const { data: returnDatesData } = await adminDb
    .from('return_collections')
    .select('verified_at')
    .eq('verified', true)
    .eq('verified_by', user.id)
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false })
    .limit(100)

  const sessionDates = (sessionDatesData || []).map(d => d.collection_date)
  const deliveryDates = (deliveryDatesData || []).map(d => 
    new Date(d.cash_collected_at).toISOString().split('T')[0]
  )
  const returnDates = (returnDatesData || []).map(d => 
    new Date(d.verified_at).toISOString().split('T')[0]
  )
  const uniqueDates = [...new Set([...sessionDates, ...deliveryDates, ...returnDates])].sort((a, b) => b.localeCompare(a))
  
  // Selected date (defaults to latest date with data, or today if none)
  const selectedDate = params.date || uniqueDates[0] || new Date().toISOString().split('T')[0]

  // Get collection sessions for selected date
  const { data: sessions } = await adminDb
    .from('cash_collection_sessions')
    .select(`
      id, contractor_id, collected_cash,
      denomination_2000, denomination_1000, denomination_500, denomination_200, denomination_100,
      denomination_50, denomination_25, denomination_20, denomination_10, denomination_5, denomination_1
    `)
    .eq('collection_date', selectedDate)
    .order('created_at', { ascending: false })

  // Also get deliveries collected directly by storekeeper on the selected date
  const { data: directCollections } = await adminDb
    .from('deliveries')
    .select('id, contractor_id, payment_cash, cash_collected_at, contractor_cash_counted, contractor_cash_denoms')
    .eq('cash_collected', true)
    .eq('cash_collected_by', user.id)
    .gte('cash_collected_at', `${selectedDate}T00:00:00`)
    .lt('cash_collected_at', `${selectedDate}T23:59:59.999`)

  // Get returns verified by storekeeper on the selected date (from return_collections table)
  // Need to get rider -> contractor mapping
  const { data: returnCollections } = await adminDb
    .from('return_collections')
    .select('id, rider_id, product_name, qty, verified_at')
    .eq('verified', true)
    .eq('verified_by', user.id)
    .gte('verified_at', `${selectedDate}T00:00:00`)
    .lt('verified_at', `${selectedDate}T23:59:59.999`)

  // Get rider to contractor mapping for returns
  const { data: ridersData } = await adminDb.from('riders').select('id, contractor_id')
  const riderToContractor = new Map((ridersData || []).map(r => [r.id, r.contractor_id]))

  // Get contractor names
  const { data: contractors } = await adminDb.from('contractors').select('id, name')
  const contractorMap = new Map((contractors || []).map(c => [c.id, c.name]))

  // Group direct collections by contractor with denominations
  // The contractor counts cash ONCE for all their deliveries, so we take the MAX contractor_cash_counted value
  // and the denomination breakdown from the delivery that has it
  const directByContractor = new Map<string, { cash: number, denoms: Record<number, number> }>()
  for (const d of (directCollections || [])) {
    if (d.contractor_id) {
      const existing = directByContractor.get(d.contractor_id) || { 
        cash: 0, 
        denoms: { 2000: 0, 1000: 0, 500: 0, 200: 0, 100: 0, 50: 0, 25: 0, 20: 0, 10: 0, 5: 0, 1: 0 } 
      }
      
      // Use contractor_cash_counted if available - take the MAX (non-zero) value
      // because the contractor only counts once for all deliveries
      const counted = Number(d.contractor_cash_counted || 0)
      if (counted > existing.cash) {
        existing.cash = counted
      }
      
      // Parse and aggregate contractor_cash_denoms if available (only from the delivery that has them)
      // Format is: { denomination_500: 2, denomination_1000: 1, ... }
      if (d.contractor_cash_denoms && Object.keys(d.contractor_cash_denoms).length > 0) {
        try {
          const denoms = typeof d.contractor_cash_denoms === 'string' 
            ? JSON.parse(d.contractor_cash_denoms) 
            : d.contractor_cash_denoms
          // Only update denoms if this delivery has them (don't add zeros)
          for (const [key, val] of Object.entries(denoms)) {
            const match = key.match(/denomination_(\d+)/)
            const denomKey = match ? parseInt(match[1]) : parseInt(key)
            if (!isNaN(denomKey) && existing.denoms[denomKey] !== undefined) {
              // Take the max value for each denomination (not sum)
              const newVal = Number(val) || 0
              if (newVal > existing.denoms[denomKey]) {
                existing.denoms[denomKey] = newVal
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      directByContractor.set(d.contractor_id, existing)
    }
  }

  // Map sessions from cash_collection_sessions table
  const sessionMap = new Map<string, {
    id: string,
    contractorId: string,
    contractorName: string,
    collectedCash: number,
    denominations: Record<number, number>
  }>()
  
  for (const s of (sessions || [])) {
    sessionMap.set(s.contractor_id, {
      id: s.id,
      contractorId: s.contractor_id,
      contractorName: contractorMap.get(s.contractor_id) || 'Unknown',
      collectedCash: Number(s.collected_cash || 0),
      denominations: {
        2000: s.denomination_2000 || 0,
        1000: s.denomination_1000 || 0,
        500: s.denomination_500 || 0,
        200: s.denomination_200 || 0,
        100: s.denomination_100 || 0,
        50: s.denomination_50 || 0,
        25: s.denomination_25 || 0,
        20: s.denomination_20 || 0,
        10: s.denomination_10 || 0,
        5: s.denomination_5 || 0,
        1: s.denomination_1 || 0,
      },
    })
  }

  // Add direct collections that don't have session records (use contractor's counted denominations)
  for (const [contractorId, data] of directByContractor) {
    if (!sessionMap.has(contractorId)) {
      sessionMap.set(contractorId, {
        id: `direct-${contractorId}`,
        contractorId,
        contractorName: contractorMap.get(contractorId) || 'Unknown',
        collectedCash: data.cash,
        denominations: data.denoms,
      })
    }
  }

  const sessionList = Array.from(sessionMap.values())

  // Group returns by contractor (using rider_id to get contractor_id)
  const returnsByContractor = new Map<string, { count: number, items: { product: string, qty: number }[] }>()
  for (const r of (returnCollections || [])) {
    const contractorId = r.rider_id ? riderToContractor.get(r.rider_id) : null
    if (contractorId) {
      const existing = returnsByContractor.get(contractorId) || { count: 0, items: [] }
      existing.count += Number(r.qty || 1)
      existing.items.push({ product: r.product_name || 'Unknown', qty: Number(r.qty || 1) })
      returnsByContractor.set(contractorId, existing)
    }
  }

  const returnsList = Array.from(returnsByContractor.entries()).map(([contractorId, data]) => ({
    contractorId,
    contractorName: contractorMap.get(contractorId) || 'Unknown',
    count: data.count,
    items: data.items,
  }))

  // Calculate totals
  const totals = {
    collectedCash: sessionList.reduce((t, s) => t + s.collectedCash, 0),
    denominations: {
      2000: sessionList.reduce((t, s) => t + s.denominations[2000], 0),
      1000: sessionList.reduce((t, s) => t + s.denominations[1000], 0),
      500: sessionList.reduce((t, s) => t + s.denominations[500], 0),
      200: sessionList.reduce((t, s) => t + s.denominations[200], 0),
      100: sessionList.reduce((t, s) => t + s.denominations[100], 0),
      50: sessionList.reduce((t, s) => t + s.denominations[50], 0),
      25: sessionList.reduce((t, s) => t + s.denominations[25], 0),
      20: sessionList.reduce((t, s) => t + s.denominations[20], 0),
      10: sessionList.reduce((t, s) => t + s.denominations[10], 0),
      5: sessionList.reduce((t, s) => t + s.denominations[5], 0),
      1: sessionList.reduce((t, s) => t + s.denominations[1], 0),
    },
    contractorCount: sessionList.length,
    returnsCount: returnsList.reduce((t, r) => t + r.count, 0),
    returnsContractorCount: returnsList.length,
  }

  return (
    <DailySummaryPage
      selectedDate={selectedDate}
      sessions={sessionList}
      returns={returnsList}
      totals={totals}
      availableDates={uniqueDates}
    />
  )
}
