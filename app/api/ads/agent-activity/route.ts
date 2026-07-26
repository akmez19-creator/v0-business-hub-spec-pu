import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Live entry-logging pulse for the TV wall's cat comms box: which agents are
// logging deliveries RIGHT NOW (last 10 minutes), on which products, and how
// many entries each has done. Auth-gated like the rest of the wall APIs.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const adminDb = createAdminClient()
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    // Entries created in the last 10 minutes with their creator
    const { data: rows, error } = await adminDb
      .from('deliveries')
      .select('created_by, created_at, products')
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error

    // Resolve agent names in one shot
    const ids = [...new Set((rows ?? []).map((r) => r.created_by).filter(Boolean))] as string[]
    const names: Record<string, string> = {}
    if (ids.length > 0) {
      const { data: profs } = await adminDb.from('profiles').select('id, name').in('id', ids)
      for (const p of profs ?? []) names[p.id] = p.name || 'Unknown'
    }

    // Group per agent: count + distinct recent products + latest entry time
    type AgentActivity = { agent: string; entries: number; products: string[]; lastEntryAt: string }
    const byAgent = new Map<string, AgentActivity>()
    for (const r of rows ?? []) {
      const agent = (r.created_by && names[r.created_by]) || 'Unknown'
      const cur: AgentActivity =
        byAgent.get(agent) ?? { agent, entries: 0, products: [], lastEntryAt: r.created_at }
      cur.entries += 1
      const prod = (r.products || '').trim()
      if (prod && !cur.products.includes(prod) && cur.products.length < 4) cur.products.push(prod)
      if (r.created_at > cur.lastEntryAt) cur.lastEntryAt = r.created_at
      byAgent.set(agent, cur)
    }

    const agents = [...byAgent.values()].sort((a, b) => b.entries - a.entries)
    return NextResponse.json({
      success: true,
      windowMinutes: 10,
      totalEntries: (rows ?? []).length,
      agents,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load agent activity' },
      { status: 500 },
    )
  }
}
