import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Feature 9: lets a search grid grey out clips that are ALREADY in the library
// before the user clicks save. Returns just the identity columns - the caller
// only needs to test membership, so shipping full rows would be wasteful.

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('product_clips')
      .select('id, source_id, source_url, name, product_name')
      .limit(2000)

    if (error) throw error

    const rows = data ?? []
    return NextResponse.json({
      success: true,
      // Two indexes because not every saved clip has a source_id: anything
      // added before this feature, or uploaded by hand, only has a url.
      sourceIds: rows.map((r) => r.source_id).filter(Boolean),
      sourceUrls: rows.map((r) => r.source_url).filter(Boolean),
      saved: rows
        .filter((r) => r.source_id || r.source_url)
        .map((r) => ({
          id: r.id,
          sourceId: r.source_id,
          sourceUrl: r.source_url,
          name: r.name,
          productName: r.product_name,
        })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not load known sources' },
      { status: 500 },
    )
  }
}
