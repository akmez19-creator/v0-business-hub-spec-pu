import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const adminDb = createAdminClient()

  const { data, error } = await adminDb
    .from('company_settings')
    .select('orders_module_enabled, reels_logo_url')
    .limit(1)
    .single()

  if (error) {
    return NextResponse.json({ orders_module_enabled: true, reels_logo_url: '' })
  }

  return NextResponse.json(data)
}

// Persist the Reels Studio brand logo so it survives refreshes and is used
// for every new reel. Body: { reels_logo_url: string }
export async function POST(request: Request) {
  try {
    const { reels_logo_url } = await request.json()
    if (typeof reels_logo_url !== 'string') {
      return NextResponse.json({ error: 'reels_logo_url must be a string' }, { status: 400 })
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
      .update({ reels_logo_url, updated_at: new Date().toISOString() })
      .eq('id', row.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, reels_logo_url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
