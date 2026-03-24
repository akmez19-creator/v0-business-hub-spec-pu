import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { NON_PAYOUT_FILTER } from '@/lib/types'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile?.contractor_id) {
    return NextResponse.json({ balanceOwed: 0, activeDeliveries: 0, activeRiders: 0, riderCount: 0 })
  }

  // Get contractor
  const { data: contractor } = await supabase
    .from('contractors')
    .select('id')
    .eq('id', profile.contractor_id)
    .single()

  if (!contractor) {
    return NextResponse.json({ balanceOwed: 0, activeDeliveries: 0, activeRiders: 0, riderCount: 0 })
  }

  // Get riders under this contractor
  const { data: riders } = await supabase
    .from('riders')
    .select('id, is_active')
    .eq('contractor_id', contractor.id)

  const riderIds = riders?.map(r => r.id) || []
  const riderCount = riderIds.length
  const activeRiders = riders?.filter(r => r.is_active).length || 0

  if (riderIds.length === 0) {
    return NextResponse.json({ balanceOwed: 0, activeDeliveries: 0, activeRiders: 0, riderCount: 0 })
  }

  // Get the contractor rate (what admin pays per delivery to the contractor)
  const { data: contractorData } = await supabase
    .from('contractors')
    .select('rate_per_delivery')
    .eq('id', contractor.id)
    .single()

  const contractorRate = Number(contractorData?.rate_per_delivery || 0)

  // Count lifetime delivered (unique clients per day per rider) at contractor rate — exclude non-payout types
  const { data: deliveredRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date, rider_id')
    .in('rider_id', riderIds)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  const seen = new Set<string>()
  for (const r of (deliveredRows || [])) {
    const key = `${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}|${r.rider_id}`
    seen.add(key)
  }
  const totalEarnings = seen.size * contractorRate

  // Count payouts
  const { data: payouts } = await supabase
    .from('payment_transactions')
    .select('amount')
    .eq('recipient_type', 'contractor')
    .eq('recipient_id', contractor.id)
    .eq('transaction_type', 'payout')

  const totalPaidOut = (payouts || []).reduce((s, p) => s + Number(p.amount || 0), 0)

  // Get the contractor's fixed monthly salary (deduction)
  const { data: contractorFull } = await supabase
    .from('contractors')
    .select('monthly_salary')
    .eq('id', contractor.id)
    .single()
  
  const monthlySalary = Number(contractorFull?.monthly_salary || 0)

  // Get wallet adjustments (opening balance, admin credits/debits)
  const { data: wallet } = await supabase
    .from('wallets')
    .select('balance')
    .eq('owner_type', 'contractor')
    .eq('owner_id', contractor.id)
    .single()
  
  const walletAdjustments = Number(wallet?.balance || 0)

  // Total balance = wallet adjustments (opening balance) + calculated earnings - payouts
  const calculatedEarnings = totalEarnings - totalPaidOut
  const balanceBeforeSalary = walletAdjustments + calculatedEarnings
  const balanceAfterSalary = Math.max(0, balanceBeforeSalary - monthlySalary)

  // Count active deliveries (today, not delivered/nwd/cms)
  const today = new Date().toISOString().split('T')[0]
  const { data: activeRows } = await supabase
    .from('deliveries')
    .select('id')
    .in('rider_id', riderIds)
    .eq('delivery_date', today)
    .in('status', ['pending', 'assigned', 'picked_up'])

  return NextResponse.json({
    balanceOwed: balanceBeforeSalary,
    balanceAfterSalary,
    monthlySalary,
    activeDeliveries: activeRows?.length || 0,
    activeRiders,
    riderCount,
  })
}
