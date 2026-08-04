import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Feature 9: tell the search UI which results are ALREADY in the clip library,
// so a video can be badged before the user spends time downloading it.
//
// Deliberately checks both source_id and source_url: the platform id is the
// reliable key, but clips saved before that column existed only have a url,
// and re-searching should still recognise those.

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const sourceIds: string[] = Array.isArray(body?.sourceIds)
      ? body.sourceIds.filter((s: unknown) => typeof s === 'string' && s).slice(0, 200)
      : []
    const sourceUrls: string[] = Array.isArray(body?.sourceUrls)
      ? body.sourceUrls.filter((s: unknown) => typeof s === 'string' && s).slice(0, 200)
      : []

    if (!sourceIds.length && !sourceUrls.length) {
      return NextResponse.json({ success: true, savedIds: [], savedUrls: [] })
    }

    const admin = createAdminClient()
    const savedIds = new Set<string>()
    const savedUrls = new Set<string>()

    if (sourceIds.length) {
      const { data } = await admin
        .from('product_clips')
        .select('source_id')
        .in('source_id', sourceIds)
      for (const row of data ?? []) if (row.source_id) savedIds.add(row.source_id)
    }

    if (sourceUrls.length) {
      const { data } = await admin
        .from('product_clips')
        .select('source_url')
        .in('source_url', sourceUrls)
      for (const row of data ?? []) if (row.source_url) savedUrls.add(row.source_url)
    }

    return NextResponse.json({
      success: true,
      savedIds: [...savedIds],
      savedUrls: [...savedUrls],
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 },
    )
  }
}
