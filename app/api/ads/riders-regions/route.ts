import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Riders + the regions already allocated to them (rider_region_defaults),
// used by the Ads Manager TV mode display. Signed-in users only; read is done
// with the service-role client since marketing viewers have no RLS grant on
// riders/rider_region_defaults.
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

    const [{ data: riders }, { data: defaults }] = await Promise.all([
      admin.from('riders').select('id, name').eq('is_active', true).order('name'),
      admin.from('rider_region_defaults').select('rider_id, locality, sort_order').order('sort_order', { ascending: true }),
    ])

    const regionsByRider = new Map<string, string[]>()
    for (const d of defaults || []) {
      if (!d.rider_id || !d.locality) continue
      const list = regionsByRider.get(d.rider_id) || []
      if (!list.includes(d.locality)) list.push(d.locality)
      regionsByRider.set(d.rider_id, list)
    }

    const result = (riders || []).map(r => ({
      id: r.id,
      name: r.name || 'Unnamed rider',
      regions: regionsByRider.get(r.id) || [],
    }))

    return NextResponse.json({ success: true, riders: result })
  } catch (error) {
    console.error('riders-regions error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load riders' }, { status: 500 })
  }
}
