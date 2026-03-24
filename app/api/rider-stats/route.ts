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
    .select('*, rider_id')
    .eq('id', user.id)
    .single()

  // Find rider
  let rider: { id: string } | null = null
  const { data: riderByProfile } = await supabase
    .from('riders')
    .select('id')
    .eq('profile_id', user.id)
    .single()

  if (riderByProfile) {
    rider = riderByProfile
  } else if (profile?.rider_id) {
    const { data: riderById } = await supabase
      .from('riders')
      .select('id')
      .eq('id', profile.rider_id)
      .single()
    rider = riderById
  }

  if (!rider) {
    return NextResponse.json({ balanceOwed: 0, activeDeliveries: 0, riderRate: 90 })
  }

  // Payment settings
  const { data: psRows } = await supabase
    .from('rider_payment_settings')
    .select('per_delivery_rate')
    .eq('rider_id', rider.id)
    .order('effective_from', { ascending: false })
    .limit(1)

  const riderRate = Number(psRows?.[0]?.per_delivery_rate || 90)

  // Count lifetime delivered (unique clients per day) — exclude non-payout types
  const { data: deliveredRows } = await supabase
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date')
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  const seen = new Set<string>()
  for (const r of (deliveredRows || [])) {
    seen.add(`${(r.customer_name || '').trim().toLowerCase()}|${(r.contact_1 || '').trim()}|${r.delivery_date}`)
  }
  const totalEarnings = seen.size * riderRate

  // Count payouts
  const { data: payouts } = await supabase
    .from('payment_transactions')
    .select('amount')
    .eq('recipient_id', rider.id)
    .eq('recipient_type', 'rider')
    .eq('transaction_type', 'payout')

  const totalPaidOut = (payouts || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const balanceOwed = totalEarnings - totalPaidOut

  // Count active deliveries (today, not yet done)
  const today = new Date().toISOString().split('T')[0]
  const { data: activeRows } = await supabase
    .from('deliveries')
    .select('id')
    .eq('rider_id', rider.id)
    .eq('delivery_date', today)
    .in('status', ['pending', 'assigned', 'picked_up'])

  return NextResponse.json({
    balanceOwed,
    activeDeliveries: activeRows?.length || 0,
    riderRate,
  })
}
