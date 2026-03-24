import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RiderMobileLayout } from '@/components/rider/mobile-layout'
import { CollectionsOverview } from '@/components/deliveries/collections-overview'

export default async function RiderCollectionsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/login')

  // Get rider record (same pattern as rider deliveries page)
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
      <RiderMobileLayout profile={profile}>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Rider profile not found</p>
        </div>
      </RiderMobileLayout>
    )
  }

  // Default to today
  const today = new Date().toISOString().split('T')[0]

  const { data: deliveries } = await supabase
    .from('deliveries')
    .select('id, customer_name, locality, amount, status, payment_method, payment_juice, payment_cash, payment_bank, payment_status, delivery_date, rider_id')
    .eq('rider_id', rider.id)
    .eq('delivery_date', today)
    .order('customer_name')

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
    rider_name: rider.name,
  }))

  return (
    <RiderMobileLayout profile={profile}>
      <CollectionsOverview deliveries={mapped} role="rider" />
    </RiderMobileLayout>
  )
}
