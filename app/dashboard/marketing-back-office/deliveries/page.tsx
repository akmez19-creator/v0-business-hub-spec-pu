import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DeliveriesListView } from '@/components/marketing/deliveries-list-view'

export default async function MarketingDeliveriesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'marketing_back_office' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get recent deliveries
  const { data: deliveries } = await supabase
    .from('deliveries')
    .select('id, index_no, customer_name, contact_1, locality, products, amount, status, delivery_date, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <DeliveriesListView deliveries={deliveries || []} />
  )
}
