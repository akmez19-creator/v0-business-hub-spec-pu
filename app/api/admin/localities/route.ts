import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// PATCH: update the assigned contractor / default rider for a locality,
// or bulk-assign a whole region (route_code) in one call. Admin/manager only.
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminDb = createAdminClient()
    const { data: profile } = await adminDb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const contractorId = body.contractorId || null
    const riderId = body.riderId || null

    // Rider must belong to the chosen contractor (or be cleared)
    if (contractorId && riderId) {
      const { data: rider } = await adminDb
        .from('riders')
        .select('id, contractor_id')
        .eq('id', riderId)
        .single()
      if (!rider || rider.contractor_id !== contractorId) {
        return NextResponse.json({ error: 'Rider does not belong to this contractor' }, { status: 400 })
      }
    }

    const update = {
      contractor_id: contractorId,
      default_rider_id: contractorId ? riderId : null,
    }

    if (body.localityId) {
      const { error } = await adminDb
        .from('localities')
        .update(update)
        .eq('id', body.localityId)
      if (error) throw error
      return NextResponse.json({ success: true, updated: 1 })
    }

    if (body.routeCode) {
      const { data, error } = await adminDb
        .from('localities')
        .update(update)
        .eq('route_code', body.routeCode)
        .select('id')
      if (error) throw error
      return NextResponse.json({ success: true, updated: data?.length || 0 })
    }

    return NextResponse.json({ error: 'localityId or routeCode required' }, { status: 400 })
  } catch (err) {
    console.error('[localities PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
  }
}
