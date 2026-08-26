import { redirect } from 'next/navigation'
import { muToday } from '@/lib/business-date'
import { createClient } from '@/lib/supabase/server'
import { MapPageContent } from './map-content'

export default async function ContractorMapPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

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

  if (!contractor) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <p className="text-white/50">Contractor profile not found</p>
      </div>
    )
  }

  // Get riders under this contractor
  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, juice_policy')
    .eq('contractor_id', contractor.id)
    .order('name')

  const riders = allRiders || []
  const riderIds = riders.map(r => r.id)
  const riderMap = Object.fromEntries(riders.map(r => [r.id, r.name]))
  const riderJuicePolicies: Record<string, string> = Object.fromEntries(riders.map(r => [r.id, (r as any).juice_policy || 'rider']))

  // Find the rider that matches the contractor (contractor is also a rider)
  const contractorAsRider = riders.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  )

  // Get today's date
  const today = muToday()

  // Fetch deliveries for today (or latest available date)
  let deliveries: any[] = []
  if (riderIds.length > 0) {
    // Try today first
    const { data: todayData } = await supabase
      .from('deliveries')
      .select('id, customer_name, contact_1, contact_2, locality, products, qty, amount, status, rider_id, latitude, longitude, delivery_notes, client_response, delivery_date, active_date, rescheduled_to, location_flagged, client_lat, client_lng, location_source, sales_type, return_product, is_modified, modification_count, delivered_at, pending_modification_id, rider_priority, rider_remarks')
      .in('rider_id', riderIds)
      // Due-day basis - a rescheduled stop must appear on the map for the day
      // it is actually being driven.
      .eq('active_date', today)
      .order('delivery_sequence', { ascending: true })

    if (todayData && todayData.length > 0) {
      deliveries = todayData
    } else {
      // Fall back to latest date with deliveries
      const { data: latestData } = await supabase
        .from('deliveries')
      .select('id, customer_name, contact_1, contact_2, locality, products, qty, amount, status, rider_id, latitude, longitude, delivery_notes, client_response, delivery_date, active_date, rescheduled_to, location_flagged, client_lat, client_lng, location_source, sales_type, return_product, is_modified, modification_count, delivered_at, pending_modification_id, rider_priority, rider_remarks')
      .in('rider_id', riderIds)
      // Ordered and grouped on the same column as the primary query, or the
      // "latest day" could be chosen by one date and filtered by the other.
      .order('active_date', { ascending: false })
        .limit(200)

      const latestDate = latestData?.[0]?.active_date
      if (latestDate) {
        deliveries = latestData!.filter(d => d.active_date === latestDate)
      }
    }
  }

  // Also fetch unassigned deliveries for this contractor
  const { data: unassignedData } = await supabase
    .from('deliveries')
    .select('id, customer_name, contact_1, contact_2, locality, products, qty, amount, status, rider_id, latitude, longitude, delivery_notes, client_response, delivery_date, active_date, rescheduled_to, location_flagged, client_lat, client_lng, location_source, sales_type, return_product, is_modified, modification_count, delivered_at, pending_modification_id, rider_priority, rider_remarks')
    .eq('contractor_id', contractor.id)
    .is('rider_id', null)
    .eq('active_date', deliveries[0]?.active_date || today)

  if (unassignedData) {
    const existingIds = new Set(deliveries.map(d => d.id))
    for (const d of unassignedData) {
      if (!existingIds.has(d.id)) deliveries.push(d)
    }
  }

  // Fetch warehouse from company_settings
  const { data: companySettings, error: csError } = await supabase
    .from('company_settings')
    .select('warehouse_name, warehouse_lat, warehouse_lng')
    .limit(1)
    .single()

  return (
    <MapPageContent
      deliveries={deliveries}
      riderMap={riderMap}
      deliveryDate={deliveries[0]?.delivery_date || today}
      apiKey={process.env.MAPBOX_TOKEN || ''}
      userName={contractor.name || profile.name || contractor.company_name || 'Driver'}
      userPhoto={contractor.photo_url || profile.avatar_url || null}
      warehouseLat={companySettings?.warehouse_lat || null}
      warehouseLng={companySettings?.warehouse_lng || null}
      warehouseName={companySettings?.warehouse_name || 'Warehouse'}
      customTemplates={profile.message_templates || null}
      defaultRiderId={contractorAsRider?.id || null}
      riderJuicePolicies={riderJuicePolicies}
      deviceType={contractor.device_type || 'apple'}
    />
  )
}
