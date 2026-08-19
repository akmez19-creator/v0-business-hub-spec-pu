import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { suggestSearchTerms } from '@/lib/product-identify'

/**
 * A vision pass runs a model and downloads the photo, so it is slower than a
 * plain lookup. Node runtime because the pipeline uses sharp to downscale.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST { imageUrl } -> { label, terms[] }
 *
 * Reads the photo and proposes names to search a supplier marketplace with.
 * Deliberately separate from the search itself: the terms are shown to the
 * storekeeper to choose from, and each search they run costs a paid API call,
 * so describing and searching must not be welded together.
 */
export async function POST(request: Request) {
  try {
    // Same auth posture as the rest of product-master. Left unauthenticated this
    // would be an open, billable image-analysis endpoint.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const imageUrl = String(body?.imageUrl || '').trim()
    if (!imageUrl) {
      return NextResponse.json({ success: false, error: 'No photo to read' }, { status: 400 })
    }

    const { label, terms } = await suggestSearchTerms(imageUrl)
    return NextResponse.json({ success: true, label, terms })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read that photo'
    console.error('[v0] photo-terms failed -', message)
    // 502, not 500: the failure is almost always the model provider refusing or
    // timing out. The caller treats this as "no suggestions" and still shows the
    // visual-similarity results, so a failure here never blocks the search.
    return NextResponse.json({ success: false, error: message }, { status: 502 })
  }
}
