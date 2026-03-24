import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorCashCollectionPage } from '@/components/contractor/cash-collection-page'

// Contractor cash collection with edit functionality - v2
export default async function ContractorCashCollectionRoute({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  const params = await searchParams

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/dashboard')

  // Get contractor
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

  // Get riders for this contractor
  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name')
    .eq('contractor_id', contractor.id)

  const riderIds = (riders || []).map(r => r.id)
  const riderMap: Record<string, string> = Object.fromEntries((riders || []).map(r => [r.id, r.name]))

  if (riderIds.length === 0) {
    return (
      <ContractorMobileLayout
        profile={profile}
        companyName={contractor.name}
        photoUrl={contractor.photo_url}
        riderCount={0}
        hasPartners={contractor.has_partners ?? false}
      >
        <div className="p-4 text-center text-muted-foreground">
          No riders assigned to you yet.
        </div>
      </ContractorMobileLayout>
    )
  }

  // Get all cash deliveries (not yet collected by store) for this month
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: cashDeliveries } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, payment_cash, delivery_date, rider_id, cash_collected, contractor_cash_counted, contractor_cash_denoms, contractor_cash_counted_at')
    .in('rider_id', riderIds)
    .gt('payment_cash', '0')
    .eq('cash_collected', false) // Only deliveries not yet collected by store
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('delivery_date', { ascending: false })

  // Also get deliveries that HAVE been collected by store (to show in separate section)
  const { data: collectedByStore } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, payment_cash, delivery_date, rider_id, cash_collected_at')
    .in('rider_id', riderIds)
    .gt('payment_cash', '0')
    .eq('cash_collected', true)
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('cash_collected_at', { ascending: false })

  const deliveries = (cashDeliveries || []).map(d => ({
    ...d,
    payment_cash: Number(d.payment_cash || 0),
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
  }))

  const collectedDeliveries = (collectedByStore || []).map(d => ({
    ...d,
    payment_cash: Number(d.payment_cash || 0),
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
  }))

  // Get unique dates
  const availableDates = [...new Set(deliveries.map(d => d.delivery_date))].sort((a, b) => b.localeCompare(a))
  const selectedDate = params.date || availableDates[0] || new Date().toISOString().split('T')[0]

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor.name}
      photoUrl={contractor.photo_url}
      riderCount={riders?.length || 0}
      hasPartners={contractor.has_partners ?? false}
    >
      <ContractorCashCollectionPage
        contractorId={contractor.id}
        deliveries={deliveries}
        collectedByStore={collectedDeliveries}
        availableDates={availableDates}
        selectedDate={selectedDate}
      />
    </ContractorMobileLayout>
  )
}
