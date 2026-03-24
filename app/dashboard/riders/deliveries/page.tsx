import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RiderMobileLayout } from '@/components/rider/mobile-layout'
import { OrdersContent } from '@/components/orders/orders-content'

export default async function RiderOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; status?: string }>
}) {
  const params = await searchParams
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

  // Calculate XP and level
  const { count: totalDelivered } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('rider_id', rider.id)
    .eq('status', 'delivered')

  const deliveryCount = totalDelivered || 0
  const level = Math.floor(deliveryCount / 50) + 1
  const xpInCurrentLevel = deliveryCount % 50

  // Get available dates (last 60 days)
  const sixtyDaysAgo = new Date()
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

  const { data: dateRows } = await supabase
    .from('deliveries')
    .select('delivery_date')
    .eq('rider_id', rider.id)
    .gte('delivery_date', sixtyDaysAgo.toISOString().split('T')[0])
    .order('delivery_date', { ascending: false })

  const dateSet = new Set<string>()
  for (const row of dateRows || []) {
    if (row.delivery_date) dateSet.add(row.delivery_date)
  }
  const availableDates = Array.from(dateSet).sort().reverse()

  // Selected date
  const selectedDate = params.date && availableDates.includes(params.date)
    ? params.date
    : availableDates[0] || new Date().toISOString().split('T')[0]

  // Fetch all deliveries for the selected date
  const { data } = await supabase
    .from('deliveries')
    .select('id, customer_name, contact_1, contact_2, locality, status, delivery_date, rider_id, index_no, qty, products, amount, payment_method, payment_juice, payment_cash, payment_bank, payment_status, notes, delivery_notes, client_response, created_at, latitude, longitude, delivery_sequence, sales_type, return_product')
    .eq('rider_id', rider.id)
    .eq('delivery_date', selectedDate)
    .order('locality', { ascending: true })
    .order('created_at', { ascending: true })

  const deliveries = data || []

  // Group by unique client to get correct counts
  const clientMap = new Map<string, { status: string }>()
  for (const d of deliveries) {
    const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id || ''}`
    if (!clientMap.has(key)) {
      clientMap.set(key, { status: d.status })
    }
  }
  const statusCounts: Record<string, number> = {}
  for (const [, v] of clientMap) {
    statusCounts[v.status] = (statusCounts[v.status] || 0) + 1
  }
  const uniqueClientCount = clientMap.size

  return (
    <RiderMobileLayout
      profile={profile}
      level={level}
      xp={xpInCurrentLevel}
      xpToNextLevel={50}
    >
      <div className="px-4 py-4">
        <OrdersContent
          deliveries={deliveries}
          availableDates={availableDates}
          selectedDate={selectedDate}
          riders={[{ id: rider.id, name: rider.name }]}
          statusCounts={statusCounts}
          totalCount={uniqueClientCount}
          customTemplates={profile?.message_templates || null}
          riderJuicePolicies={{ [rider.id]: rider.juice_policy || 'rider' }}
        />
      </div>
    </RiderMobileLayout>
  )
}
