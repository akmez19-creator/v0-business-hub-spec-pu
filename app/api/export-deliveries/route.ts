import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminDb = createAdminClient()

  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') || 'all'

  let query = adminDb
    .from('deliveries')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('delivery_date', { ascending: false })

  // Apply scope-based date filters
  const today = new Date().toISOString().split('T')[0]

  if (scope === 'today') {
    query = query.eq('delivery_date', today)
  } else if (scope === 'this_week') {
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    query = query.gte('delivery_date', weekStart.toISOString().split('T')[0])
  } else if (scope === 'this_month') {
    const monthStart = new Date()
    monthStart.setDate(1)
    query = query.gte('delivery_date', monthStart.toISOString().split('T')[0])
  } else if (scope === 'current_filters') {
    // Apply same filters as the page
    const status = searchParams.get('status')
    const region = searchParams.get('region')
    const rider = searchParams.get('rider')
    const entryDate = searchParams.get('entry_date')
    const deliveryDate = searchParams.get('delivery_date')
    const search = searchParams.get('search')

    if (status && status !== 'all') query = query.eq('status', status)
    if (region && region !== 'all') {
      // Look up locality names belonging to this region group
      const { data: regionLocs } = await supabase
        .from('localities')
        .select('name')
        .eq('region', region)
        .eq('is_active', true)
      const localityNames = regionLocs?.map(l => l.name) || [region]
      query = query.in('locality', localityNames)
    }
    if (rider) {
      if (rider === 'unassigned') query = query.is('rider_id', null)
      else if (rider !== 'all') query = query.eq('rider_id', rider)
    }
    if (entryDate) query = query.eq('entry_date', entryDate)
    if (deliveryDate) query = query.eq('delivery_date', deliveryDate)
    if (search) {
      query = query.or(
        `customer_name.ilike.%${search}%,contact_1.ilike.%${search}%,locality.ilike.%${search}%,products.ilike.%${search}%,index_no.ilike.%${search}%`
      )
    }
  }

  // Fetch up to 50k rows (Supabase default limit is 1000, so paginate)
  const allDeliveries: Record<string, unknown>[] = []
  const BATCH_SIZE = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await query.range(offset, offset + BATCH_SIZE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    allDeliveries.push(...data)
    offset += BATCH_SIZE
    hasMore = data.length === BATCH_SIZE
    if (offset >= 50000) break // Safety cap
  }

  // Get riders and contractors for name resolution
  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name')

  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name')

  return NextResponse.json({
    deliveries: allDeliveries,
    riders: riders || [],
    contractors: contractors || [],
  })
}
