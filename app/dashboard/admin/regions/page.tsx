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

  // Fetch localities with their assigned contractor + default rider,
  // plus the contractor/rider lists for the assignment editors
  const [{ data: localities }, { data: contractors }, { data: riders }] = await Promise.all([
    adminDb
      .from('localities')
      .select('*, contractor:contractors(id, name), rider:riders(id, name, contractor_id)')
      .eq('is_active', true)
      .order('route_code', { ascending: true })
      .order('name', { ascending: true }),
    adminDb
      .from('contractors')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
    adminDb
      .from('riders')
      .select('id, name, contractor_id, daily_target')
      .eq('is_active', true)
      .order('name'),
  ])

  const mapped = (localities || []).map((l: any) => ({
    id: l.id,
    name: l.name,
    region: l.route_code || 'UNASSIGNED',
    district: l.district || '',
    route_code: l.route_code || '',
    is_active: l.is_active,
    contractor_id: l.contractor_id || null,
    contractor_name: l.contractor?.name || null,
    default_rider_id: l.default_rider_id || null,
    rider_name: l.rider?.name || null,
  }))

  return (
    <AdminRegionsContent
      localities={mapped}
      contractors={contractors || []}
      riders={riders || []}
      canEdit={['admin', 'manager'].includes(currentProfile.role)}
    />
  )
}
