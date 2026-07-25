import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Update a rider's daily client target. Used by the Regions module (admin)
// and by TV mode's quick target controls. Admin/manager only - the target
// drives the riders panel progress so it must stay a deliberate decision.
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Not authorized' }, { status: 403 })
    }

    const body = await request.json()
    const riderName = String(body.riderName || '').trim()
    const target = Number(body.target)
    if (!riderName || !Number.isFinite(target) || target < 0 || target > 500) {
      return NextResponse.json({ success: false, error: 'Invalid rider or target' }, { status: 400 })
    }

    // Match by case-insensitive name (TV mode merges assignees by name)
    const { data: riders, error: findError } = await admin
      .from('riders')
      .select('id, name')
      .eq('is_active', true)
      .ilike('name', riderName)
    if (findError) throw findError
    if (!riders || riders.length === 0) {
      return NextResponse.json({ success: false, error: 'Rider not found' }, { status: 404 })
    }

    const { error: updateError } = await admin
      .from('riders')
      .update({ daily_target: Math.round(target) })
      .in('id', riders.map((r) => r.id))
    if (updateError) throw updateError

    return NextResponse.json({ success: true, target: Math.round(target) })
  } catch (error) {
    console.error('rider-targets error:', error)
    return NextResponse.json({ success: false, error: 'Failed to update target' }, { status: 500 })
  }
}
