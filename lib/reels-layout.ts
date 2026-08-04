// Shared validation for a Reels Studio banner layout.
//
// The same shape is stored in two places - company_settings.reels_banner_layout
// (the global default) and page_logos.banner_layout (the per-Page override) -
// so the rules live here rather than being duplicated in both routes, where
// they would inevitably drift apart.

export type LayoutPoint = { x: number; y: number }

export type LayoutWatermark = {
  on: boolean
  size: number
  opacity: number
  removeBg: boolean
  bgTol: number
}

export type BannerLayout = {
  preset: 'top' | 'middle' | 'bottom' | 'custom'
  locked: boolean
  title: LayoutPoint
  price: LayoutPoint
  logo: LayoutPoint
  watermark?: LayoutWatermark
}

// A banner position as a percentage of the frame. Anything outside 0-100 is a
// bug upstream, and storing it would push branding off the video.
export function coercePoint(v: unknown): LayoutPoint | null {
  if (!v || typeof v !== 'object') return null
  const { x, y } = v as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 100 || y < 0 || y > 100) return null
  return { x, y }
}

// Clamp rather than reject: a slider value slightly out of range is worth
// saving at the nearest legal value, unlike a nonsense position
export function clampNum(v: unknown, min: number, max: number, fallback: number) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.round(Math.min(max, Math.max(min, v)))
}

// How the watermark itself looks - everything except the image, which is
// persisted separately per Page as logo_url. Bounds mirror the studio's own
// sliders (size 6-45% of frame width, opacity 5-100%).
export function coerceWatermark(v: unknown): LayoutWatermark | null {
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
export function coerceLayout(v: unknown): BannerLayout | null {
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
