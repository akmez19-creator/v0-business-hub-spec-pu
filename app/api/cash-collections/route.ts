import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Cash collections API for contractor cash counting sync with store
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const contractorId = searchParams.get('contractorId')

  if (!contractorId) {
    return NextResponse.json({ error: 'Missing contractorId' }, { status: 400 })
  }

  const adminDb = createAdminClient()

  // Get riders for this contractor
  const { data: riders } = await adminDb
    .from('riders')
    .select('id')
    .eq('contractor_id', contractorId)

  const riderIds = (riders || []).map(r => r.id)

  if (riderIds.length === 0) {
    return NextResponse.json({ collected: [], pending: [] })
  }

  // Get start of current month for filtering
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // Get deliveries with cash payment (cash_collected = true means store collected it)
  const { data: allDeliveries, error } = await adminDb
    .from('deliveries')
    .select(`
      id,
      index_no,
      customer_name,
      payment_cash,
      cash_collected,
      cash_collected_at,
      cash_collected_by,
      delivery_date,
      rider_id,
      contractor_cash_denoms,
      contractor_cash_counted,
      contractor_cash_counted_at,
      riders!inner(name)
    `)
    .in('rider_id', riderIds)
    .gt('payment_cash', '0')
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('delivery_date', { ascending: false })

  if (error) {
    console.error('Error fetching cash collections:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Transform data to include rider_name
  const deliveries = (allDeliveries || []).map(d => ({
    ...d,
    rider_name: (d.riders as any)?.name || 'Unknown'
  }))

  // Split into collected and pending
  const collected = deliveries.filter(d => d.cash_collected === true)
  const pending = deliveries.filter(d => d.cash_collected !== true)

  return NextResponse.json({ collected, pending })
}
