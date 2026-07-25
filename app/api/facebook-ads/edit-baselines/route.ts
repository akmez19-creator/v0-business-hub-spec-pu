import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Cost/client baselines for products whose ads were edited today.
// POST records the FIRST-seen cost/client of the day per edited product
// (subsequent posts are ignored), GET returns today's baselines so the UI
// can show whether the edit IMPROVED the cost (baseline vs live CAC).

function todayMauritius(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const { data, error } = await admin()
      .from('ad_edit_baselines')
      .select('product_key, baseline_cac, baseline_spend_rs, baseline_clients, created_at')
      .eq('baseline_date', todayMauritius())
    if (error) throw error

    // product_key -> baseline (createdAt = when the edit was first detected,
    // used for "no improvement after 2-3 hours" escalation)
    const baselines: Record<string, { cac: number | null; spendRs: number; clients: number; createdAt: string }> = {}
    for (const row of data || []) {
      baselines[row.product_key] = {
        cac: row.baseline_cac === null ? null : Number(row.baseline_cac),
        spendRs: Number(row.baseline_spend_rs) || 0,
        clients: row.baseline_clients || 0,
        createdAt: row.created_at,
      }
    }
    return NextResponse.json({ success: true, baselines })
  } catch (error) {
    console.error('[edit-baselines] GET error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load baselines' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const entries: { productKey: string; cac: number | null; spendRs: number; clients: number }[] =
      Array.isArray(body?.entries) ? body.entries : []
    if (entries.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 })
    }

    const date = todayMauritius()
    const rows = entries
      .filter(e => typeof e.productKey === 'string' && e.productKey.length > 0)
      .map(e => ({
        product_key: e.productKey,
        baseline_date: date,
        baseline_cac: typeof e.cac === 'number' && isFinite(e.cac) ? e.cac : null,
        baseline_spend_rs: typeof e.spendRs === 'number' && isFinite(e.spendRs) ? e.spendRs : 0,
        baseline_clients: typeof e.clients === 'number' && isFinite(e.clients) ? e.clients : 0,
      }))

    // First edit of the day wins: existing rows are left untouched so the
    // baseline stays the PRE-edit cost, not a moving target
    const { error } = await admin()
      .from('ad_edit_baselines')
      .upsert(rows, { onConflict: 'product_key,baseline_date', ignoreDuplicates: true })
    if (error) throw error

    return NextResponse.json({ success: true, inserted: rows.length })
  } catch (error) {
    console.error('[edit-baselines] POST error:', error)
    return NextResponse.json({ success: false, error: 'Failed to save baselines' }, { status: 500 })
  }
}
