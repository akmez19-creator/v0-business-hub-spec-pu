import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorEarningsContent } from '@/components/contractor/earnings-content'
import { NON_PAYOUT_FILTER } from '@/lib/types'

export default async function ContractorEarningsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/login')

  // Get contractor record
  let contractor = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (contractorByProfile) {
    contractor = contractorByProfile
  } else if (profile.contractor_id) {
    const { data: contractorById } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', profile.contractor_id)
      .single()
    contractor = contractorById
  }

  if (!contractor) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Contractor profile not found</p>
      </div>
    )
  }

  // Get all riders under this contractor
  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, is_active')
    .eq('contractor_id', contractor.id)

  const allRiderIds = (allRiders || []).map(r => r.id)
  const contractorAsRider = allRiders?.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null

  // Payment settings for all riders
  const { data: allPaymentSettings } = await supabase
    .from('rider_payment_settings')
    .select('rider_id, per_delivery_rate')
    .in('rider_id', allRiderIds.length > 0 ? allRiderIds : ['none'])

  const riderRateMap: Record<string, number> = {}
  for (const rid of allRiderIds) {
    riderRateMap[rid] = 90 // default Rs 90
  }
  for (const ps of (allPaymentSettings || [])) {
    riderRateMap[ps.rider_id] = Number(ps.per_delivery_rate || 90)
  }

  // Date helpers
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  // Past working day (skip weekends: if Mon -> Fri, if Sun -> Fri, if Sat -> Fri)
  const pastWorkDay = new Date(now)
  pastWorkDay.setDate(pastWorkDay.getDate() - 1)
  while (pastWorkDay.getDay() === 0 || pastWorkDay.getDay() === 6) {
    pastWorkDay.setDate(pastWorkDay.getDate() - 1)
  }
  const pastWorkDayStr = pastWorkDay.toISOString().split('T')[0]

  // This week (Monday-based)
  const weekStart = new Date(now)
  const dayOfWeek = weekStart.getDay()
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  weekStart.setDate(weekStart.getDate() - diffToMonday)
  const weekStartStr = weekStart.toISOString().split('T')[0]

  // This month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthStartStr = monthStart.toISOString().split('T')[0]

  // Past month
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthStartStr = lastMonthStart.toISOString().split('T')[0]
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0]

  // Contractor rate (what admin pays per delivery) vs rider rates (what contractor pays riders)
  const contractorRate = Number(contractor.rate_per_delivery || 0)

  // Helper: count unique delivered clients and contractor earnings (at contractor rate)
  function computeContractorEarnings(rows: { customer_name: string; contact_1: string; delivery_date: string; rider_id: string }[]) {
    const seen = new Set<string>()
    for (const r of rows) {
      const key = `${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}|${r.rider_id}`
      seen.add(key)
    }
    return { count: seen.size, earnings: seen.size * contractorRate }
  }

  // Helper: compute what contractor owes OTHER riders only (excluding contractor-as-rider)
  const selfRiderId = contractorAsRider?.id || null
  function computeRiderCosts(rows: { customer_name: string; contact_1: string; delivery_date: string; rider_id: string }[]) {
    let totalCost = 0
    const perRider: Record<string, Set<string>> = {}
    for (const r of rows) {
      // Skip the contractor's own deliveries -- those are their own rider earnings
      if (r.rider_id === selfRiderId) continue
      const key = `${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}`
      if (!perRider[r.rider_id]) perRider[r.rider_id] = new Set()
      perRider[r.rider_id].add(key)
    }
    for (const [riderId, keys] of Object.entries(perRider)) {
      totalCost += keys.size * (riderRateMap[riderId] || 90)
    }
    return totalCost
  }

  // Month delivered rows (covers today + week)
  let monthRows: any[] = []
  if (allRiderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('customer_name, contact_1, delivery_date, rider_id')
      .in('rider_id', allRiderIds)
      .eq('status', 'delivered')
      .not('sales_type', 'in', NON_PAYOUT_FILTER)
      .gte('delivery_date', monthStartStr)
    monthRows = data || []
  }

  // Last month rows
  let lastMonthRows: any[] = []
  if (allRiderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('customer_name, contact_1, delivery_date, rider_id')
      .in('rider_id', allRiderIds)
      .eq('status', 'delivered')
      .not('sales_type', 'in', NON_PAYOUT_FILTER)
      .gte('delivery_date', lastMonthStartStr)
      .lte('delivery_date', lastMonthEndStr)
    lastMonthRows = data || []
  }

  // Filter rows by period
  const todayRows = monthRows.filter(r => r.delivery_date === today)
  const pastWorkDayRows = monthRows.filter(r => r.delivery_date === pastWorkDayStr)
  const weekRows = monthRows.filter(r => r.delivery_date >= weekStartStr)

  // Helper: compute self-rider stats for a set of rows
  const selfRate = contractorAsRider ? (riderRateMap[contractorAsRider.id] || 90) : 0
  function computeSelfRiderStats(rows: any[]) {
    if (!contractorAsRider) return { deliveries: 0, earnings: 0 }
    const selfRows = rows.filter(d => d.rider_id === contractorAsRider.id)
    const seen = new Set<string>()
    for (const d of selfRows) {
      seen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
    }
    return { deliveries: seen.size, earnings: seen.size * selfRate }
  }

  // Compute all period stats
  const periods = {
    pastWorkDay: { rows: pastWorkDayRows },
    today: { rows: todayRows },
    week: { rows: weekRows },
    month: { rows: monthRows },
    lastMonth: { rows: lastMonthRows },
  }

  const periodStats: Record<string, {
    contractorEarnings: number
    contractorDeliveries: number
    riderCosts: number
    selfRiderEarnings: number
    selfRiderDeliveries: number
    totalIncome: number
  }> = {}

  for (const [key, { rows }] of Object.entries(periods)) {
    const cStats = computeContractorEarnings(rows)
    const rCosts = computeRiderCosts(rows)
    const sStats = computeSelfRiderStats(rows)
    periodStats[key] = {
      contractorEarnings: cStats.earnings,
      contractorDeliveries: cStats.count,
      riderCosts: rCosts,
      selfRiderEarnings: sStats.earnings,
      selfRiderDeliveries: sStats.deliveries,
      totalIncome: cStats.earnings,
    }
  }

  // Fixed monthly salary is a deduction from delivery earnings (not an override)
  const monthlySalary = Number(contractor.monthly_salary || 0)

  // Payouts to contractor
  const { data: contractorPayouts } = await supabase
    .from('payment_transactions')
    .select('amount, created_at, description')
    .eq('recipient_id', contractor.id)
    .eq('recipient_type', 'contractor')
    .eq('transaction_type', 'payout')
    .order('created_at', { ascending: false })

  const payouts = contractorPayouts || []
  const totalPaidOut = payouts.reduce((s, p) => s + Number(p.amount || 0), 0)

  // Pending withdrawal requests
  const { data: pendingWithdrawals } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'contractor')
    .eq('requester_id', contractor.id)
    .order('requested_at', { ascending: false })
    .limit(10)

  // Rider withdrawal requests (pending + approved for contractor to act on)
  const { data: riderWithdrawals } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'rider')
    .in('status', ['pending', 'approved'])
    .order('requested_at', { ascending: false })

  // Filter to only riders under this contractor
  const pendingRiderWithdrawals = (riderWithdrawals || []).filter(w => 
    allRiderIds.includes(w.requester_id)
  )

  // Per-rider month breakdown (current month)
  const riderEarnings = (allRiders || []).map(r => {
    const rRows = monthRows.filter(d => d.rider_id === r.id)
    const seen = new Set<string>()
    for (const d of rRows) {
      seen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
    }
    const rate = riderRateMap[r.id] || 90
    return {
      id: r.id,
      name: r.name,
      deliveries: seen.size,
      rate,
      earnings: seen.size * rate,
      isContractorSelf: contractorAsRider?.id === r.id,
    }
  }).sort((a, b) => b.earnings - a.earnings)

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor?.name}
      photoUrl={contractor?.photo_url}
      totalEarnings={0}
      riderCount={allRiders?.length || 0}
      isAlsoRider={!!contractorAsRider}
      hasPartners={contractor?.has_partners ?? false}
    >
      <ContractorEarningsContent
        contractor={contractor}
        isAlsoRider={!!contractorAsRider}
        selfRiderRate={selfRate}
        contractorRate={contractorRate}
        monthlySalary={monthlySalary}
        periodStats={periodStats}
        pastWorkDayLabel={pastWorkDay.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        totalPaidOut={totalPaidOut}
        totalRiders={allRiders?.length || 0}
        riderEarnings={riderEarnings}
        recentPayouts={payouts.slice(0, 15)}
        pendingWithdrawals={pendingWithdrawals || []}
        pendingRiderWithdrawals={pendingRiderWithdrawals}
      />
    </ContractorMobileLayout>
  )
}
