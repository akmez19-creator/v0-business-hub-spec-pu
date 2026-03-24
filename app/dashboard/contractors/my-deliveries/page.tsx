import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { AssignContent } from '@/components/contractor/assign-content'

export default async function ContractorAssignPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
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
  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, is_active')
    .eq('contractor_id', contractor.id)
    .order('name')

  const riders = allRiders || []
  const riderIds = riders.map(r => r.id)

  const contractorAsRider = riders.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null

  // Get available dates - dates with deliveries for this contractor
  let availableDates: string[] = []
  const dateSet = new Set<string>()

  // Get all dates for deliveries assigned to this contractor (directly via contractor_id)
  const { data: contractorDates } = await supabase
    .from('deliveries')
    .select('delivery_date')
    .eq('contractor_id', contractor.id)
    .not('delivery_date', 'is', null)
    .order('delivery_date', { ascending: false })

  for (const row of contractorDates || []) {
    if (row.delivery_date) dateSet.add(row.delivery_date)
  }

  // Also get dates for deliveries assigned to the contractor's riders
  if (riderIds.length > 0) {
    const { data: riderDates } = await supabase
      .from('deliveries')
      .select('delivery_date')
      .in('rider_id', riderIds)
      .not('delivery_date', 'is', null)
      .order('delivery_date', { ascending: false })

    for (const row of riderDates || []) {
      if (row.delivery_date) dateSet.add(row.delivery_date)
    }
  }

  availableDates = Array.from(dateSet).sort().reverse()

  // Selected date - from URL param or most recent
  const selectedDate = params.date && availableDates.includes(params.date)
    ? params.date
    : availableDates[0] || new Date().toISOString().split('T')[0]

  // Fetch deliveries for selected date
  let deliveries: any[] = []
  if (riderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('id, customer_name, contact_1, contact_2, locality, status, delivery_date, rider_id, index_no, qty, products, amount, notes, sales_type, return_product')
      .in('rider_id', riderIds)
      .eq('delivery_date', selectedDate)
      .order('locality', { ascending: true })
      .order('created_at', { ascending: true })

    deliveries = data || []
  }

  // Also get unassigned deliveries for this date
  const { data: unassigned } = await supabase
    .from('deliveries')
    .select('id, customer_name, contact_1, contact_2, locality, status, delivery_date, rider_id, index_no, qty, products, amount, notes, sales_type, return_product')
    .eq('contractor_id', contractor.id)
    .is('rider_id', null)
    .eq('delivery_date', selectedDate)
    .order('locality', { ascending: true })

  if (unassigned && unassigned.length > 0) {
    deliveries = [...unassigned, ...deliveries]
  }

  // Also get deliveries with no date assigned (null delivery_date) or status = 'assign'
  const { data: noDateDeliveries } = await supabase
    .from('deliveries')
    .select('id, customer_name, contact_1, contact_2, locality, status, delivery_date, rider_id, index_no, qty, products, amount, notes, sales_type, return_product')
    .eq('contractor_id', contractor.id)
    .or('delivery_date.is.null,status.eq.assign')
    .order('locality', { ascending: true })

  if (noDateDeliveries && noDateDeliveries.length > 0) {
    // Avoid duplicates
    const existingIds = new Set(deliveries.map(d => d.id))
    const newOnes = noDateDeliveries.filter(d => !existingIds.has(d.id))
    deliveries = [...deliveries, ...newOnes]
  }

  // Fetch rider-region defaults with sort order
  const { data: regionDefaults } = await supabase
    .from('rider_region_defaults')
    .select('rider_id, locality, sort_order')
    .eq('contractor_id', contractor.id)
    .order('sort_order', { ascending: true })

  // Build locality list from this contractor's actual deliveries
  const localitySet = new Set<string>()
  if (riderIds.length > 0) {
    const { data: locRows } = await supabase
      .from('deliveries')
      .select('locality')
      .in('rider_id', riderIds)
      .not('locality', 'is', null)
    for (const row of locRows || []) {
      if (row.locality?.trim()) localitySet.add(row.locality.trim())
    }
  }
  // Also include unassigned deliveries for this contractor
  const { data: unassignedLocs } = await supabase
    .from('deliveries')
    .select('locality')
    .eq('contractor_id', contractor.id)
    .not('locality', 'is', null)
  for (const row of unassignedLocs || []) {
    if (row.locality?.trim()) localitySet.add(row.locality.trim())
  }
  const allRegions = Array.from(localitySet).sort()

  // Fetch partner deliveries for this contractor (all active sheets)
  const { data: partnerSheets } = await supabase
    .from('partner_sheets')
    .select('id, name')
    .eq('contractor_id', contractor.id)
    .eq('is_active', true)

  let partnerDeliveries: any[] = []
  if (partnerSheets && partnerSheets.length > 0) {
    const sheetIds = partnerSheets.map(s => s.id)
    const { data: pd } = await supabase
      .from('partner_deliveries')
      .select('id, product, supplier, address, phone, amount, qty, driver, status, locality, rider_id, sheet_row_number')
      .in('sheet_id', sheetIds)
      .order('locality', { ascending: true })
      .order('sheet_row_number', { ascending: true })

    partnerDeliveries = pd || []
  }

  // Fetch partner-specific rider-region defaults with sort order
  const { data: partnerRegionDefaults } = await supabase
    .from('partner_rider_region_defaults')
    .select('rider_id, locality, sort_order')
    .eq('contractor_id', contractor.id)
    .order('sort_order', { ascending: true })

  // Build partner zones from actual partner deliveries
  const partnerRegionSet = new Set<string>()
  for (const pd of partnerDeliveries) {
    if (pd.locality?.trim()) partnerRegionSet.add(pd.locality.trim())
  }
  const partnerAllRegions = Array.from(partnerRegionSet).sort()

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor.name}
      photoUrl={contractor.photo_url}
      totalEarnings={0}
      riderCount={riders.length}
      isAlsoRider={!!contractorAsRider}
      hasPartners={contractor.has_partners ?? false}
    >
      <AssignContent
        deliveries={deliveries}
        riders={riders.map(r => ({ id: r.id, name: r.name }))}
        contractorId={contractor.id}
        riderIds={riderIds}
        availableDates={availableDates}
        selectedDate={selectedDate}
        regionDefaults={regionDefaults || []}
        allRegions={allRegions}
        partnerDeliveries={partnerDeliveries}
        partnerRegionDefaults={partnerRegionDefaults || []}
        partnerAllRegions={partnerAllRegions}
      />
    </ContractorMobileLayout>
  )
}
