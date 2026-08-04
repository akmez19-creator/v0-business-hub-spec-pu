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

// A banner position as a percentage of the frame. Anything outside 0-100 is a
// bug upstream, and storing it would push branding off the video.
function coercePoint(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null
  const { x, y } = v as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 100 || y < 0 || y > 100) return null
  return { x, y }
}

// Clamp rather than reject: a slider value slightly out of range is worth
// saving at the nearest legal value, unlike a nonsense position
function clampNum(v: unknown, min: number, max: number, fallback: number) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.round(Math.min(max, Math.max(min, v)))
}

// How the watermark itself looks - everything except the image, which is
// already persisted per Page by /api/page-logos. Bounds mirror the studio's
// own sliders (size 6-45% of frame width, opacity 5-100%).
function coerceWatermark(v: unknown) {
  if (!v || typeof v !== 'object') return null
  const raw = v as Record<string, unknown>
  return {
    on: raw.on !== false, // default ON, matching the studio
    size: clampNum(raw.size, 6, 45, 18),
    opacity: clampNum(raw.opacity, 5, 100, 50),
    removeBg: raw.removeBg !== false, // cutout defaults ON too
    bgTol: clampNum(raw.bgTol, 0, 100, 30),
  }
}

// Rebuild the layout from scratch rather than trusting the body, so only these
// known keys can ever reach the column
function coerceLayout(v: unknown) {
  if (!v || typeof v !== 'object') return null
  const raw = v as Record<string, unknown>
  const preset = raw.preset
  if (preset !== 'top' && preset !== 'middle' && preset !== 'bottom' && preset !== 'custom') {
    return null
  }
  const title = coercePoint(raw.title)
  const price = coercePoint(raw.price)
  const logo = coercePoint(raw.logo)
  if (!title || !price || !logo) return null
  // Optional so rows saved before the watermark was part of the default still
  // load; those simply keep the studio's built-in watermark settings.
  const watermark = coerceWatermark(raw.watermark)
  return {
    preset,
    locked: raw.locked === true,
    title,
    price,
    logo,
    ...(watermark ? { watermark } : {}),
  }
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
