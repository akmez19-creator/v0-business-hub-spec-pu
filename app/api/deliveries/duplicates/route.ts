import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type DuplicateGroup = {
  phone: string
  clientName: string | null
  products: string | null
  deliveryDate: string | null
  orderCount: number
  redundantValue: number
  agents: string[]
  agentCount: number
  /** same_day = duplicate in the ordinary sense; distant = likely repeat business. */
  confidence: 'same_day' | 'near' | 'distant'
  hoursApart: number | null
  orderIds: string[]
}

// Read-only. This endpoint reports; it never merges or deletes an order.
// A "duplicate" here is a judgement about intent, and the same shape covers
// both a double-entry 55 minutes apart and a genuine re-order three weeks
// later - only a person can tell those apart, so the decision stays with them.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service role: the grouping reads every open delivery, across all agents.
  const adminDb = createAdminClient()
  const { data, error } = await adminDb.rpc('get_duplicate_open_orders')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const groups: DuplicateGroup[] = (data || []).map((r: {
    phone: string
    client_name: string | null
    products: string | null
    delivery_date: string | null
    order_count: number
    redundant_value: number | null
    agents: string[] | null
    agent_count: number
    confidence: string
    hours_apart: number | null
    order_ids: string[]
  }) => ({
    phone: r.phone,
    clientName: r.client_name,
    products: r.products,
    deliveryDate: r.delivery_date,
    orderCount: Number(r.order_count),
    redundantValue: Number(r.redundant_value || 0),
    agents: r.agents || [],
    agentCount: Number(r.agent_count),
    confidence: r.confidence as DuplicateGroup['confidence'],
    hoursApart: r.hours_apart === null ? null : Number(r.hours_apart),
    orderIds: r.order_ids || [],
  }))

  return NextResponse.json({ groups })
}
