import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ClientsListView } from '@/components/marketing/clients-list-view'

export default async function FrontOfficeClientsPage() {
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
  
  // Fetch clients for front office
  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  return <ClientsListView clients={clients || []} />
}
