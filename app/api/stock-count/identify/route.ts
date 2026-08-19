import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { analysePhoto } from '@/lib/product-identify'

// Two vision calls plus image downscaling. Nowhere near 60s in practice, but a
// cold start on a slow warehouse connection needs the headroom.
export const maxDuration = 60

// Never edge - the AI SDK requires the Node runtime.
export const runtime = 'nodejs'

/**
 * Two entry modes:
 *
 *  - `photoUrl`   analyse only. Used while the agent is still typing the
 *                 quantity, so the wait is hidden behind data entry. Nothing is
 *                 written, because the capture row does not exist yet - its
 *                 quantity is not known until they finish.
 *  - `captureId`  analyse and persist onto an existing capture. Used to retry a
 *                 capture that was interrupted, or to re-run one from the admin
 *                 queue.
 */
export async function POST(request: Request) {
  // This output ends up attached to real stock data, so it is not anonymous.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const { captureId, photoUrl } = (await request.json()) as {
    captureId?: string
    photoUrl?: string
  }

  if (!captureId && !photoUrl) {
    return NextResponse.json(
      { error: 'Either captureId or photoUrl is required' },
      { status: 400 },
    )
  }

  const db = createAdminClient()

  // Analyse-only mode.
  if (!captureId && photoUrl) {
    try {
      return NextResponse.json(await analysePhoto(photoUrl))
    } catch (error) {
      console.error('[v0] identify (photo) failed:', error)
      return NextResponse.json({
        status: 'unmatched',
        label: null,
        candidates: [],
        error: 'Could not analyse the photo',
      })
    }
  }

  const { data: capture } = await db
    .from('stock_count_captures')
    .select('id, photo_url, status')
    .eq('id', captureId as string)
    .single()

  if (!capture) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 })
  }
  // Already sorted out by a human - never overwrite their decision.
  if (capture.status === 'resolved') {
    return NextResponse.json({ status: 'resolved', label: null, candidates: [] })
  }

  try {
    const result = await analysePhoto(capture.photo_url)

    await db
      .from('stock_count_captures')
      .update({
        status: result.status,
        ai_label: result.label,
        ai_confidence: result.candidates[0]?.confidence ?? null,
        ai_candidates: result.candidates,
        ai_error: null,
      })
      .eq('id', capture.id)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[v0] identify (capture) failed:', error)
    await db
      .from('stock_count_captures')
      .update({
        status: 'unmatched',
        ai_error: (error as Error).message || 'Matching failed',
      })
      .eq('id', capture.id)
    return NextResponse.json({
      status: 'unmatched',
      label: null,
      candidates: [],
      error: 'Could not analyse the photo',
    })
  }
}
