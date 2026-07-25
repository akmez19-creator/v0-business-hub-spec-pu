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

    // Today's date in Mauritius (UTC+4) for the per-rider client counts
    const todayMu = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [{ data: localities }, { data: todayDeliveries }] = await Promise.all([
      admin
        .from('localities')
        .select('name, contractor:contractors(name), rider:riders(name)')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      // Today's deliveries grouped client-side by rider (fallback contractor)
      admin
        .from('deliveries')
        .select('customer_name, contact_1, rider:riders(name), contractor:contractors(name)')
        .eq('delivery_date', todayMu),
    ])

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

    // Today's DISTINCT clients per rider (same key scheme: rider name first,
    // contractor fallback). A client = unique customer (phone, else name).
    const clientsByAssignee = new Map<string, Set<string>>()
    const allClients = new Set<string>()
    for (const d of (todayDeliveries || []) as any[]) {
      const riderName: string | null = d.rider?.name || null
      const contractorName: string | null = d.contractor?.name || null
      const key = riderName ? `r:${riderName}` : contractorName ? `c:${contractorName}` : null
      const clientKey = (d.contact_1 || d.customer_name || '').trim().toLowerCase()
      if (!clientKey) continue
      allClients.add(clientKey)
      if (!key) continue
      const set = clientsByAssignee.get(key) || new Set<string>()
      set.add(clientKey)
      clientsByAssignee.set(key, set)
    }

    // Most clients today first - the busiest riders lead the panel
    const riders = Array.from(byAssignee.entries())
      .map(([key, v]) => ({
        id: key,
        name: v.name,
        isContractor: v.isContractor,
        regions: v.regions,
        todayClients: clientsByAssignee.get(key)?.size || 0,
      }))
      .sort((a, b) => b.todayClients - a.todayClients || b.regions.length - a.regions.length || a.name.localeCompare(b.name))

    return NextResponse.json({ success: true, riders, todayTotal: allClients.size })
  } catch (error) {
    console.error('riders-regions error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load riders' }, { status: 500 })
  }
}
