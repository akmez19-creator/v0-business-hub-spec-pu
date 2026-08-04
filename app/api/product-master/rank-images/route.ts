import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveImageBytes } from '@/lib/product-master/poster-engine'
import { scoreProductImage, qualityLabel } from '@/lib/product-master/image-quality'

// Scoring several images with a vision model is not fast
export const maxDuration = 300

/**
 * Score product images and pick the best one.
 *
 * The same scoring path runs for a whole gallery and for a single newly-added
 * photo, so every image in the catalogue is judged by identical criteria - a
 * one-off "rank these" tool that new uploads bypassed would drift immediately.
 *
 * Verdicts are cached in product_image_scores and only recomputed when asked,
 * because each score is a paid vision call.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  try {
    const body = await request.json()
    const productId: string | null = typeof body?.productId === 'string' ? body.productId : null
    const images: string[] = Array.isArray(body?.images) ? body.images.map(String).filter(Boolean) : []
    const force = body?.force === true

    if (images.length === 0) {
      return NextResponse.json({ success: false, error: 'No images supplied' }, { status: 400 })
    }
    // A hard cap keeps one accidental request from running up a large bill.
    if (images.length > 24) {
      return NextResponse.json({ success: false, error: 'Too many images (max 24 per request)' }, { status: 400 })
    }

    // Reuse existing verdicts unless a rescore was explicitly requested
    const cached = new Map<string, { scores: unknown; total: number; reason: string | null }>()
    if (productId && !force) {
      const { data } = await supabase
        .from('product_image_scores')
        .select('image_url, scores, total, reason')
        .eq('product_id', productId)
        .in('image_url', images)
      for (const r of data ?? []) {
        cached.set((r as { image_url: string }).image_url, r as { scores: unknown; total: number; reason: string | null })
      }
    }

    const results: Array<{
      imageUrl: string
      scores: unknown
      total: number
      reason: string
      label: string
      cached: boolean
      error?: string
    }> = []

    for (const url of images) {
      const hit = cached.get(url)
      if (hit) {
        results.push({
          imageUrl: url,
          scores: hit.scores,
          total: Number(hit.total),
          reason: hit.reason ?? '',
          label: qualityLabel(Number(hit.total)),
          cached: true,
        })
        continue
      }
      try {
        const bytes = await resolveImageBytes(url)
        const verdict = await scoreProductImage(bytes)
        results.push({
          imageUrl: url,
          scores: verdict.scores,
          total: verdict.total,
          reason: verdict.reason,
          label: qualityLabel(verdict.total),
          cached: false,
        })
      } catch (e) {
        // An unreadable image is reported, NOT scored zero. A zero would rank
        // it last forever and quietly hide a photo that may be perfectly good.
        results.push({
          imageUrl: url,
          scores: null,
          total: -1,
          reason: '',
          label: 'Not scored',
          cached: false,
          error: e instanceof Error ? e.message : 'Could not score this image',
        })
      }
    }

    const scored = results.filter((r) => r.total >= 0)
    scored.sort((a, b) => b.total - a.total)
    const best = scored[0] ?? null

    // Persist verdicts and mark the winner
    if (productId && scored.length > 0) {
      const rows = scored
        .filter((r) => !r.cached)
        .map((r) => ({
          product_id: productId,
          image_url: r.imageUrl,
          scores: r.scores,
          total: r.total,
          reason: r.reason,
          is_primary: false,
        }))
      if (rows.length > 0) {
        await supabase.from('product_image_scores').upsert(rows, { onConflict: 'product_id,image_url' })
      }
      if (best) {
        // Exactly one primary per product: clear the old flag before setting
        await supabase
          .from('product_image_scores')
          .update({ is_primary: false })
          .eq('product_id', productId)
          .neq('image_url', best.imageUrl)
        await supabase
          .from('product_image_scores')
          .update({ is_primary: true })
          .eq('product_id', productId)
          .eq('image_url', best.imageUrl)
      }
    }

    return NextResponse.json({
      success: true,
      results: [...scored, ...results.filter((r) => r.total < 0)],
      best: best ? { imageUrl: best.imageUrl, total: best.total, reason: best.reason } : null,
      failed: results.filter((r) => r.total < 0).length,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Ranking failed' },
      { status: 500 },
    )
  }
}

/** Stored verdicts for a product, best first. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const productId = searchParams.get('productId')
  if (!productId) return NextResponse.json({ success: false, error: 'productId is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('product_image_scores')
    .select('*')
    .eq('product_id', productId)
    .order('total', { ascending: false })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    scores: (data ?? []).map((r) => ({ ...r, label: qualityLabel(Number((r as { total: number }).total)) })),
  })
}
