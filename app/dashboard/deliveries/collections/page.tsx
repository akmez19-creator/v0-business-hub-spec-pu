import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CollectionsOverview } from '@/components/deliveries/collections-overview'

export default async function CollectionsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Default to today
  const today = new Date().toISOString().split('T')[0]

  // Fetch all riders for name mapping
  const { data: riders } = await supabase
    .from('riders')
    .select('id, name')

  const riderMap: Record<string, string> = {}
  for (const r of riders || []) riderMap[r.id] = r.name

  // Fetch today's deliveries
  const { data: deliveries } = await supabase
    .from('deliveries')
    .select('id, customer_name, locality, amount, status, payment_method, payment_juice, payment_cash, payment_bank, payment_status, delivery_date, rider_id')
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
    rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Collections</h1>
        <p className="text-muted-foreground">Track client payments - Juice, Cash, Internet Banking. Tap a delivery to update payment details.</p>
      </div>
      <CollectionsOverview deliveries={mapped} role="admin" />
    </div>
  )
}
