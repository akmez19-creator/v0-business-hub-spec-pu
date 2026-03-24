import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RiderMobileLayout } from '@/components/rider/mobile-layout'
import { RiderDashboardContent } from '@/components/rider/dashboard-content'
import { NON_PAYOUT_FILTER, isPayoutEligible } from '@/lib/types'

export default async function RiderDashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, rider_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/login')

  // Get rider record
  let rider = null
  const { data: riderByProfile } = await supabase
    .from('riders')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (riderByProfile) {
    rider = riderByProfile
  } else if (profile.rider_id) {
    const { data: riderById } = await supabase
      .from('riders')
      .select('*')
      .eq('id', profile.rider_id)
      .single()
    rider = riderById
  }

  if (!rider) {
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
            Your account has not been linked to a rider record yet.
            Please contact an administrator to link your account.
          </p>
        </div>
      </div>
    )
  }

  // Payment settings - same client, same pattern as working earnings page
  const { data: psRows } = await supabase
    .from('rider_payment_settings')
    .select('*')
    .eq('rider_id', rider.id)
    .order('effective_from', { ascending: false })
    .limit(1)

  const paymentSettings = psRows?.[0] || null
  const riderRate = Number(paymentSettings?.per_delivery_rate || 90)

  // Date helpers
  const today = new Date().toISOString().split('T')[0]
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthStartStr = monthStart.toISOString().split('T')[0]

  function countUniqueClients(rows: { customer_name: string; contact_1: string; delivery_date: string }[]) {
    const seen = new Set<string>()
    for (const r of rows) {
      seen.add(`${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}`)
    }
    return seen.size
  }

  // Today's deliveries (all statuses for progress) - same client
  const { data: allTodayRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date, status, sales_type')
    .eq('rider_id', rider.id)
    .eq('delivery_date', today)

  const allToday = allTodayRows || []
  const todayClientMap = new Map<string, { status: string; sales_type: string | null }>()
  for (const d of allToday) {
    const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}`
    if (!todayClientMap.has(key)) todayClientMap.set(key, { status: d.status, sales_type: d.sales_type })
  }
  const todayEntries = Array.from(todayClientMap.values())
  const todayTotal = todayClientMap.size
  const todayDelivered = todayEntries.filter(e => e.status === 'delivered').length
  const todayPayableDelivered = todayEntries.filter(e => e.status === 'delivered' && isPayoutEligible(e.sales_type)).length
  const todayLeft = todayEntries.filter(e => ['pending', 'assigned', 'picked_up'].includes(e.status)).length
  const todayFailed = todayEntries.filter(e => ['nwd', 'cms'].includes(e.status)).length

  // Month delivered rows (covers week too) - same client
  const { data: monthRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)
    .gte('delivery_date', monthStartStr)

  const allMonthRows = monthRows || []
  const todayDeliveredRows = allMonthRows.filter(r => r.delivery_date === today)
  const weekRows = allMonthRows.filter(r => r.delivery_date >= weekStartStr)

  const weekDelivered = countUniqueClients(weekRows)
  const monthDelivered = countUniqueClients(allMonthRows)

  // Lifetime delivered - same client
  const { data: lifetimeRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  const lifetimeDelivered = countUniqueClients(lifetimeRows || [])

  // Payouts received - same client
  const { data: payoutsData } = await supabase
    .from('payment_transactions')
    .select('amount, created_at, description')
    .eq('recipient_id', rider.id)
    .eq('recipient_type', 'rider')
    .eq('transaction_type', 'payout')
    .order('created_at', { ascending: false })

  const payouts = payoutsData || []
  const totalPaidOut = payouts.reduce((s, p) => s + Number(p.amount || 0), 0)

  // Stock - same client
  const { data: stockRows } = await supabase
    .from('rider_stock')
    .select('*')
    .eq('rider_id', rider.id)
    .eq('stock_date', today)
    .limit(1)

  const todayStock = stockRows?.[0] || null

  // Gamification
  const level = Math.floor(lifetimeDelivered / 50) + 1
  const xpInCurrentLevel = lifetimeDelivered % 50

  return (
    <RiderMobileLayout
      profile={profile}
      level={level}
      xp={xpInCurrentLevel}
      xpToNextLevel={50}
    >
      <RiderDashboardContent
        rider={rider}
        profile={profile}
        stats={{
          todayTotal,
          todayDelivered,
          todayLeft,
          todayFailed,
          todayEarnings: todayPayableDelivered * riderRate,
          weekDelivered,
          weekEarnings: weekDelivered * riderRate,
          monthDelivered,
          monthEarnings: monthDelivered * riderRate,
          lifetimeDelivered,
          lifetimeEarnings: lifetimeDelivered * riderRate,
          totalPaidOut,
          balanceOwed: (lifetimeDelivered * riderRate) - totalPaidOut,
          riderRate,
        }}
        stock={todayStock}
        recentPayouts={payouts.slice(0, 5)}
        level={level}
        xp={xpInCurrentLevel}
        xpToNextLevel={50}
      />
    </RiderMobileLayout>
  )
}
