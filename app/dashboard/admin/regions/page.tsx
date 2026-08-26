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
  // Open orders and how many carry no rider. The "Assigned" card counted
  // localities-with-a-contractor and so read 493/493 - "all covered" - while
  // 134 of 166 open orders actually have nobody to deliver them. Coverage of
  // the permanent map is not coverage of the work.
  const [{ data: localities }, { data: contractors }, { data: riders }, openOrders] = await Promise.all([
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
    adminDb
      .from('deliveries')
      .select('rider_id, locality')
      .in('status', ['pending', 'assigned']),
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

  // A failed read must not render as a comfortable zero: if this query broke,
  // `?? []` would report "0 orders with no rider" - the most reassuring
  // possible lie. Pass null and let the card say it could not check.
  const orderRows = openOrders.error ? null : (openOrders.data ?? [])

  // An order with a null rider_id is NOT necessarily uncovered: its locality's
  // contractor may have exactly one active rider, which already determines who
  // delivers it. Only a contractor with several riders is a real unknown. The
  // previous version counted every null and reported 134 "with no rider" when
  // 118 of those were already determined.
  const crewSize = new Map<string, number>()
  for (const r of riders || []) {
    if (!r.contractor_id) continue
    crewSize.set(r.contractor_id, (crewSize.get(r.contractor_id) ?? 0) + 1)
  }
  const localityByName = new Map(
    (localities || []).map((l: any) => [String(l.name).trim().toLowerCase(), l]),
  )
  const isUndetermined = (loc: string | null) => {
    if (!loc) return true
    const l = localityByName.get(String(loc).trim().toLowerCase())
    if (!l) return true
    if (l.default_rider_id) return false
    return (crewSize.get(l.contractor_id) ?? 0) !== 1
  }

  const orderCoverage = orderRows && {
    open: orderRows.length,
    noRider: orderRows.filter((d: any) => !d.rider_id && isUndetermined(d.locality)).length,
    localitiesAffected: new Set(
      orderRows
        .filter((d: any) => !d.rider_id && d.locality && isUndetermined(d.locality))
        .map((d: any) => String(d.locality).trim().toLowerCase()),
    ).size,
  }

  return (
    <AdminRegionsContent
      localities={mapped}
      contractors={contractors || []}
      riders={riders || []}
      canEdit={['admin', 'manager'].includes(currentProfile.role)}
      orderCoverage={orderCoverage}
    />
  )
}
