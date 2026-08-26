import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DuplicateOrders } from '@/components/deliveries/duplicate-orders'

export default async function DuplicateOrdersPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // This list names which agent took each order, so it stays with admins and
  // managers - the same gate as the other cross-agent review screens.
  const { data: profile } = await adminDb.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  return <DuplicateOrders />
}
