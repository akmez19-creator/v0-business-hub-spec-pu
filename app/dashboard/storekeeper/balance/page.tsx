import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { BalancePage } from '@/components/storekeeper/balance-page'

const ALL_DENOMS = [2000, 1000, 500, 200, 100, 50, 25, 20, 10, 5, 1] as const

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const adminDb = createAdminClient()

  // Get deliveries collected by this storekeeper
  // Use contractor_cash_counted for the actual collected amount (contractor counts once for all deliveries)
  const { data: directCollections } = await adminDb
    .from('deliveries')
    .select('payment_cash, cash_collected_at, contractor_id, contractor_cash_counted, contractor_cash_denoms')
    .eq('cash_collected', true)
    .eq('cash_collected_by', user.id)
    .not('cash_collected_at', 'is', null)

  // Get all bank deposits (cash OUT) by this user
  const { data: deposits } = await adminDb
    .from('bank_deposits')
    .select('*')
    .eq('deposited_by', user.id)
    .order('deposit_date', { ascending: false })

  // Group cash collections by date (only from deliveries, not sessions to avoid double counting)
  const collectionsByDate = new Map<string, number>()

  // Aggregate denomination totals (only count once per contractor, use MAX value)
  const denomTotals: Record<number, number> = {}
  for (const d of ALL_DENOMS) denomTotals[d] = 0
  
  // Track which contractors have been processed to avoid double counting
  // When a contractor counts cash, they count ONCE for ALL their deliveries
  const contractorCashCounted = new Map<string, number>() // contractorKey -> counted amount
  const contractorDenomsSeen = new Map<string, Record<number, number>>()
  
  // FIRST PASS: Find contractors who have counted cash (contractor_cash_counted > 0)
  for (const d of directCollections || []) {
    if (!d.contractor_id) continue
    const date = new Date(d.cash_collected_at).toISOString().split('T')[0]
    const contractorKey = `${date}_${d.contractor_id}`
    const counted = Number(d.contractor_cash_counted || 0)
    
    if (counted > 0) {
      // Take the max counted value for this contractor (should only be one non-zero)
      const existing = contractorCashCounted.get(contractorKey) || 0
      if (counted > existing) {
        contractorCashCounted.set(contractorKey, counted)
      }
      
      // Parse denominations
      if (d.contractor_cash_denoms) {
        try {
          const denoms = typeof d.contractor_cash_denoms === 'string' 
            ? JSON.parse(d.contractor_cash_denoms) 
            : d.contractor_cash_denoms
          const existingContractorDenoms = contractorDenomsSeen.get(contractorKey) || {}
          
          for (const [key, val] of Object.entries(denoms)) {
            const match = key.match(/denomination_(\d+)/)
            const denomKey = match ? parseInt(match[1]) : parseInt(key)
            if (!isNaN(denomKey) && denomTotals[denomKey] !== undefined) {
              const newVal = Number(val) || 0
              const existingVal = existingContractorDenoms[denomKey] || 0
              if (newVal > existingVal) {
                denomTotals[denomKey] += newVal - existingVal
                existingContractorDenoms[denomKey] = newVal
              }
            }
          }
          contractorDenomsSeen.set(contractorKey, existingContractorDenoms)
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }
  
  // SECOND PASS: Add cash to collectionsByDate
  const contractorsProcessed = new Set<string>()
  for (const d of directCollections || []) {
    const date = new Date(d.cash_collected_at).toISOString().split('T')[0]
    const contractorKey = d.contractor_id ? `${date}_${d.contractor_id}` : null
    
    // Skip if we already processed this contractor for this date
    if (contractorKey && contractorsProcessed.has(contractorKey)) continue
    
    // Check if this contractor has a counted cash value
    if (contractorKey && contractorCashCounted.has(contractorKey)) {
      // Use the contractor's counted cash (they counted once for all deliveries)
      const counted = contractorCashCounted.get(contractorKey)!
      const current = collectionsByDate.get(date) || 0
      collectionsByDate.set(date, current + counted)
      contractorsProcessed.add(contractorKey)
    } else if (!contractorKey) {
      // No contractor - use payment_cash
      const current = collectionsByDate.get(date) || 0
      collectionsByDate.set(date, current + Number(d.payment_cash || 0))
    }
    // If contractor exists but has no counted value, skip (they haven't counted yet)
  }

  // Group deposits by date
  const depositsByDate = new Map<string, number>()
  for (const d of deposits || []) {
    const date = d.deposit_date
    const current = depositsByDate.get(date) || 0
    depositsByDate.set(date, current + Number(d.amount || 0))
  }

  // Get all unique dates and sort descending
  const allDates = new Set([...collectionsByDate.keys(), ...depositsByDate.keys()])
  const sortedDates = [...allDates].sort((a, b) => b.localeCompare(a))

  // Calculate running balance from oldest to newest
  let runningBalance = 0
  const entriesByDate = new Map<string, { cashIn: number; cashOut: number; balance: number }>()
  
  // Process dates from oldest to newest for running balance
  const datesAsc = [...sortedDates].reverse()
  for (const date of datesAsc) {
    const cashIn = collectionsByDate.get(date) || 0
    const cashOut = depositsByDate.get(date) || 0
    runningBalance = runningBalance + cashIn - cashOut
    entriesByDate.set(date, { cashIn, cashOut, balance: runningBalance })
  }

  // Build entries list in descending order (newest first)
  const entries = sortedDates.map(date => ({
    date,
    ...entriesByDate.get(date)!
  }))

  // Calculate totals
  const totalCollected = [...collectionsByDate.values()].reduce((t, v) => t + v, 0)
  const totalDeposited = [...depositsByDate.values()].reduce((t, v) => t + v, 0)
  const cashInHand = totalCollected - totalDeposited

  return (
    <BalancePage
      entries={entries}
      deposits={(deposits || []).map(d => ({
        id: d.id,
        deposit_date: d.deposit_date,
        amount: Number(d.amount),
        bank_name: d.bank_name,
        reference_number: d.reference_number,
        notes: d.notes,
      }))}
      totals={{
        totalCollected,
        totalDeposited,
        cashInHand,
        openingBalance: 0,
      }}
      denomTotals={denomTotals}
      userId={user.id}
    />
  )
}
