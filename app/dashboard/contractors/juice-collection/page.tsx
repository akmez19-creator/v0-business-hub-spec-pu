import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorJuiceCollectionPage } from '@/components/contractor/juice-collection-page'

// Contractor juice (MCB Juice) collection with counting
export default async function ContractorJuiceCollectionRoute({
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

  // Get all juice deliveries (not yet collected by store) for this month
  // payment_method = 'juice' indicates Juice payment, amount holds the value
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: juiceDeliveries } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, amount, delivery_date, rider_id, juice_collected, contractor_juice_counted, contractor_juice_counted_at')
    .in('rider_id', riderIds)
    .eq('payment_method', 'juice')
    .eq('juice_collected', false) // Only deliveries not yet collected by store
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('delivery_date', { ascending: false })

  // Also get deliveries that HAVE been collected by store (to show in separate section)
  const { data: collectedByStore } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, amount, delivery_date, rider_id, juice_collected_at')
    .in('rider_id', riderIds)
    .eq('payment_method', 'juice')
    .eq('juice_collected', true)
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('juice_collected_at', { ascending: false })

  const deliveries = (juiceDeliveries || []).map(d => ({
    ...d,
    payment_juice: Number(d.amount || 0), // Map amount to payment_juice for component
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
  }))

  const collectedDeliveries = (collectedByStore || []).map(d => ({
    ...d,
    payment_juice: Number(d.amount || 0), // Map amount to payment_juice for component
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
      <ContractorJuiceCollectionPage
        contractorId={contractor.id}
        deliveries={deliveries}
        collectedByStore={collectedDeliveries}
        availableDates={availableDates}
        selectedDate={selectedDate}
      />
    </ContractorMobileLayout>
  )
}
