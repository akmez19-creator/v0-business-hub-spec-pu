import { coerceLayout, type BannerLayout } from '@/lib/reels-layout'
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

export type PageLogo = {
  page_id: string
  page_name: string | null
  logo_url: string
  banner_layout: BannerLayout | null
}

export async function GET() {
  const adminDb = createAdminClient()
  const { data, error } = await adminDb
    .from('page_logos')
    .select('page_id, page_name, logo_url, banner_layout')

  if (error) {
    // Never block the studio on this - it falls back to the bundled logo
    return NextResponse.json({ logos: {}, fallback: '', layouts: {} })
  }

  const rows = (data ?? []) as PageLogo[]
  const logos: Record<string, string> = {}
  // Keyed by page_id alongside the logos, so picking a Page can restore its
  // whole look (banner spot + watermark) in one lookup rather than a second
  // round trip per selection.
  const layouts: Record<string, BannerLayout> = {}
  let fallback = ''
  for (const r of rows) {
    if (r.page_id === DEFAULT_KEY) fallback = r.logo_url
    else logos[r.page_id] = r.logo_url
    if (r.banner_layout) layouts[r.page_id] = r.banner_layout
  }

  return NextResponse.json({ logos, fallback, layouts })
}

// Save a page's brand settings. Body: { pageId, pageName?, logoUrl?, bannerLayout? }
// Passing pageId = '__default__' updates the shared fallback instead.
//
// logoUrl and bannerLayout are applied independently, so saving a banner spot
// never disturbs that page's saved logo (and vice versa) - at least one must be
// present for there to be anything to do.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      pageId?: string
      pageName?: string
      logoUrl?: string
      bannerLayout?: unknown
    }
    const pageId = String(body.pageId || '').trim()

    if (!pageId) {
      return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}

    if ('logoUrl' in body) {
      const logoUrl = String(body.logoUrl || '').trim()
      if (!logoUrl) {
        return NextResponse.json({ error: 'logoUrl cannot be empty' }, { status: 400 })
      }
      patch.logo_url = logoUrl
    }

    if ('bannerLayout' in body) {
      // null is a legitimate value - it drops this page back to the global default
      if (body.bannerLayout === null) {
        patch.banner_layout = null
      } else {
        const layout = coerceLayout(body.bannerLayout)
        if (!layout) {
          return NextResponse.json({ error: 'bannerLayout is malformed' }, { status: 400 })
        }
        patch.banner_layout = layout
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    const { error } = await adminDb.from('page_logos').upsert(
      {
        page_id: pageId,
        page_name: body.pageName ?? null,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'page_id' },
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, pageId, ...patch })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
