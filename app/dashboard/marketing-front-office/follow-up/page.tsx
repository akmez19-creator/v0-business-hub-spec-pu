import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FollowUpView } from '@/components/marketing/follow-up-view'

export default async function FrontOfficeFollowUpPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/login')
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
    
  if (profile?.role !== 'marketing_front_office') {
    redirect('/dashboard')
  }
  
  // Fetch pending deliveries for follow-up
  const { data: deliveries } = await supabase
    .from('deliveries')
    .select('*, clients(name, phone, address)')
    .in('status', ['pending', 'assigned', 'in_transit'])
    .order('created_at', { ascending: false })
    .limit(50)

  return <FollowUpView deliveries={deliveries || []} />
}
