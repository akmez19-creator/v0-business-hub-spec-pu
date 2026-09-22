import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ClientsPage } from '@/components/clients/clients-page'

/**
 * The bulk client database (ratings, lifetime sales, import) is for admin and
 * manager. A marketing agent works one customer at a time from the order
 * search on their home page, so the role is checked here on the server before
 * the client component ever loads.
 */
const ALLOWED = ['admin', 'manager']

export default async function ClientsRoute() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !ALLOWED.includes(profile.role)) redirect('/dashboard')

  return <ClientsPage />
}
