import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ClientsListView } from '@/components/marketing/clients-list-view'

export default async function MarketingClientsPage() {
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

  // Get all clients
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true })
    .limit(500)

  return (
    <ClientsListView clients={clients || []} />
  )
}
