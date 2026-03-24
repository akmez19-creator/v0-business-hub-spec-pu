import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { CollectionsOverview } from '@/components/deliveries/collections-overview'

export default async function ContractorCollectionsPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/dashboard')

  // Get contractor record (same pattern as contractor my-deliveries page)
  let contractor = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (contractorByProfile) {
    contractor = contractorByProfile
  } else if (profile?.contractor_id) {
    const { data: contractorById } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', profile.contractor_id)
      .single()
    contractor = contractorById
  }

  if (!contractor) redirect('/dashboard')

  // Get all riders under this contractor
  const { data: riders } = await supabase
    .from('riders')
    .select('id, name, juice_policy')
    .eq('contractor_id', contractor.id)

  const riderIds = (riders || []).map(r => r.id)
  const riderMap: Record<string, string> = {}
  for (const r of riders || []) riderMap[r.id] = r.name

  // Check if contractor is also a rider
  const { data: selfRider } = await supabase
    .from('riders')
    .select('id, name')
    .eq('profile_id', user.id)
    .single()

  if (selfRider && !riderIds.includes(selfRider.id)) {
    riderIds.push(selfRider.id)
    riderMap[selfRider.id] = selfRider.name
  }

  // Fetch last 7 days of DELIVERED deliveries for those riders
  const todayStr = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

  const { data: deliveries } = riderIds.length > 0
    ? await supabase
        .from('deliveries')
        .select('id, customer_name, locality, amount, status, payment_method, payment_juice, payment_cash, payment_bank, payment_status, delivery_date, rider_id, payment_proof_url')
        .in('rider_id', riderIds)
        .gte('delivery_date', sevenDaysAgoStr)
        .lte('delivery_date', todayStr)
        .eq('status', 'delivered')
        .order('delivery_date', { ascending: false })
    : { data: [] }

  const mapped = (deliveries || []).map(d => ({
    id: d.id,
    customer_name: d.customer_name,
    locality: d.locality,
    amount: Number(d.amount || 0),
    payment_method: d.payment_method,
    payment_juice: Number(d.payment_juice || 0),
    payment_cash: Number(d.payment_cash || 0),
    payment_bank: Number(d.payment_bank || 0),
    payment_status: d.payment_status || 'unpaid',
    delivery_date: d.delivery_date,
    status: d.status,
    rider_id: d.rider_id,
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
    payment_proof_url: d.payment_proof_url || null,
  }))

  // Fetch ALL cash deliveries (both pending and collected)
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // Pending collection (not yet collected by store)
  const { data: cashPendingData } = riderIds.length > 0
    ? await adminDb
        .from('deliveries')
        .select('id, index_no, customer_name, payment_cash, cash_collected, contractor_cash_counted, contractor_cash_denoms, contractor_cash_counted_at, cash_collected_at, delivery_date, rider_id')
        .in('rider_id', riderIds)
        .gt('payment_cash', '0')
        .eq('cash_collected', false)
        .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
        .order('delivery_date', { ascending: false })
    : { data: [] }

  // Already collected by store
  const { data: cashCollectedData } = riderIds.length > 0
    ? await adminDb
        .from('deliveries')
        .select('id, index_no, customer_name, payment_cash, cash_collected, contractor_cash_counted, contractor_cash_denoms, contractor_cash_counted_at, cash_collected_at, delivery_date, rider_id')
        .in('rider_id', riderIds)
        .gt('payment_cash', '0')
        .eq('cash_collected', true)
        .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
        .order('cash_collected_at', { ascending: false })
    : { data: [] }

  const cashPending = (cashPendingData || []).map(d => ({
    ...d,
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
  }))

  const cashCollected = (cashCollectedData || []).map(d => ({
    ...d,
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
  }))

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor.name}
      photoUrl={contractor.photo_url}
      riderCount={riders?.length || 0}
      hasPartners={contractor.has_partners ?? false}
    >
      <CollectionsOverview
        deliveries={mapped}
        role="contractor"
        riderJuicePolicies={Object.fromEntries((riders || []).map(r => [r.id, (r as any).juice_policy || 'rider']))}
        cashPendingCollection={cashPending}
        cashCollectedByStore={cashCollected}
      />
    </ContractorMobileLayout>
  )
}
