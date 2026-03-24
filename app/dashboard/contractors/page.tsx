import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorDashboardContent } from '@/components/contractor/dashboard-content'
import { NON_PAYOUT_FILTER, isPayoutEligible } from '@/lib/types'

export default async function ContractorDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/dashboard')

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
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground">Account Not Linked</h2>
          <p className="text-muted-foreground">
            Your account has not been linked to a contractor record yet.
            Please contact an administrator to link your account.
          </p>
        </div>
      </div>
    )
  }

  // All riders under this contractor - same client for everything
  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, is_active')
    .eq('contractor_id', contractor.id)

  const allRiderIds = allRiders?.map(r => r.id) || []
  const contractorAsRider = allRiders?.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null
  const teamRiders = allRiders?.filter(r =>
    contractorAsRider ? r.id !== contractorAsRider.id : true
  ) || []

  // Payment settings for all riders - same client
  const { data: allPaymentSettings } = await supabase
    .from('rider_payment_settings')
    .select('rider_id, per_delivery_rate')
    .in('rider_id', allRiderIds.length > 0 ? allRiderIds : ['none'])

  const riderRateMap: Record<string, number> = {}
  for (const rid of allRiderIds) {
    riderRateMap[rid] = 90
  }
  for (const ps of (allPaymentSettings || [])) {
    riderRateMap[ps.rider_id] = Number(ps.per_delivery_rate || 90)
  }

  // Date helpers
  const today = new Date().toISOString().split('T')[0]
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthStartStr = monthStart.toISOString().split('T')[0]

  function computeEarnings(rows: { customer_name: string; contact_1: string; delivery_date: string; rider_id: string }[]) {
    const seen = new Set<string>()
    let earnings = 0
    for (const r of rows) {
      const key = `${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}|${r.rider_id}`
      if (!seen.has(key)) {
        seen.add(key)
        earnings += riderRateMap[r.rider_id] || 90
      }
    }
    return { count: seen.size, earnings }
  }

  // Today's deliveries - same client
  let todayDeliveries: any[] = []
  if (allRiderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('customer_name, contact_1, delivery_date, status, rider_id, sales_type')
      .in('rider_id', allRiderIds)
      .eq('delivery_date', today)
    todayDeliveries = data || []
  }

  const todayClientMap = new Map<string, { status: string; rider_id: string; sales_type: string | null }>()
  for (const d of todayDeliveries) {
    const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.rider_id}`
    if (!todayClientMap.has(key)) todayClientMap.set(key, { status: d.status, rider_id: d.rider_id, sales_type: d.sales_type })
  }
  const todayEntries = Array.from(todayClientMap.values())
  const todayTotal = todayClientMap.size
  const todayDelivered = todayEntries.filter(e => e.status === 'delivered').length
  const todayLeft = todayEntries.filter(e => ['pending', 'assigned', 'picked_up'].includes(e.status)).length
  const todayFailed = todayEntries.filter(e => ['nwd', 'cms'].includes(e.status)).length
  const todayEarnings = todayEntries
    .filter(e => e.status === 'delivered' && isPayoutEligible(e.sales_type))
    .reduce((s, e) => s + (riderRateMap[e.rider_id] || 90), 0)

  // Month delivered (covers week) - same client
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

  const weekRows = monthRows.filter(r => r.delivery_date >= weekStartStr)
  const weekStats = computeEarnings(weekRows)
  const monthStats = computeEarnings(monthRows)

  // Lifetime - same client
  let lifetimeRows: any[] = []
  if (allRiderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('customer_name, contact_1, delivery_date, rider_id')
      .in('rider_id', allRiderIds)
      .eq('status', 'delivered')
      .not('sales_type', 'in', NON_PAYOUT_FILTER)
    lifetimeRows = data || []
  }
  const lifetimeStats = computeEarnings(lifetimeRows)

  // Payouts - same client
  const { data: contractorPayouts } = await supabase
    .from('payment_transactions')
    .select('amount, created_at, description')
    .eq('recipient_id', contractor.id)
    .eq('recipient_type', 'contractor')
    .eq('transaction_type', 'payout')
    .order('created_at', { ascending: false })

  const payouts = contractorPayouts || []
  const totalPaidOut = payouts.reduce((s, p) => s + Number(p.amount || 0), 0)

  // Per-rider breakdown for today
  const riderBreakdown = allRiders?.map(r => {
    const rDeliveries = todayDeliveries.filter(d => d.rider_id === r.id)
    const clientMap = new Map<string, { status: string; sales_type: string | null }>()
    for (const d of rDeliveries) {
      const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}`
      if (!clientMap.has(key)) clientMap.set(key, { status: d.status, sales_type: d.sales_type })
    }
    const entries = Array.from(clientMap.values())
    const delivered = entries.filter(e => e.status === 'delivered').length
    const payableDelivered = entries.filter(e => e.status === 'delivered' && isPayoutEligible(e.sales_type)).length
    const rate = riderRateMap[r.id] || 90
    return {
      id: r.id,
      name: r.name,
      total: clientMap.size,
      delivered,
      left: entries.filter(e => ['pending', 'assigned', 'picked_up'].includes(e.status)).length,
      failed: entries.filter(e => ['nwd', 'cms'].includes(e.status)).length,
      earnings: payableDelivered * rate,
      rate,
      isContractorSelf: contractorAsRider?.id === r.id,
    }
  }) || []

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
      <ContractorDashboardContent
        contractor={contractor}
        stats={{
          todayTotal,
          todayDelivered,
          todayLeft,
          todayFailed,
          todayEarnings,
          weekDelivered: weekStats.count,
          weekEarnings: weekStats.earnings,
          monthDelivered: monthStats.count,
          monthEarnings: monthStats.earnings,
          lifetimeDelivered: lifetimeStats.count,
          lifetimeEarnings: lifetimeStats.earnings,
          totalPaidOut,
          balanceOwed: lifetimeStats.earnings - totalPaidOut,
          totalRiders: allRiders?.length || 0,
          activeRiders: allRiders?.filter(r => r.is_active).length || 0,
        }}
        riderBreakdown={riderBreakdown}
        recentPayouts={payouts.slice(0, 5)}
      />
    </ContractorMobileLayout>
  )
}
