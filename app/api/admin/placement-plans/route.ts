import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Rider placement plans: named snapshots of the full locality->rider map.
// GET    - list saved plans
// POST   - save the CURRENT assignments as a new plan (body: { name })
// PUT    - apply a saved plan back onto localities (body: { planId })
// DELETE - remove a plan (body: { planId })

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const adminDb = createAdminClient()
  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { adminDb, userId: user.id }
}

export async function GET() {
  const auth = await requireManager()
  if ('error' in auth) return auth.error
  try {
    const { data, error } = await auth.adminDb
      .from('rider_placement_plans')
      .select('id, name, assignments, created_at, last_applied_at')
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) throw error
    // Send a light list: assignment count instead of the full snapshot
    const plans = (data || []).map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      lastAppliedAt: p.last_applied_at,
      assignmentCount: Array.isArray(p.assignments) ? p.assignments.length : 0,
    }))
    return NextResponse.json({ plans })
  } catch (err) {
    console.error('[placement-plans GET] error:', err)
    return NextResponse.json({ error: 'Failed to load plans' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireManager()
  if ('error' in auth) return auth.error
  try {
    const { name } = await request.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Plan name required' }, { status: 400 })
    }
    // Snapshot every locality that currently has an assignment
    const { data: locs, error: locErr } = await auth.adminDb
      .from('localities')
      .select('id, contractor_id, default_rider_id')
      .not('contractor_id', 'is', null)
    if (locErr) throw locErr
    const assignments = (locs || []).map((l) => ({
      locality_id: l.id,
      contractor_id: l.contractor_id,
      rider_id: l.default_rider_id,
    }))
    if (assignments.length === 0) {
      return NextResponse.json({ error: 'No assignments to save' }, { status: 400 })
    }
    const { data, error } = await auth.adminDb
      .from('rider_placement_plans')
      .insert({ name: name.trim().slice(0, 80), assignments, created_by: auth.userId })
      .select('id')
      .single()
    if (error) throw error
    return NextResponse.json({ success: true, planId: data.id, saved: assignments.length })
  } catch (err) {
    console.error('[placement-plans POST] error:', err)
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireManager()
  if ('error' in auth) return auth.error
  try {
    const { planId } = await request.json()
    if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })
    const { data: plan, error: planErr } = await auth.adminDb
      .from('rider_placement_plans')
      .select('id, assignments')
      .eq('id', planId)
      .single()
    if (planErr || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const assignments: { locality_id: string; contractor_id: string | null; rider_id: string | null }[] =
      Array.isArray(plan.assignments) ? plan.assignments : []

    // Clear all current assignments first so the plan is applied exactly
    // (localities not in the plan become unassigned, matching the snapshot).
    const { error: clearErr } = await auth.adminDb
      .from('localities')
      .update({ contractor_id: null, default_rider_id: null })
      .not('contractor_id', 'is', null)
    if (clearErr) throw clearErr

    // Group by contractor/rider pair so we do a handful of bulk updates
    const byPair = new Map<string, { contractor_id: string | null; rider_id: string | null; ids: string[] }>()
    for (const a of assignments) {
      const key = `${a.contractor_id}|${a.rider_id}`
      if (!byPair.has(key)) byPair.set(key, { contractor_id: a.contractor_id, rider_id: a.rider_id, ids: [] })
      byPair.get(key)!.ids.push(a.locality_id)
    }
    let applied = 0
    for (const { contractor_id, rider_id, ids } of byPair.values()) {
      const { data, error } = await auth.adminDb
        .from('localities')
        .update({ contractor_id, default_rider_id: rider_id })
        .in('id', ids)
        .select('id')
      if (error) throw error
      applied += data?.length || 0
    }
    await auth.adminDb
      .from('rider_placement_plans')
      .update({ last_applied_at: new Date().toISOString() })
      .eq('id', planId)
    return NextResponse.json({ success: true, applied })
  } catch (err) {
    console.error('[placement-plans PUT] error:', err)
    return NextResponse.json({ error: 'Failed to apply plan' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireManager()
  if ('error' in auth) return auth.error
  try {
    const { planId } = await request.json()
    if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })
    const { error } = await auth.adminDb.from('rider_placement_plans').delete().eq('id', planId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[placement-plans DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete plan' }, { status: 500 })
  }
}
