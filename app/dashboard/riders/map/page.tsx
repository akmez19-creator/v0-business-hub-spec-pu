import { redirect } from 'next/navigation'
import { muToday } from '@/lib/business-date'
import { createClient } from '@/lib/supabase/server'
import { RiderMobileLayout } from '@/components/rider/mobile-layout'
import { MapPageContent } from '@/app/dashboard/contractors/map/map-content'

export default async function RiderMapPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
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
  } else if (profile?.rider_id) {
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

  // Calculate XP and level for layout
  const { count: totalDelivered } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')

  const deliveryCount = totalDelivered || 0
  const level = Math.floor(deliveryCount / 50) + 1
  const xpInCurrentLevel = deliveryCount % 50

  // Get today's date
  const today = muToday()

  // Fetch rider's deliveries for today
  let deliveries: any[] = []
  const { data: todayData } = await supabase
    .from('deliveries')
    .select('id, customer_name, contact_1, locality, products, qty, amount, status, rider_id, latitude, longitude, delivery_notes, client_response, delivery_date, active_date, rescheduled_to, location_flagged, client_lat, client_lng, location_source, sales_type, return_product, is_modified, modification_count, delivered_at')
    .eq('rider_id', rider.id)
    // The day it is TO BE delivered - see riders/stock/page.tsx. Filtering the
    // immutable `delivery_date` kept a rescheduled stop off the rider's map on
    // the very day he had to drive to it.
    .eq('active_date', today)
    .order('delivery_sequence', { ascending: true })

  if (todayData && todayData.length > 0) {
    deliveries = todayData
  } else {
    // Fall back to latest date with deliveries
    const { data: latestData } = await supabase
      .from('deliveries')
      .select('id, customer_name, contact_1, locality, products, qty, amount, status, rider_id, latitude, longitude, delivery_notes, client_response, delivery_date, active_date, rescheduled_to, location_flagged, client_lat, client_lng, location_source, sales_type, return_product, is_modified, modification_count, delivered_at')
      .eq('rider_id', rider.id)
      // Ordered and grouped by `active_date` to match the primary query above.
      // Mixing the two would pick a "latest day" by one date and then filter by
      // the other, which can return an empty map on a day that has work.
      .order('active_date', { ascending: false })
      .limit(100)

    const latestDate = latestData?.[0]?.active_date
    if (latestDate) {
      deliveries = latestData!.filter(d => d.active_date === latestDate)
    }
  }

  const riderMap = { [rider.id]: rider.name }

  return (
    <RiderMobileLayout
      profile={profile}
      level={level}
      xp={xpInCurrentLevel}
      xpToNextLevel={50}
    >
      <MapPageContent
        deliveries={deliveries}
        riderMap={riderMap}
        deliveryDate={deliveries[0]?.delivery_date || today}
        apiKey={process.env.MAPBOX_TOKEN || ''}
        userName={profile.name || rider.name || 'Rider'}
        userPhoto={rider.photo_url || null}
        riderJuicePolicies={{ [rider.id]: rider.juice_policy || 'rider' }}
      />
    </RiderMobileLayout>
  )
}
