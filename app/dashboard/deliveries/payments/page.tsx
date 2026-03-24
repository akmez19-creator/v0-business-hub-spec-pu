import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PaymentsOverview } from '@/components/deliveries/payments-overview'
import { NON_PAYOUT_FILTER } from '@/lib/types'

export default async function PaymentsPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Fetch riders
  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name, phone, contractor_id')
    .eq('is_active', true)
    .order('name')

  // Fetch contractors with their rate and pay type
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name, phone, email, rate_per_delivery, pay_type, monthly_salary')
    .eq('is_active', true)
    .order('name')

  // Fetch ALL delivered deliveries to auto-compute earnings (exclude non-payout types)
  const { data: allDelivered } = await adminDb
    .from('deliveries')
    .select('rider_id, customer_name, contact_1, delivery_date')
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  // Build rider -> contractor map
  const riderContractorMap: Record<string, string> = {}
  for (const r of riders || []) {
    if (r.contractor_id) riderContractorMap[r.id] = r.contractor_id
  }

  // Date ranges for monthly breakdown
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]

  // Compute unique deliveries per contractor (total, this month, last month)
  const contractorDeliveryCounts: Record<string, number> = {}
  const contractorThisMonthCounts: Record<string, number> = {}
  const contractorLastMonthCounts: Record<string, number> = {}

  // Group deliveries by contractor
  const contractorDeliveryKeys: Record<string, Set<string>> = {}
  const contractorThisMonthKeys: Record<string, Set<string>> = {}
  const contractorLastMonthKeys: Record<string, Set<string>> = {}

  for (const d of allDelivered || []) {
    if (!d.rider_id) continue
    const cId = riderContractorMap[d.rider_id]
    if (!cId) continue
    const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id}`

    if (!contractorDeliveryKeys[cId]) contractorDeliveryKeys[cId] = new Set()
    contractorDeliveryKeys[cId].add(key)

    if (d.delivery_date >= thisMonthStart) {
      if (!contractorThisMonthKeys[cId]) contractorThisMonthKeys[cId] = new Set()
      contractorThisMonthKeys[cId].add(key)
    }

    if (d.delivery_date >= lastMonthStart && d.delivery_date <= lastMonthEnd) {
      if (!contractorLastMonthKeys[cId]) contractorLastMonthKeys[cId] = new Set()
      contractorLastMonthKeys[cId].add(key)
    }
  }

  // Contractor rate map + earnings
  const contractorRateMap: Record<string, number> = {}
  const contractorEarnings: Record<string, number> = {}
  const contractorThisMonthEarnings: Record<string, number> = {}
  const contractorLastMonthEarnings: Record<string, number> = {}

  // Track fixed monthly salary as a deduction from delivery earnings
  const contractorMonthlySalary: Record<string, number> = {}

  for (const c of contractors || []) {
    const rate = Number(c.rate_per_delivery || 90)
    const salary = Number(c.monthly_salary || 0)
    contractorRateMap[c.id] = rate
    contractorMonthlySalary[c.id] = salary

    const totalCount = contractorDeliveryKeys[c.id]?.size || 0
    const thisCount = contractorThisMonthKeys[c.id]?.size || 0
    const lastCount = contractorLastMonthKeys[c.id]?.size || 0
    contractorDeliveryCounts[c.id] = totalCount
    contractorThisMonthCounts[c.id] = thisCount
    contractorLastMonthCounts[c.id] = lastCount

    // Always calculate per-delivery earnings
    contractorEarnings[c.id] = totalCount * rate
    contractorThisMonthEarnings[c.id] = thisCount * rate
    contractorLastMonthEarnings[c.id] = lastCount * rate
  }

  // Fetch payouts to contractors (what admin has actually paid out)
  const { data: payoutTransactions } = await adminDb
    .from('payment_transactions')
    .select('*, wallets (owner_type, owner_id)')
    .eq('transaction_type', 'payout')
    .eq('payer_type', 'admin')

  const contractorPaidOut: Record<string, number> = {}
  for (const tx of payoutTransactions || []) {
    if (!tx.wallets || tx.wallets.owner_type !== 'contractor') continue
    const amt = Math.abs(Number(tx.amount || 0))
    contractorPaidOut[tx.wallets.owner_id] = (contractorPaidOut[tx.wallets.owner_id] || 0) + amt
  }

  // Fetch all admin transactions for history
  const { data: recentTransactions } = await adminDb
    .from('payment_transactions')
    .select('*, wallets (owner_type, owner_id)')
    .order('created_at', { ascending: false })
    .limit(50)

  // Fetch contractor wallets
  const { data: wallets } = await adminDb
    .from('wallets')
    .select('*')
    .eq('owner_type', 'contractor')

  const contractorWallets: Record<string, any> = {}
  for (const wallet of wallets || []) {
    contractorWallets[wallet.owner_id] = wallet
  }

  // Fetch pending/approved contractor withdrawal requests
  const { data: withdrawalRequests } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'contractor')
    .in('status', ['pending', 'approved'])
    .order('requested_at', { ascending: false })

  // Summary totals
  const totalContractorEarnings = Object.values(contractorEarnings).reduce((s, e) => s + e, 0)
  const totalContractorPaidOut = Object.values(contractorPaidOut).reduce((s, p) => s + p, 0)
  const totalContractorOwed = totalContractorEarnings - totalContractorPaidOut
  const totalThisMonth = Object.values(contractorThisMonthEarnings).reduce((s, e) => s + e, 0)
  const totalLastMonth = Object.values(contractorLastMonthEarnings).reduce((s, e) => s + e, 0)

  // Count riders per contractor
  const ridersPerContractor: Record<string, number> = {}
  for (const r of riders || []) {
    if (r.contractor_id) {
      ridersPerContractor[r.contractor_id] = (ridersPerContractor[r.contractor_id] || 0) + 1
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Payments & Wallets</h1>
        <p className="text-muted-foreground">Contractor earnings auto-calculated from delivered orders. Record payouts when contractors are paid.</p>
      </div>

      <PaymentsOverview
        contractors={contractors || []}
        contractorWallets={contractorWallets}
        contractorRateMap={contractorRateMap}
        contractorMonthlySalary={contractorMonthlySalary}
        contractorEarnings={contractorEarnings}
        contractorThisMonthEarnings={contractorThisMonthEarnings}
        contractorLastMonthEarnings={contractorLastMonthEarnings}
        contractorPaidOut={contractorPaidOut}
        contractorDeliveryCounts={contractorDeliveryCounts}
        contractorThisMonthCounts={contractorThisMonthCounts}
        contractorLastMonthCounts={contractorLastMonthCounts}
        ridersPerContractor={ridersPerContractor}
        recentTransactions={recentTransactions || []}
        totalContractorEarnings={totalContractorEarnings}
        totalContractorPaidOut={totalContractorPaidOut}
        totalContractorOwed={totalContractorOwed}
        totalThisMonth={totalThisMonth}
        totalLastMonth={totalLastMonth}
        withdrawalRequests={withdrawalRequests || []}
      />
    </div>
  )
}
