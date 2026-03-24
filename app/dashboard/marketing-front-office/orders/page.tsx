import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CreateOrderForm } from '@/components/marketing/create-order-form'

export default async function FrontOfficeOrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'marketing_front_office' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get products for selection
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true })

  // Get recent clients
  const { data: recentClients } = await supabase
    .from('clients')
    .select('id, name, phone, address, city')
    .order('updated_at', { ascending: false })
    .limit(50)

  // Get localities for region selection
  const { data: localities } = await supabase
    .from('localities')
    .select('name')
    .eq('is_active', true)
    .order('name', { ascending: true })
  
  const regions = (localities || []).map(l => l.name)

  return (
    <CreateOrderForm
      userId={user.id}
      products={products || []}
      recentClients={recentClients || []}
      regions={regions}
    />
  )
}
