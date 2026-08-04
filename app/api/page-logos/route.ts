import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Per-Facebook-Page brand logos for Reels Studio.
//
// Before this, one global logo (company_settings.reels_logo_url) was shared by
// every page, so switching the destination page meant re-uploading the logo
// every single time. Each page now keeps its own saved logo, and the seeded
// DEFAULT_KEY row holds the old global logo as a fallback for pages that have
// never had one set.
export const DEFAULT_KEY = '__default__'

export type PageLogo = { page_id: string; page_name: string | null; logo_url: string }

export async function GET() {
  const adminDb = createAdminClient()
  const { data, error } = await adminDb.from('page_logos').select('page_id, page_name, logo_url')

  if (error) {
    // Never block the studio on this - it falls back to the bundled logo
    return NextResponse.json({ logos: {}, fallback: '' })
  }

  const rows = (data ?? []) as PageLogo[]
  const logos: Record<string, string> = {}
  let fallback = ''
  for (const r of rows) {
    if (r.page_id === DEFAULT_KEY) fallback = r.logo_url
    else logos[r.page_id] = r.logo_url
  }

  return NextResponse.json({ logos, fallback })
}

// Save a logo for one page. Body: { pageId, pageName?, logoUrl }
// Passing pageId = '__default__' updates the shared fallback instead.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { pageId?: string; pageName?: string; logoUrl?: string }
    const pageId = String(body.pageId || '').trim()
    const logoUrl = String(body.logoUrl || '').trim()

    if (!pageId) {
      return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
    }
    if (!logoUrl) {
      return NextResponse.json({ error: 'logoUrl is required' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    const { error } = await adminDb.from('page_logos').upsert(
      {
        page_id: pageId,
        page_name: body.pageName ?? null,
        logo_url: logoUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'page_id' },
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, pageId, logoUrl })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
