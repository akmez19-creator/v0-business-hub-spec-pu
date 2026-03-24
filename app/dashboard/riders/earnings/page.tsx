import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RiderMobileLayout } from '@/components/rider/mobile-layout'
import { RiderEarningsContent } from '@/components/rider/earnings-content'
import { NON_PAYOUT_FILTER } from '@/lib/types'

export default async function RiderEarningsPage() {
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
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Rider profile not found</p>
      </div>
    )
  }

  // Payment settings
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
  const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  const lastMonthStartStr = lastMonthStart.toISOString().split('T')[0]
  const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0)
  const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0]

  function countUniqueClients(rows: { customer_name: string; contact_1: string; delivery_date: string }[]) {
    const seen = new Set<string>()
    for (const r of rows) {
      seen.add(`${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}`)
    }
    return seen.size
  }

  // Month delivered rows
  const { data: monthRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)
    .gte('delivery_date', monthStartStr)

  // Last month rows
  const { data: lastMonthData } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)
    .gte('delivery_date', lastMonthStartStr)
    .lte('delivery_date', lastMonthEndStr)

  const lastMonthClients = countUniqueClients(lastMonthData || [])

  const allMonthRows = monthRows || []
  const todayRows = allMonthRows.filter(r => r.delivery_date === today)
  const weekRows = allMonthRows.filter(r => r.delivery_date >= weekStartStr)

  const todayClients = countUniqueClients(todayRows)
  const weekClients = countUniqueClients(weekRows)
  const monthClients = countUniqueClients(allMonthRows)

  // Lifetime
  const { data: lifetimeRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  const lifetimeClients = countUniqueClients(lifetimeRows || [])

  // Payouts received
  const { data: payoutsData } = await supabase
    .from('payment_transactions')
    .select('amount, created_at, description')
    .eq('recipient_id', rider.id)
    .eq('recipient_type', 'rider')
    .eq('transaction_type', 'payout')
    .order('created_at', { ascending: false })

  const payouts = payoutsData || []
  const totalPaidOut = payouts.reduce((s, p) => s + Number(p.amount || 0), 0)

  // Pending withdrawal requests for this rider
  const { data: pendingWithdrawals } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'rider')
    .eq('requester_id', rider.id)
    .order('requested_at', { ascending: false })
    .limit(10)

  const level = Math.floor(lifetimeClients / 50) + 1
  const xpInCurrentLevel = lifetimeClients % 50

  return (
    <RiderMobileLayout
      profile={profile}
      level={level}
      xp={xpInCurrentLevel}
      xpToNextLevel={50}
    >
      <RiderEarningsContent
        paymentSettings={paymentSettings}
        stats={{
          todayEarnings: todayClients * riderRate,
          todayDelivered: todayClients,
          weeklyEarnings: weekClients * riderRate,
          weekDelivered: weekClients,
          monthlyEarnings: monthClients * riderRate,
          monthDelivered: monthClients,
          lastMonthEarnings: lastMonthClients * riderRate,
          lastMonthDelivered: lastMonthClients,
          lifetimeEarnings: lifetimeClients * riderRate,
          lifetimeDelivered: lifetimeClients,
          totalPaidOut,
          balanceOwed: (lifetimeClients * riderRate) - totalPaidOut,
          riderRate,
        }}
        recentPayouts={payouts.slice(0, 10)}
        riderId={rider.id}
        pendingWithdrawals={pendingWithdrawals || []}
      />
    </RiderMobileLayout>
  )
}
