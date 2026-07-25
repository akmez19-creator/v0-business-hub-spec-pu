import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Riders + the regions already allocated to them, used by the Ads Manager TV
// mode display. The source of truth for region allocation is the `localities`
// table (region -> contractor + default rider) - the same mapping the
// extension uses for "Delivered by" - NOT rider_region_defaults, which is
// only a per-delivery-day route ordering helper.
// Signed-in users only; read uses the service-role client since marketing
// viewers have no RLS grant on localities/contractors/riders.
export async function GET() {
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

    const { data: localities } = await admin
      .from('localities')
      .select('name, contractor:contractors(name), rider:riders(name)')
      .eq('is_active', true)
      .order('name', { ascending: true })

    // Group allocated regions by rider; fall back to the contractor name when
    // a region has a contractor but no default rider yet. Regions with neither
    // are unallocated and excluded (this panel shows allocations only).
    const byAssignee = new Map<string, { name: string; isContractor: boolean; regions: string[] }>()
    for (const l of (localities || []) as any[]) {
      const riderName: string | null = l.rider?.name || null
      const contractorName: string | null = l.contractor?.name || null
      const key = riderName ? `r:${riderName}` : contractorName ? `c:${contractorName}` : null
      if (!key || !l.name) continue
      const entry = byAssignee.get(key) || { name: riderName || contractorName!, isContractor: !riderName, regions: [] }
      if (!entry.regions.includes(l.name)) entry.regions.push(l.name)
      byAssignee.set(key, entry)
    }

    // Most regions first so the busiest assignees lead the table
    const riders = Array.from(byAssignee.entries())
      .map(([key, v]) => ({ id: key, name: v.name, isContractor: v.isContractor, regions: v.regions }))
      .sort((a, b) => b.regions.length - a.regions.length || a.name.localeCompare(b.name))

    return NextResponse.json({ success: true, riders })
  } catch (error) {
    console.error('riders-regions error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load riders' }, { status: 500 })
  }
}
