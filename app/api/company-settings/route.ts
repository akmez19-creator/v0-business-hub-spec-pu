import { coerceLayout } from '@/lib/reels-layout'
import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const adminDb = createAdminClient()

  const { data, error } = await adminDb
    .from('company_settings')
    .select('orders_module_enabled, reels_logo_url, reels_banner_layout')
    .limit(1)
    .single()

  if (error) {
    return NextResponse.json({
      orders_module_enabled: true,
      reels_logo_url: '',
      reels_banner_layout: null,
    })
  }

  return NextResponse.json(data)
}

// Persist Reels Studio defaults so they survive refreshes and are used for
// every new reel. Body may carry either or both of:
//   { reels_logo_url: string }
//   { reels_banner_layout: { preset, locked, title, price, logo } | null }
// Fields are applied independently, so saving a banner spot never disturbs the
// saved logo (and vice versa).
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const patch: Record<string, unknown> = {}

    if ('reels_logo_url' in body) {
      if (typeof body.reels_logo_url !== 'string') {
        return NextResponse.json({ error: 'reels_logo_url must be a string' }, { status: 400 })
      }
      patch.reels_logo_url = body.reels_logo_url
    }

    if ('reels_banner_layout' in body) {
      // null is a legitimate value here - it clears the saved default
      if (body.reels_banner_layout === null) {
        patch.reels_banner_layout = null
      } else {
        const layout = coerceLayout(body.reels_banner_layout)
        if (!layout) {
          return NextResponse.json({ error: 'reels_banner_layout is malformed' }, { status: 400 })
        }
        patch.reels_banner_layout = layout
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    const { data: row } = await adminDb
      .from('company_settings')
      .select('id')
      .limit(1)
      .single()

    if (!row) {
      return NextResponse.json({ error: 'No settings row found' }, { status: 404 })
    }

    const { error } = await adminDb
      .from('company_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', row.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, ...patch })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
