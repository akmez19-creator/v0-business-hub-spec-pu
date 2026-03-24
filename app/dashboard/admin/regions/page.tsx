import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { AdminRegionsContent } from '@/components/admin/regions-content'

export default async function AdminRegionsPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: currentProfile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!currentProfile || !['admin', 'manager'].includes(currentProfile.role)) {
    redirect('/dashboard')
  }

  // Fetch localities (the full route table)
  const { data: localities } = await adminDb
    .from('localities')
    .select('*')
    .eq('is_active', true)
    .order('region', { ascending: true })
    .order('route_code', { ascending: true })

  return (
    <AdminRegionsContent
      localities={localities || []}
    />
  )
}
