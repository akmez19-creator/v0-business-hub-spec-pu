'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VideoSearchPanel } from '@/components/product-master/video-search-panel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  Eraser,
  Film,
  ImageIcon,
  Link2,
  Loader2,
  Merge,
  Move,
  Megaphone,
  RefreshCw,
  Scissors,
  Send,
  Stamp,
  Tag,
  Trash2,
  Type,
  Upload,
} from 'lucide-react'
import { ReelPublishPanel } from './reel-publish-panel'
import { ReelAdPanel } from './reel-ad-panel'

interface Clip {
  id: string
  name: string
  url: string
  file: File
  duration: number
  width: number
  height: number
}

// Banner style presets for the product-name title
// Style library for burned-in banners. The first 5 are the proven combos;
// the rest are high-contrast ad-tested looks so Shuffle / auto-restyle always
// lands on something that reads well on video. Optional fields:
//   bubble2 - gradient end color for the bubble (diagonal gradient)
//   glow    - soft colored glow behind the text (canvas shadow / CSS shadow)
const TITLE_STYLES = [
  { id: 'sunny', label: 'Sunny', bubble: '#FFD934', text: '#F97316', stroke: '#C2410C', shape: 'pill' },
  { id: 'clean', label: 'Clean', bubble: '#FFFFFF', text: '#111111', stroke: null, shape: 'pill' },
  { id: 'bold', label: 'Bold', bubble: '#111111', text: '#FFFFFF', stroke: null, shape: 'bar' },
  { id: 'flash', label: 'Flash', bubble: '#DC2626', text: '#FFFFFF', stroke: null, shape: 'pill' },
  { id: 'outline', label: 'Outline', bubble: null, text: '#FFFFFF', stroke: '#000000', shape: 'none' },
  { id: 'midnight', label: 'Gold', bubble: '#111111', text: '#FBBF24', stroke: null, shape: 'pill', glow: 'rgba(251,191,36,0.55)' },
  { id: 'lime', label: 'Lime', bubble: '#A3E635', text: '#1A2E05', stroke: null, shape: 'pill' },
  { id: 'ocean', label: 'Ocean', bubble: '#2563EB', bubble2: '#06B6D4', text: '#FFFFFF', stroke: null, shape: 'pill' },
  { id: 'sunset', label: 'Sunset', bubble: '#F97316', bubble2: '#EF4444', text: '#FFFFFF', stroke: null, shape: 'pill' },
  { id: 'candy', label: 'Candy', bubble: '#EC4899', text: '#FFFFFF', stroke: null, shape: 'pill' },
  { id: 'paper', label: 'Paper', bubble: '#FFFFFF', text: '#111111', stroke: null, shape: 'bar' },
  { id: 'ghost', label: 'Ghost', bubble: null, text: '#111111', stroke: '#FFFFFF', shape: 'none' },
  { id: 'emerald', label: 'Emerald', bubble: '#059669', text: '#FFFFFF', stroke: null, shape: 'pill' },
] as const
type TitleStyleId = (typeof TITLE_STYLES)[number]['id']

// Promo price tag layouts - how the old price and the new price are arranged
const PROMO_LAYOUTS = [
  { id: 'wasnow', label: 'Was / Now', hint: 'Was Rs 1,375  Now Rs 999' },
  { id: 'strike', label: 'Cut price', hint: 'Rs 1̶,̶3̶7̶5̶  Rs 999' },
  { id: 'stacked', label: 'Stacked', hint: 'old on top, new below' },
  { id: 'save', label: 'Save %', hint: 'adds a -27% badge' },
  { id: 'only', label: 'New only', hint: 'just the new price' },
] as const
type PromoLayoutId = (typeof PROMO_LAYOUTS)[number]['id']

// Logo shipped with the app, used until a page has one saved
const DEFAULT_LOGO = '/images/reels-brand-logo.png'
// Shared logo row: covers pages that have never had their own logo set
const DEFAULT_PAGE_KEY = '__default__'

// Prices are Postgres `numeric`. supabase-js hands them over as real numbers,
// but raw SQL clients serialize the same column as a string ("475.00"), so
// coerce rather than trusting typeof - a silent string here would skip every
// prefill without throwing anything.
function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// Product Master stores prices as plain numerics; the tag wants them the way
// a customer reads them. Drops trailing ".00" so "Rs 999" never becomes
// "Rs 999.00" on screen.
function fmtRs(v: number | string | null | undefined): string {
  const n = toNum(v)
  if (n === null) return ''
  const rounded = Math.round(n * 100) / 100
  const body = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-IN')
    : rounded.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `Rs ${body}`
}

// Reels Studio: everything runs IN the browser via ffmpeg.wasm - cut a scene
// out of a clip (trim), brand it (product-name title + logo watermark), or
// merge the strip into one reel. No server cost, files never leave the
// machine until the user downloads the result.
export function ReelsStudioTab({
  productName = '',
  productImage = null,
  productPrice = null,
  productPromoPrice = null,
  onBoostPost,
}: {
  productName?: string
  /** Inventory photo for this product - powers the lens video search */
  productImage?: string | null
  /** Product Master list price - becomes the struck-out "was" price.
   *  Postgres numeric, so it can arrive as a string. */
  productPrice?: number | string | null
  /** Product Master promo price - becomes the highlighted "now" price */
  productPromoPrice?: number | string | null
  /** Called when the user wants to boost the post they just published */
  onBoostPost?: (boost: { pageId: string; postId: string }) => void
}) {
  const [clips, setClips] = useState<Clip[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const [busy, setBusy] = useState<'cut' | 'merge' | 'brand' | 'load' | null>(null)
  const [progress, setProgress] = useState(0)
  const [output, setOutput] = useState<{ url: string; name: string; blob: Blob } | null>(null)
  // Clean (un-branded) snapshot of whatever was branded, so branding is
  // non-destructive: re-applying replaces the old branding instead of
  // stacking, and it can be removed entirely.
  const [preBrand, setPreBrand] = useState<{ url: string; name: string; blob: Blob; wasOutput: boolean } | null>(null)
  // Post-to-Facebook panel visibility (opens on "Post it")
  const [showPublish, setShowPublish] = useState(false)
  // Create-ad panel visibility (opens on "Create ad")
  const [showAdPanel, setShowAdPanel] = useState(false)
  const [error, setError] = useState('')
  const [ffmpegReady, setFfmpegReady] = useState(false)
  const ffmpegRef = useRef<any>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ---- Branding: product-name title banner + price tag + logo watermark ----
  const [titleOn, setTitleOn] = useState(true)
  const [titleText, setTitleText] = useState(productName)
  const [titleStyle, setTitleStyle] = useState<TitleStyleId>('sunny')
  const [titleSize, setTitleSize] = useState(8.5) // font size as % of video width
  // Prices come straight from Product Master: the list price is the struck-out
  // "was", the promo price is the "now". A product with a promo set turns the
  // tag on by default (that is the whole point of setting one); a product
  // without one just prefills its list price and leaves the tag off.
  const listPrice = toNum(productPrice)
  const promoPrice = toNum(productPromoPrice)
  const hasPromo = promoPrice !== null && promoPrice > 0
  const hasList = listPrice !== null && listPrice > 0
  const [priceOn, setPriceOn] = useState(hasPromo)
  const [priceOld, setPriceOld] = useState(hasPromo && hasList ? fmtRs(listPrice) : '')
  const [priceNew, setPriceNew] = useState(hasPromo ? fmtRs(promoPrice) : hasList ? fmtRs(listPrice) : '')
  const [promoLayout, setPromoLayout] = useState<PromoLayoutId>(hasPromo ? 'wasnow' : 'only')
  const [priceStyle, setPriceStyle] = useState<TitleStyleId>('flash')
  const [priceSize, setPriceSize] = useState(7) // font size as % of video width
  const [logoOn, setLogoOn] = useState(true)
  const [logoOpacity, setLogoOpacity] = useState(50) // %
  const [logoSize, setLogoSize] = useState(18) // % of video width
  const [logoSrc, setLogoSrc] = useState(DEFAULT_LOGO)
  const [logoRemoveBg, setLogoRemoveBg] = useState(false)
  const [logoBgTol, setLogoBgTol] = useState(30) // background match tolerance %
  const [processedLogo, setProcessedLogo] = useState<string | null>(null)
  const [logoSaving, setLogoSaving] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  // ---- Per-page brand logo ------------------------------------------------
  // Each Facebook Page keeps its own saved logo. Switching the page below
  // swaps the watermark instead of making the user re-upload every time.
  // Pages with nothing saved fall back to the shared logo, then the bundled one.
  const [brandPageId, setBrandPageId] = useState('')
  const [brandPages, setBrandPages] = useState<{ id: string; name: string }[]>([])
  const [pageLogos, setPageLogos] = useState<Record<string, string>>({})
  const [logoFallback, setLogoFallback] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/page-logos')
        .then((r) => r.json())
        .catch(() => ({ logos: {}, fallback: '' })),
      fetch('/api/product-master/posts/publish')
        .then((r) => r.json())
        .catch(() => ({ pages: [] })),
    ])
      .then(([logoJson, pageJson]) => {
        if (cancelled) return
        const logos = (logoJson?.logos ?? {}) as Record<string, string>
        const fallback = String(logoJson?.fallback || '')
        const pages = (pageJson?.pages ?? []) as { id: string; name: string }[]
        setPageLogos(logos)
        setLogoFallback(fallback)
        setBrandPages(pages)
        const first = pages[0]?.id ?? ''
        setBrandPageId(first)
        const resolved = (first && logos[first]) || fallback
        if (resolved) setLogoSrc(resolved)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Switch the page the logo belongs to and show that page's saved logo
  const selectBrandPage = (id: string) => {
    setBrandPageId(id)
    setLogoSrc(pageLogos[id] || logoFallback || DEFAULT_LOGO)
  }

  // Change logo: show it instantly, upload to blob storage, then save it
  // against the SELECTED page so it comes back automatically next time.
  const handleLogoFile = async (f: File) => {
    const previewUrl = URL.createObjectURL(f)
    setLogoSrc(previewUrl)
    setLogoSaving(true)
    const targetId = brandPageId || DEFAULT_PAGE_KEY
    try {
      const fd = new FormData()
      fd.append('file', f)
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      const upJson = await up.json()
      if (!up.ok || !upJson.url) throw new Error(upJson.error || 'Upload failed')
      setLogoSrc(upJson.url)
      await fetch('/api/page-logos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: targetId,
          pageName: brandPages.find((p) => p.id === targetId)?.name ?? null,
          logoUrl: upJson.url,
        }),
      })
      setPageLogos((m) => ({ ...m, [targetId]: upJson.url }))
      if (targetId === DEFAULT_PAGE_KEY) setLogoFallback(upJson.url)
    } catch {
      // Keep the local preview even if persistence fails
    } finally {
      setLogoSaving(false)
    }
  }

  // Free placement: element centers as % of video width/height, draggable
  // directly on the preview
  const [titlePos, setTitlePos] = useState({ x: 50, y: 10 })
  const [pricePos, setPricePos] = useState({ x: 50, y: 22 })
  const [logoXY, setLogoXY] = useState({ x: 82, y: 88 })
  const previewBoxRef = useRef<HTMLDivElement>(null)
  const [previewW, setPreviewW] = useState(0)
  const dragTarget = useRef<'title' | 'price' | 'logo' | null>(null)

  // Keep the preview font/logo scale proportional to the rendered video box
  useEffect(() => {
    const el = previewBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPreviewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  })

  // Alignment guides: while dragging, center lines appear and the element
  // snaps to them within SNAP_PCT percent (Canva-style smart guides)
  const SNAP_PCT = 2.5
  const [guides, setGuides] = useState({ v: false, h: false })
  const [dragging, setDragging] = useState(false)

  const onPreviewPointerMove = (e: React.PointerEvent) => {
    if (!dragTarget.current || !previewBoxRef.current) return
    const rect = previewBoxRef.current.getBoundingClientRect()
    let x = Math.min(97, Math.max(3, ((e.clientX - rect.left) / rect.width) * 100))
    let y = Math.min(97, Math.max(3, ((e.clientY - rect.top) / rect.height) * 100))
    const snapV = Math.abs(x - 50) <= SNAP_PCT
    const snapH = Math.abs(y - 50) <= SNAP_PCT
    if (snapV) x = 50
    if (snapH) y = 50
    setGuides({ v: snapV, h: snapH })
    if (dragTarget.current === 'title') setTitlePos({ x, y })
    else if (dragTarget.current === 'price') setPricePos({ x, y })
    else setLogoXY({ x, y })
  }

  const endPreviewDrag = () => {
    dragTarget.current = null
    setDragging(false)
    setGuides({ v: false, h: false })
  }

  // Remove the logo's background. Primary path: AI matting (BiRefNet via
  // /api/product-master/remove-bg) for clean, Canva-quality cutouts on any
  // background. Fallback: the old in-browser flood-fill if the API fails.
  const [removingBg, setRemovingBg] = useState(false)
  useEffect(() => {
    if (!logoRemoveBg) {
      setProcessedLogo(null)
      return
    }
    let cancelled = false
    setRemovingBg(true)
    ;(async () => {
      try {
        // The AI route needs a data URL or http(s) URL - local paths like
        // /images/... are converted to data URLs first
        let payload = logoSrc
        if (payload.startsWith('/')) {
          const r = await fetch(payload)
          const blob = await r.blob()
          payload = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(fr.result as string)
            fr.onerror = reject
            fr.readAsDataURL(blob)
          })
        }
        const res = await fetch('/api/product-master/remove-bg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: payload }),
        })
        const json = await res.json()
        if (!res.ok || !json.dataUrl) throw new Error(json.error || 'AI removal failed')
        if (!cancelled) {
          setProcessedLogo(json.dataUrl)
          setRemovingBg(false)
        }
        return
      } catch {
        // fall through to the flood-fill fallback below
      }
      if (cancelled) return
      floodFillFallback()
    })()

    function floodFillFallback() {
      const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, w, h)
      const px = data.data
      // Sample the 4 corners as background reference colors
      const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4].map((o) => [px[o], px[o + 1], px[o + 2]])
      const tol = (logoBgTol / 100) * 255
      const matches = (o: number) =>
        corners.some(([r, g, b]) => Math.abs(px[o] - r) + Math.abs(px[o + 1] - g) + Math.abs(px[o + 2] - b) < tol * 3)
      // BFS from every border pixel so interior same-colored details survive
      const visited = new Uint8Array(w * h)
      const queue: number[] = []
      for (let x = 0; x < w; x++) queue.push(x, (h - 1) * w + x)
      for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1)
      while (queue.length) {
        const i = queue.pop()!
        if (visited[i]) continue
        visited[i] = 1
        const o = i * 4
        if (px[o + 3] === 0 || !matches(o)) continue
        px[o + 3] = 0
        const x = i % w
        const y = (i / w) | 0
        if (x > 0) queue.push(i - 1)
        if (x < w - 1) queue.push(i + 1)
        if (y > 0) queue.push(i - w)
        if (y < h - 1) queue.push(i + w)
      }
      ctx.putImageData(data, 0, 0)
      if (!cancelled) {
        setProcessedLogo(canvas.toDataURL('image/png'))
        setRemovingBg(false)
      }
    }
      img.onerror = () => {
        if (!cancelled) {
          setProcessedLogo(null)
          setRemovingBg(false)
        }
      }
      img.src = logoSrc
    }
    return () => {
      cancelled = true
    }
  }, [logoSrc, logoRemoveBg, logoBgTol])

  const effectiveLogoSrc = logoRemoveBg && processedLogo ? processedLogo : logoSrc
  const activeStyle = TITLE_STYLES.find((s) => s.id === titleStyle) ?? TITLE_STYLES[0]
  const activePriceStyle = TITLE_STYLES.find((s) => s.id === priceStyle) ?? TITLE_STYLES[3]

  // Plain-text version of the promo tag, used by the AI caption writer
  const priceText = priceNew.trim() ? (priceOld.trim() ? `${priceNew.trim()} was ${priceOld.trim()}` : priceNew.trim()) : ''

  // ---- Promo price tag ----------------------------------------------------
  // The tag is composed of styled segments (old price struck out, new price
  // big, optional discount badge) and rendered ONCE into a tight canvas that
  // is reused by both the preview and the burn, so they can never disagree.
  type PromoSeg = { text: string; scale: number; strike?: boolean; dim?: boolean; accent?: boolean }

  const buildPromoLines = (oldP: string, newP: string, layout: PromoLayoutId): PromoSeg[][] => {
    const o = oldP.trim()
    const n = newP.trim()
    if (!o || layout === 'only') return [[{ text: n, scale: 1 }]]
    switch (layout) {
      case 'wasnow':
        return [
          [
            { text: `Was ${o}`, scale: 0.58, dim: true },
            { text: `Now ${n}`, scale: 1 },
          ],
        ]
      case 'strike':
        return [
          [
            { text: o, scale: 0.66, strike: true, dim: true },
            { text: n, scale: 1 },
          ],
        ]
      case 'stacked':
        return [[{ text: o, scale: 0.52, strike: true, dim: true }], [{ text: n, scale: 1 }]]
      case 'save': {
        const on = Number(o.replace(/[^\d.]/g, ''))
        const nn = Number(n.replace(/[^\d.]/g, ''))
        const pct = on > 0 && nn > 0 && nn < on ? Math.round(((on - nn) / on) * 100) : 0
        return [
          [
            { text: o, scale: 0.52, strike: true, dim: true },
            ...(pct ? [{ text: `-${pct}%`, scale: 0.46, accent: true }] : []),
          ],
          [{ text: n, scale: 1 }],
        ]
      }
      default:
        return [[{ text: n, scale: 1 }]]
    }
  }

  // Draws the promo tag into a tight canvas sized exactly to the tag.
  // refW is the reference width (video width when burning, preview width when
  // previewing) so both come out proportionally identical.
  const drawPromoTag = (
    refW: number,
    oldP: string,
    newP: string,
    layout: PromoLayoutId,
    st: (typeof TITLE_STYLES)[number],
    sizePct: number,
  ) => {
    const lines = buildPromoLines(oldP, newP, layout)
    const probe = document.createElement('canvas').getContext('2d')
    if (!probe) return null
    const font = (px: number) => `900 ${px}px 'Arial Black', Arial, sans-serif`
    let base = Math.max(8, Math.round(refW * (sizePct / 100)))

    const measure = () => {
      const gap = base * 0.34
      const widths = lines.map((segs) => {
        let w = 0
        segs.forEach((s, i) => {
          probe.font = font(base * s.scale)
          w += probe.measureText(s.text).width + (s.accent ? base * s.scale * 0.9 : 0) + (i ? gap : 0)
        })
        return w
      })
      return { gap, widths, maxW: Math.max(...widths) }
    }

    let m = measure()
    while (m.maxW + base * 1.5 > refW * 0.92 && base > 6) {
      base -= 1
      m = measure()
    }

    const padX = base * 0.75
    const padY = base * 0.42
    const lineGap = base * 0.14
    const lineHeights = lines.map((segs) => base * Math.max(...segs.map((s) => s.scale)) * 1.14)
    const bw = Math.ceil(m.maxW + padX * 2)
    const bh = Math.ceil(lineHeights.reduce((a, b) => a + b, 0) + lineGap * (lines.length - 1) + padY * 2)

    const canvas = document.createElement('canvas')
    canvas.width = bw
    canvas.height = bh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    if (st.bubble) {
      ctx.beginPath()
      ctx.roundRect(0, 0, bw, bh, st.shape === 'bar' ? bh * 0.14 : bh / 2)
      if ('bubble2' in st && st.bubble2) {
        const grad = ctx.createLinearGradient(0, 0, bw, bh)
        grad.addColorStop(0, st.bubble)
        grad.addColorStop(1, st.bubble2)
        ctx.fillStyle = grad
      } else {
        ctx.fillStyle = st.bubble
      }
      ctx.fill()
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'

    let y = padY
    lines.forEach((segs, li) => {
      const lh = lineHeights[li]
      const cy = y + lh / 2
      let x = (bw - m.widths[li]) / 2
      segs.forEach((s) => {
        const fs = base * s.scale
        ctx.font = font(fs)
        const tw = ctx.measureText(s.text).width

        // Discount badge: inverted pill so it pops out of the tag
        if (s.accent) {
          const padA = fs * 0.45
          ctx.beginPath()
          ctx.roundRect(x, cy - fs * 0.78, tw + padA * 2, fs * 1.56, fs * 0.78)
          ctx.fillStyle = st.bubble ? st.text : '#DC2626'
          ctx.fill()
          ctx.fillStyle = st.bubble ?? '#FFFFFF'
          ctx.fillText(s.text, x + padA, cy)
          x += tw + padA * 2 + m.gap
          return
        }

        ctx.globalAlpha = s.dim ? 0.82 : 1
        if (st.stroke) {
          ctx.strokeStyle = st.stroke
          ctx.lineWidth = Math.max(2, fs * (st.shape === 'none' ? 0.16 : 0.08))
          ctx.strokeText(s.text, x, cy)
        }
        if ('glow' in st && st.glow && !s.dim) {
          ctx.shadowColor = st.glow
          ctx.shadowBlur = fs * 0.35
        }
        ctx.fillStyle = st.text
        ctx.fillText(s.text, x, cy)
        ctx.shadowBlur = 0

        if (s.strike) {
          ctx.beginPath()
          ctx.lineWidth = Math.max(2, fs * 0.09)
          ctx.strokeStyle = st.text
          ctx.moveTo(x - fs * 0.08, cy)
          ctx.lineTo(x + tw + fs * 0.08, cy)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        x += tw + m.gap
      })
      y += lh + lineGap
    })

    return { canvas, w: bw, h: bh }
  }

  // Preview image of the tag, rendered at preview scale with the same code
  // path the burn uses
  const promoTag = useMemo(() => {
    if (!priceOn || !priceNew.trim() || !previewW) return null
    const t = drawPromoTag(previewW, priceOld, priceNew, promoLayout, activePriceStyle, priceSize)
    return t ? { url: t.canvas.toDataURL('image/png'), w: t.w, h: t.h } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceOn, priceOld, priceNew, promoLayout, activePriceStyle, priceSize, previewW])

  // Mirror of renderBannerPng's sizing math so the PREVIEW banner is pixel-
  // faithful to what gets burned: same Arial Black 900 font, same shrink-to-
  // fit loop (92% max width), same padding ratios (0.42/0.75 of font size).
  const measureRef = useRef<CanvasRenderingContext2D | null>(null)
  const measureBanner = (text: string, sizePct: number, boxW: number) => {
    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d')
    const ctx = measureRef.current
    let fontSize = Math.round(boxW * (sizePct / 100))
    if (!ctx) return { fontSize, bw: 0, bh: 0, padX: 0, padY: 0 }
    ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`
    const maxW = boxW * 0.92
    while (ctx.measureText(text).width > maxW && fontSize > 4) {
      fontSize -= 1
      ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`
    }
    const tw = ctx.measureText(text).width
    const padX = fontSize * 0.75
    const padY = fontSize * 0.42
    return { fontSize, bw: tw + padX * 2, bh: fontSize + padY * 2, padX, padY }
  }

  // Auto-restyle: every 5 minutes pick a completely fresh random look for the
  // title + price (never the current ones, never the same style on both), so
  // repeated posts don't all share the same style. Manual shuffle too.
  const [autoRestyle, setAutoRestyle] = useState(false)
  const shuffleStyles = useCallback(() => {
    const pick = (exclude: string[]) => {
      const pool = TITLE_STYLES.filter((s) => !exclude.includes(s.id))
      return pool[Math.floor(Math.random() * pool.length)].id
    }
    setTitleStyle((prevTitle) => {
      const nextTitle = pick([prevTitle])
      setPriceStyle((prevPrice) => pick([prevPrice, nextTitle]))
      return nextTitle
    })
  }, [])
  useEffect(() => {
    if (!autoRestyle) return
    const timer = setInterval(shuffleStyles, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [autoRestyle, shuffleStyles])

  // ---- Fetch-by-link: paste a TikTok/Facebook/YouTube URL and the video is
  // resolved watermark-free in HD and dropped straight into the feed ----
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [fetchInfo, setFetchInfo] = useState('')

  const fetchFromLink = async () => {
    const url = link.trim()
    if (!url || fetching) return
    setFetching(true)
    setFetchError('')
    setFetchInfo('Resolving video\u2026')
    try {
      const res = await fetch('/api/product-master/video-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const meta = await res.json()
      if (!meta.success) throw new Error(meta.error || 'Could not fetch this video')

      setFetchInfo(`Downloading ${meta.quality === 'hd' ? 'HD' : 'SD'} video\u2026`)
      const safeName = `${meta.source}-${(meta.title || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'video'}.mp4`
      const proxied = `/api/product-master/video-fetch?src=${encodeURIComponent(meta.videoUrl)}&filename=${encodeURIComponent(safeName)}`
      const fileRes = await fetch(proxied)
      if (!fileRes.ok) throw new Error('Download failed - the video link may have expired, try again')
      const blob = await fileRes.blob()
      if (blob.size < 10_000) throw new Error('Downloaded file looks empty - try again')

      const file = new File([blob], safeName, { type: 'video/mp4' })
      addFiles([file])
      setLink('')
      setFetchInfo(`Added: ${safeName}`)
      setTimeout(() => setFetchInfo(''), 4000)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Could not fetch this video')
      setFetchInfo('')
    } finally {
      setFetching(false)
    }
  }

  // Lazy-load the wasm core only when this tab mounts
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setBusy('load')
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg')
        const { toBlobURL } = await import('@ffmpeg/util')
        const ffmpeg = new FFmpeg()
        ffmpeg.on('progress', ({ progress: p }: { progress: number }) => {
          setProgress(Math.min(100, Math.round(p * 100)))
        })
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
        await ffmpeg.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        if (!cancelled) {
          ffmpegRef.current = ffmpeg
          setFfmpegReady(true)
        }
      } catch (e) {
        if (!cancelled) setError('Could not load the video engine. Check your connection and reopen this tab.')
      } finally {
        if (!cancelled) setBusy(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const addFiles = useCallback((files: FileList | File[]) => {
    const vids = Array.from(files).filter((f) => f.type.startsWith('video/'))
    for (const file of vids) {
      const url = URL.createObjectURL(file)
      const probe = document.createElement('video')
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        setClips((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${file.name}`,
            name: file.name,
            url,
            file,
            duration: probe.duration || 0,
            width: probe.videoWidth || 1080,
            height: probe.videoHeight || 1920,
          },
        ])
      }
      probe.src = url
    }
  }, [])

  const selectedClip = clips.find((c) => c.id === selected) || null

  const selectClip = (c: Clip) => {
    setSelected(c.id)
    setRange([0, Math.floor(c.duration)])
    setOutput(null)
    setPreBrand(null)
  }

  const move = (id: string, dir: -1 | 1) =>
    setClips((prev) => {
      const i = prev.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const remove = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id))
    if (selected === id) setSelected(null)
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // CUT SCENE: trim the selected clip to [start, end]. Stream-copy first for
  // speed; ffmpeg falls back cleanly since we re-encode when copy fails.
  const cutScene = async () => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg || !selectedClip) return
    setBusy('cut')
    setProgress(0)
    setError('')
    setOutput(null)
    setPreBrand(null)
    try {
      const { fetchFile } = await import('@ffmpeg/util')
      await ffmpeg.writeFile('in.mp4', await fetchFile(selectedClip.file))
      const [start, end] = range
      let ok = true
      try {
        await ffmpeg.exec(['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c', 'copy', 'out.mp4'])
      } catch {
        ok = false
      }
      if (!ok) {
        await ffmpeg.exec(['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'out.mp4'])
      }
      const data = await ffmpeg.readFile('out.mp4')
      const blob = new Blob([data], { type: 'video/mp4' })
      setOutput({ url: URL.createObjectURL(blob), name: `cut-${selectedClip.name.replace(/\.[^.]+$/, '')}.mp4`, blob })
    } catch (e) {
      setError('Cut failed. Try a shorter range or a different clip.')
    } finally {
      setBusy(null)
      setProgress(0)
    }
  }

  // MERGE: concat every clip in strip order. Re-encode to normalize
  // dimensions/codecs so mixed sources merge reliably.
  const mergeClips = async () => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg || clips.length < 2) return
    setBusy('merge')
    setProgress(0)
    setError('')
    setOutput(null)
    setPreBrand(null)
    try {
      const { fetchFile } = await import('@ffmpeg/util')
      const names: string[] = []
      for (let i = 0; i < clips.length; i++) {
        const n = `m${i}.mp4`
        await ffmpeg.writeFile(n, await fetchFile(clips[i].file))
        names.push(n)
      }
      // Normalize each to 1080x1920-safe scale + same codec, then concat
      const args: string[] = []
      for (const n of names) args.push('-i', n)
      const filters =
        names.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=44100[a${i}]`).join(';') +
        ';' +
        names.map((_, i) => `[v${i}][a${i}]`).join('') +
        `concat=n=${names.length}:v=1:a=1[outv][outa]`
      await ffmpeg.exec([
        ...args,
        '-filter_complex', filters,
        '-map', '[outv]', '-map', '[outa]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
        'merged.mp4',
      ])
      const data = await ffmpeg.readFile('merged.mp4')
      const blob = new Blob([data], { type: 'video/mp4' })
      setOutput({ url: URL.createObjectURL(blob), name: `reel-merged-${clips.length}clips.mp4`, blob })
    } catch (e) {
      setError('Merge failed. Clips without audio tracks can cause this - try clips with sound.')
    } finally {
      setBusy(null)
      setProgress(0)
    }
  }

  // Draw a text banner (title or price) in the chosen style and size,
  // centered on the user-dragged position, onto a transparent canvas sized
  // to the video.
  const renderBannerPng = (
    vw: number,
    vh: number,
    rawText: string,
    st: (typeof TITLE_STYLES)[number],
    sizePct: number,
    pos: { x: number; y: number },
  ): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      canvas.width = vw
      canvas.height = vh
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('no canvas'))
      const text = rawText.trim()
      if (!text) return reject(new Error('no text'))

      let fontSize = Math.round(vw * (sizePct / 100))
      ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`
      const maxW = vw * 0.92
      while (ctx.measureText(text).width > maxW && fontSize > 14) {
        fontSize -= 2
        ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`
      }
      const tw = ctx.measureText(text).width
      const padX = fontSize * 0.75
      const padY = fontSize * 0.42
      const bw = tw + padX * 2
      const bh = fontSize + padY * 2
      // Center the banner on the dragged position, clamped inside the frame
      const cx = Math.max(bw / 2, Math.min(vw - bw / 2, (pos.x / 100) * vw))
      const cy = Math.max(bh / 2, Math.min(vh - bh / 2, (pos.y / 100) * vh))
      const bx = cx - bw / 2
      const by = cy - bh / 2

      if (st.bubble) {
        ctx.beginPath()
        ctx.roundRect(bx, by, bw, bh, st.shape === 'bar' ? bh * 0.18 : bh / 2)
        if ('bubble2' in st && st.bubble2) {
          const grad = ctx.createLinearGradient(bx, by, bx + bw, by + bh)
          grad.addColorStop(0, st.bubble)
          grad.addColorStop(1, st.bubble2)
          ctx.fillStyle = grad
        } else {
          ctx.fillStyle = st.bubble
        }
        ctx.fill()
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      if (st.stroke) {
        ctx.strokeStyle = st.stroke
        ctx.lineWidth = Math.max(2, fontSize * (st.shape === 'none' ? 0.16 : 0.08))
        ctx.strokeText(text, cx, cy + fontSize * 0.05)
      }
      if ('glow' in st && st.glow) {
        ctx.shadowColor = st.glow
        ctx.shadowBlur = fontSize * 0.35
      }
      ctx.fillStyle = st.text
      ctx.fillText(text, cx, cy + fontSize * 0.05)
      ctx.shadowBlur = 0

      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('toBlob failed'))
        resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/png')
    })

  // Burn version of the promo tag: the same tight canvas placed onto a
  // transparent full-frame canvas at the dragged (clamped) position.
  const renderPromoTagPng = (vw: number, vh: number, pos: { x: number; y: number }): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const tag = drawPromoTag(vw, priceOld, priceNew, promoLayout, activePriceStyle, priceSize)
      if (!tag) return reject(new Error('no tag'))
      const frame = document.createElement('canvas')
      frame.width = vw
      frame.height = vh
      const ctx = frame.getContext('2d')
      if (!ctx) return reject(new Error('no canvas'))
      const cx = Math.max(tag.w / 2, Math.min(vw - tag.w / 2, (pos.x / 100) * vw))
      const cy = Math.max(tag.h / 2, Math.min(vh - tag.h / 2, (pos.y / 100) * vh))
      ctx.drawImage(tag.canvas, Math.round(cx - tag.w / 2), Math.round(cy - tag.h / 2))
      frame.toBlob(async (blob) => {
        if (!blob) return reject(new Error('toBlob failed'))
        resolve(new Uint8Array(await blob.arrayBuffer()))
      }, 'image/png')
    })

  // Draw the logo (background removed if enabled) at the chosen opacity onto
  // a small transparent canvas - baking opacity into the pixels keeps the
  // ffmpeg graph simple and fast.
  const renderLogoPng = (vw: number): Promise<{ png: Uint8Array; w: number; h: number }> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const w = Math.max(24, Math.round((logoSize / 100) * vw))
        const h = Math.round(w * (img.naturalHeight / img.naturalWidth))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas'))
        ctx.globalAlpha = logoOpacity / 100
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(async (blob) => {
          if (!blob) return reject(new Error('toBlob failed'))
          resolve({ png: new Uint8Array(await blob.arrayBuffer()), w, h })
        }, 'image/png')
      }
      img.onerror = () => reject(new Error('logo load failed'))
      img.src = effectiveLogoSrc
    })

  // BRAND: burn the title + price + logo onto the clean (un-branded) source.
  // Non-destructive: the first brand snapshots the clean source, and every
  // re-apply renders from that snapshot - so changing settings and applying
  // again EDITS the branding instead of stacking on top of it.
  const brandVideo = async () => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg) return
    const source: { data: Blob | File; name: string; wasOutput: boolean } | null = preBrand
      ? { data: preBrand.blob, name: preBrand.name, wasOutput: preBrand.wasOutput }
      : output
        ? { data: output.blob, name: output.name, wasOutput: true }
        : selectedClip
          ? { data: selectedClip.file, name: selectedClip.name, wasOutput: false }
          : null
    const wantsTitle = titleOn && titleText.trim() !== ''
    const wantsPrice = priceOn && priceText.trim() !== ''
    if (!source || (!wantsTitle && !wantsPrice && !logoOn)) return
    setBusy('brand')
    setProgress(0)
    setError('')
    try {
      const { fetchFile } = await import('@ffmpeg/util')
      // Probe actual dimensions of the source we are branding
      const probeUrl = URL.createObjectURL(source.data)
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => res({ w: v.videoWidth || 1080, h: v.videoHeight || 1920 })
        v.onerror = () => rej(new Error('probe failed'))
        v.src = probeUrl
      })
      URL.revokeObjectURL(probeUrl)

      await ffmpeg.writeFile('brand-in.mp4', await fetchFile(source.data))
      const inputs = ['-i', 'brand-in.mp4']
      const chains: string[] = []
      let last = '0:v'
      let idx = 1

      if (wantsTitle) {
        await ffmpeg.writeFile('title.png', await renderBannerPng(dims.w, dims.h, titleText, activeStyle, titleSize, titlePos))
        inputs.push('-i', 'title.png')
        chains.push(`[${last}][${idx}:v]overlay=0:0[v${idx}]`)
        last = `v${idx}`
        idx++
      }
      if (wantsPrice) {
        await ffmpeg.writeFile('price.png', await renderPromoTagPng(dims.w, dims.h, pricePos))
        inputs.push('-i', 'price.png')
        chains.push(`[${last}][${idx}:v]overlay=0:0[v${idx}]`)
        last = `v${idx}`
        idx++
      }
      if (logoOn) {
        const { png, w: lw, h: lh } = await renderLogoPng(dims.w)
        await ffmpeg.writeFile('logo.png', png)
        inputs.push('-i', 'logo.png')
        // Center the logo on the dragged position, clamped inside the frame
        // (computed here as plain numbers - commas inside overlay expressions
        // break ffmpeg's filter parser)
        const x = Math.round(Math.min(Math.max((logoXY.x / 100) * dims.w - lw / 2, 0), dims.w - lw))
        const y = Math.round(Math.min(Math.max((logoXY.y / 100) * dims.h - lh / 2, 0), dims.h - lh))
        chains.push(`[${last}][${idx}:v]overlay=${x}:${y}[v${idx}]`)
        last = `v${idx}`
        idx++
      }

      await ffmpeg.exec([
        ...inputs,
        '-filter_complex', chains.join(';'),
        '-map', `[${last}]`, '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy',
        'branded.mp4',
      ])
      const data = await ffmpeg.readFile('branded.mp4')
      const blob = new Blob([data], { type: 'video/mp4' })
      // Snapshot the clean source (first brand only) so branding stays editable
      if (!preBrand) {
        const cleanBlob = source.data instanceof Blob ? source.data : new Blob([source.data], { type: 'video/mp4' })
        setPreBrand({ url: URL.createObjectURL(cleanBlob), name: source.name, blob: cleanBlob, wasOutput: source.wasOutput })
      }
      setOutput({
        url: URL.createObjectURL(blob),
        name: `branded-${source.name.replace(/^(branded-|cut-)+/, '').replace(/\.[^.]+$/, '')}.mp4`,
        blob,
      })
    } catch (e) {
      setError('Branding failed. Try a shorter clip, or re-fetch the video and try again.')
    } finally {
      setBusy(null)
      setProgress(0)
    }
  }

  // Strip all branding: restore the clean pre-brand video
  const removeBranding = () => {
    if (!preBrand) return
    setOutput(preBrand.wasOutput ? { url: preBrand.url, name: preBrand.name, blob: preBrand.blob } : null)
    setPreBrand(null)
  }

  const brandSource = output ? 'the current result' : selectedClip ? 'the selected clip' : null

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Search product videos on TikTok ---- */}
      <VideoSearchPanel
        defaultQuery={productName}
        productImage={productImage}
        onUseClip={(file) => addFiles([file])}
      />

      {/* ---- Fetch from link ---- */}
      <section className="flex flex-col gap-2 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-sky-500" />
          Fetch a product video from a link
        </p>
        <p className="text-xs text-muted-foreground">
          Paste a TikTok or Facebook video link - the full HD, watermark-free video is downloaded and added to
          the feed automatically. No external website needed.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="https://www.tiktok.com/... or https://www.facebook.com/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && e.keyCode !== 229) {
                e.preventDefault()
                fetchFromLink()
              }
            }}
            disabled={fetching}
            className="flex-1"
          />
          <Button onClick={fetchFromLink} disabled={fetching || !link.trim()}>
            {fetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            {fetching ? 'Fetching\u2026' : 'Fetch video'}
          </Button>
        </div>
        {fetchInfo && <p className="text-xs text-sky-400">{fetchInfo}</p>}
        {fetchError && <p className="text-xs text-destructive">{fetchError}</p>}
      </section>

      {/* ---- Step 1: feed ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-500">1</span>
            Add clips to the feed
          </p>
          <div className="flex items-center gap-2">
            {!ffmpegReady && busy === 'load' && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading engine
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Add videos
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            addFiles(e.dataTransfer.files)
          }}
          className={`flex gap-3 overflow-x-auto rounded-lg border border-dashed p-3 ${
            clips.length === 0 ? 'min-h-28 items-center justify-center' : ''
          }`}
        >
          {clips.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Film className="h-4 w-4" /> Drag and drop videos here, or click Add videos
            </p>
          )}
          {clips.map((c, i) => (
            <div
              key={c.id}
              className={`group relative w-36 shrink-0 cursor-pointer overflow-hidden rounded-md border transition-shadow ${
                selected === c.id ? 'ring-2 ring-sky-500' : 'hover:ring-1 hover:ring-muted-foreground/30'
              }`}
              onClick={() => selectClip(c)}
            >
              <video src={c.url} className="h-20 w-36 bg-black object-cover" muted playsInline />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <span className="absolute bottom-7 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                {fmt(c.duration)}
              </span>
              <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                <span className="truncate text-[10px]">{c.name}</span>
              </div>
              <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                <Button variant="secondary" size="icon" className="h-6 w-6" title="Move earlier" onClick={(e) => { e.stopPropagation(); move(c.id, -1) }}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button variant="secondary" size="icon" className="h-6 w-6" title="Move later" onClick={(e) => { e.stopPropagation(); move(c.id, 1) }}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button variant="destructive" size="icon" className="h-6 w-6" title="Remove" onClick={(e) => { e.stopPropagation(); remove(c.id) }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Step 2: cut or merge ---- */}
      <section className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-500">2</span>
          Cut a scene or merge the feed
        </p>

        {selectedClip ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                <Scissors className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="truncate">{selectedClip.name}</span>
              </p>
              <Button
                size="sm"
                onClick={cutScene}
                disabled={!ffmpegReady || busy !== null || range[1] <= range[0]}
              >
                {busy === 'cut' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Scissors className="mr-1.5 h-3.5 w-3.5" />}
                {busy === 'cut' ? 'Cutting\u2026' : 'Cut this scene'}
              </Button>
            </div>
            <video ref={videoRef} src={selectedClip.url} controls className="max-h-56 w-full rounded-md bg-black" />
            <div className="px-1">
              <Slider
                min={0}
                max={Math.max(1, Math.floor(selectedClip.duration))}
                step={1}
                value={range}
                onValueChange={(v) => {
                  setRange([v[0], v[1]] as [number, number])
                  if (videoRef.current) videoRef.current.currentTime = v[0]
                }}
              />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>Start {fmt(range[0])}</span>
                <span className="font-medium text-foreground">Keep {fmt(Math.max(0, range[1] - range[0]))}</span>
                <span>End {fmt(range[1])}</span>
              </div>
            </div>
          </div>
        ) : (
          clips.length > 0 && (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              <Scissors className="mr-1.5 inline h-3.5 w-3.5" />
              Click a clip above to trim it.
            </p>
          )
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Merge className="h-3.5 w-3.5 text-emerald-500" /> Merge into one reel
            </p>
            <p className="text-xs text-muted-foreground">
              {clips.length < 2
                ? 'Add at least 2 clips - they merge in feed order into a 1080x1920 reel (30fps).'
                : `${clips.length} clips will merge in feed order into a 1080x1920 reel (30fps).`}
            </p>
          </div>
          <Button size="sm" onClick={mergeClips} disabled={!ffmpegReady || busy !== null || clips.length < 2}>
            {busy === 'merge' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-1.5 h-3.5 w-3.5" />}
            {busy === 'merge' ? 'Merging\u2026' : 'Merge'}
          </Button>
        </div>
      </section>

      {/* ---- Step 3: brand (title + logo) ---- */}
      <section className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-bold text-amber-500">3</span>
            Brand it: title + price + logo
          </p>
          <div className="flex items-center gap-2">
            {preBrand && (
              <Button size="sm" variant="outline" onClick={removeBranding} disabled={busy !== null} className="bg-transparent">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Remove branding
              </Button>
            )}
            <Button
              size="sm"
              onClick={brandVideo}
              disabled={
                !ffmpegReady ||
                busy !== null ||
                !brandSource ||
                (!(titleOn && titleText.trim()) && !(priceOn && priceText.trim()) && !logoOn)
              }
            >
              {busy === 'brand' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Stamp className="mr-1.5 h-3.5 w-3.5" />}
              {busy === 'brand' ? 'Branding\u2026' : preBrand ? 'Update branding' : 'Apply branding'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {preBrand
            ? 'Branding is editable: change anything below and hit Update branding to replace it, or remove it entirely.'
            : brandSource
              ? `Burns the title, price tag, and/or logo onto ${brandSource}.`
              : 'Select a clip (or cut/merge first) - then apply branding to the result.'}
        </p>

        {/* Style shuffle: rotate to a fresh look manually or every 5 minutes */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background/60 p-2.5">
          <Button type="button" variant="outline" size="sm" onClick={shuffleStyles} className="h-7 gap-1.5 bg-transparent text-xs">
            <RefreshCw className="h-3 w-3" />
            Shuffle style
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRestyle}
              onChange={(e) => setAutoRestyle(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            Auto-change style every 5 min
          </label>
        </div>

        {/* Title banner controls */}
        <div className="flex flex-col gap-2 rounded-md border bg-background/60 p-2.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={titleOn} onChange={(e) => setTitleOn(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
            <Type className="h-3.5 w-3.5 text-amber-500" />
            Product name title
          </label>
          {titleOn && (
            <div className="flex flex-col gap-2 pl-6">
              <Input value={titleText} onChange={(e) => setTitleText(e.target.value)} placeholder="Title shown on the video" className="h-8" />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Style</span>
                {TITLE_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setTitleStyle(s.id)}
                    className={`rounded-full px-3 py-1 text-xs font-extrabold transition-shadow ${
                      titleStyle === s.id ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-background' : 'opacity-80 hover:opacity-100'
                    } ${s.shape === 'bar' ? 'rounded-md' : ''}`}
                    style={{
                      background:
                        'bubble2' in s && s.bubble2
                          ? `linear-gradient(135deg, ${s.bubble}, ${s.bubble2})`
                          : (s.bubble ?? 'transparent'),
                      color: s.text,
                      WebkitTextStroke: s.stroke ? `${s.shape === 'none' ? 1 : 0.5}px ${s.stroke}` : undefined,
                      border: s.bubble ? 'none' : '1px dashed rgba(255,255,255,0.3)',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">Size: {titleSize.toFixed(1)}%</span>
                <Slider min={3} max={16} step={0.5} value={[titleSize]} onValueChange={(v) => setTitleSize(v[0])} className="flex-1" />
              </div>
            </div>
          )}
        </div>

        {/* Price tag controls */}
        <div className="flex flex-col gap-2 rounded-md border bg-background/60 p-2.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={priceOn} onChange={(e) => setPriceOn(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
            <Tag className="h-3.5 w-3.5 text-amber-500" />
            Promo price tag
          </label>
          {priceOn && (
            <div className="flex flex-col gap-2 pl-6">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={priceOld}
                  onChange={(e) => setPriceOld(e.target.value)}
                  placeholder="Old price e.g. Rs 1,375"
                  className="h-8 w-44"
                  aria-label="Old price"
                />
                <Input
                  value={priceNew}
                  onChange={(e) => setPriceNew(e.target.value)}
                  placeholder="New price e.g. Rs 999"
                  className="h-8 w-44"
                  aria-label="New price"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Layout</span>
                {PROMO_LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    title={l.hint}
                    onClick={() => setPromoLayout(l.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      promoLayout === l.id
                        ? 'border-amber-500 bg-amber-500/15 text-amber-400'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">Style</span>
                {TITLE_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPriceStyle(s.id)}
                    className={`rounded-full px-3 py-1 text-xs font-extrabold transition-shadow ${
                      priceStyle === s.id ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-background' : 'opacity-80 hover:opacity-100'
                    } ${s.shape === 'bar' ? 'rounded-md' : ''}`}
                    style={{
                      background:
                        'bubble2' in s && s.bubble2
                          ? `linear-gradient(135deg, ${s.bubble}, ${s.bubble2})`
                          : (s.bubble ?? 'transparent'),
                      color: s.text,
                      WebkitTextStroke: s.stroke ? `${s.shape === 'none' ? 1 : 0.5}px ${s.stroke}` : undefined,
                      border: s.bubble ? 'none' : '1px dashed rgba(255,255,255,0.3)',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">Size: {priceSize.toFixed(1)}%</span>
                <Slider min={3} max={16} step={0.5} value={[priceSize]} onValueChange={(v) => setPriceSize(v[0])} className="flex-1" />
              </div>
            </div>
          )}
        </div>

        {/* Logo controls */}
        <div className="flex flex-col gap-2 rounded-md border bg-background/60 p-2.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={logoOn} onChange={(e) => setLogoOn(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
            <ImageIcon className="h-3.5 w-3.5 text-amber-500" />
            Logo watermark
          </label>

          {/* Which page this logo belongs to. Each page remembers its own, so
              switching here swaps the watermark instead of re-uploading. */}
          {logoOn && brandPages.length > 0 && (
            <div className="flex flex-col gap-1.5 pl-6">
              <span className="text-xs text-muted-foreground">
                Saved for page
                {!pageLogos[brandPageId] && <span className="ml-1 opacity-70">(using shared logo)</span>}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {brandPages.map((p) => {
                  const active = p.id === brandPageId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectBrandPage(p.id)}
                      aria-pressed={active}
                      title={pageLogos[p.id] ? `${p.name} has its own saved logo` : `${p.name} uses the shared logo`}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                        active
                          ? 'border-amber-500 bg-amber-500/15 text-amber-500'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          pageLogos[p.id] ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                        }`}
                      />
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {logoOn && (
            <div className="flex flex-col gap-3 pl-6 sm:flex-row sm:items-start">
              <div className="flex flex-col items-center gap-1.5">
                <img
                  src={effectiveLogoSrc || '/placeholder.svg'}
                  alt="Logo preview"
                  className="h-16 w-16 rounded border object-contain"
                  style={{
                    opacity: logoOpacity / 100,
                    backgroundImage:
                      'linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%)',
                    backgroundSize: '12px 12px',
                    backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
                    backgroundColor: '#1a1a1a',
                  }}
                />
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] bg-transparent" onClick={() => logoInputRef.current?.click()}>
                  Change
                </Button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleLogoFile(f)
                    e.target.value = ''
                  }}
                />
                {logoSaving && (
                  <p className="text-center text-xs text-muted-foreground" aria-live="polite">
                    Saving for {brandPages.find((p) => p.id === brandPageId)?.name ?? 'all pages'}
                    {'\u2026'}
                  </p>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">Transparency: {logoOpacity}%</span>
                  <Slider min={5} max={100} step={1} value={[logoOpacity]} onValueChange={(v) => setLogoOpacity(v[0])} className="flex-1" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">Size: {logoSize}% width</span>
                  <Slider min={6} max={45} step={1} value={[logoSize]} onValueChange={(v) => setLogoSize(v[0])} className="flex-1" />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={logoRemoveBg}
                    onChange={(e) => setLogoRemoveBg(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-500"
                  />
                  <Eraser className="h-3.5 w-3.5 text-amber-500" />
                  Remove logo background (AI)
                </label>
                {logoRemoveBg && removingBg && (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    Cutting out the background with AI{'\u2026'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Drag-to-place preview: position the title, price, and logo anywhere */}
        {brandSource && (titleOn || priceOn || logoOn) && (
          <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Move className="h-3.5 w-3.5 text-amber-500" />
              Drag to place on the video
            </p>
            <div className="flex justify-center">
              <div
                ref={previewBoxRef}
                className="relative touch-none select-none overflow-hidden rounded-md bg-black"
                onPointerMove={onPreviewPointerMove}
                onPointerUp={endPreviewDrag}
                onPointerLeave={endPreviewDrag}
              >
                <video
                  src={preBrand?.url ?? output?.url ?? selectedClip?.url}
                  className="pointer-events-none max-h-80 w-auto"
                  muted
                  playsInline
                  preload="metadata"
                />
                {/* Alignment rulers: center guides shown while dragging.
                    They light up amber when the element is snapped on. */}
                {dragging && (
                  <>
                    <div
                      aria-hidden
                      className={`pointer-events-none absolute inset-y-0 left-1/2 w-px ${
                        guides.v ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]' : 'bg-white/40'
                      }`}
                      style={{ backgroundImage: guides.v ? undefined : 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.5) 0 6px, transparent 6px 12px)' }}
                    />
                    <div
                      aria-hidden
                      className={`pointer-events-none absolute inset-x-0 top-1/2 h-px ${
                        guides.h ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]' : 'bg-white/40'
                      }`}
                      style={{ backgroundImage: guides.h ? undefined : 'repeating-linear-gradient(to right, rgba(255,255,255,0.5) 0 6px, transparent 6px 12px)' }}
                    />
                  </>
                )}
                {titleOn &&
                  titleText.trim() &&
                  (() => {
                    const m = measureBanner(titleText.trim(), titleSize, previewW)
                    // Same clamping as the burn: the banner center cannot get
                    // closer to an edge than half the banner size
                    const ph = previewBoxRef.current?.clientHeight || previewW * (16 / 9)
                    const cx = previewW ? Math.max(m.bw / 2 / previewW, Math.min(1 - m.bw / 2 / previewW, titlePos.x / 100)) * 100 : titlePos.x
                    const cy = ph ? Math.max(m.bh / 2 / ph, Math.min(1 - m.bh / 2 / ph, titlePos.y / 100)) * 100 : titlePos.y
                    return (
                      <span
                        role="button"
                        aria-label="Drag to position the title"
                        onPointerDown={(e) => {
                          e.preventDefault()
                          ;(e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId)
                          dragTarget.current = 'title'
                          setDragging(true)
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-grab whitespace-nowrap active:cursor-grabbing ${
                          activeStyle.shape === 'bar' ? 'rounded-md' : 'rounded-full'
                        }`}
                        style={{
                          left: `${cx}%`,
                          top: `${cy}%`,
                          background:
                            'bubble2' in activeStyle && activeStyle.bubble2
                              ? `linear-gradient(135deg, ${activeStyle.bubble}, ${activeStyle.bubble2})`
                              : (activeStyle.bubble ?? 'transparent'),
                          color: activeStyle.text,
                          fontFamily: "'Arial Black', Arial, sans-serif",
                          fontWeight: 900,
                          lineHeight: 1,
                          WebkitTextStroke: activeStyle.stroke
                            ? `${Math.max(1, (m.fontSize * (activeStyle.shape === 'none' ? 0.16 : 0.08)) / 2)}px ${activeStyle.stroke}`
                            : undefined,
                          paintOrder: 'stroke fill',
                          textShadow:
                            'glow' in activeStyle && activeStyle.glow ? `0 0 ${m.fontSize * 0.35}px ${activeStyle.glow}` : undefined,
                          fontSize: m.fontSize,
                          padding: `${m.padY}px ${m.padX}px`,
                        }}
                      >
                        {titleText.trim()}
                      </span>
                    )
                  })()}
                {promoTag &&
                  (() => {
                    const ph = previewBoxRef.current?.clientHeight || previewW * (16 / 9)
                    const cx = previewW
                      ? Math.max(promoTag.w / 2 / previewW, Math.min(1 - promoTag.w / 2 / previewW, pricePos.x / 100)) * 100
                      : pricePos.x
                    const cy = ph
                      ? Math.max(promoTag.h / 2 / ph, Math.min(1 - promoTag.h / 2 / ph, pricePos.y / 100)) * 100
                      : pricePos.y
                    return (
                      <img
                        src={promoTag.url || '/placeholder.svg'}
                        alt="Drag to position the promo price tag"
                        role="button"
                        onPointerDown={(e) => {
                          e.preventDefault()
                          ;(e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId)
                          dragTarget.current = 'price'
                          setDragging(true)
                        }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab select-none active:cursor-grabbing"
                        style={{ left: `${cx}%`, top: `${cy}%`, width: promoTag.w, height: promoTag.h }}
                      />
                    )
                  })()}
                {logoOn && (
                  <img
                    src={effectiveLogoSrc || '/placeholder.svg'}
                    alt="Drag to position the logo"
                    role="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      ;(e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId)
                      dragTarget.current = 'logo'
                      setDragging(true)
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
                    style={{
                      left: `${logoXY.x}%`,
                      top: `${logoXY.y}%`,
                      width: `${logoSize}%`,
                      opacity: logoOpacity / 100,
                    }}
                    draggable={false}
                  />
                )}
              </div>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              The exact positions shown here are burned into the video.
            </p>
          </div>
        )}
      </section>

      {(busy === 'cut' || busy === 'merge' || busy === 'brand') && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Clapperboard className="h-4 w-4 shrink-0 animate-pulse text-sky-500" />
          <Progress value={progress} className="flex-1" />
          <span className="w-10 text-right text-sm tabular-nums">{progress}%</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ---- Result ---- */}
      {output && (
        <section className="overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 px-4 py-2.5">
            <span className="text-sm font-semibold">Result ready</span>
            <div className="flex items-center gap-2">
              {preBrand && (
                <Button size="sm" variant="outline" onClick={removeBranding} disabled={busy !== null} className="bg-transparent">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove branding
                </Button>
              )}
              <Button asChild size="sm" variant="outline" className="bg-transparent">
                <a href={output.url} download={output.name}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                </a>
              </Button>
              {!showAdPanel && (
                <Button size="sm" variant="outline" onClick={() => { setShowAdPanel(true); setShowPublish(false) }} disabled={busy !== null} className="bg-transparent">
                  <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Create ad
                </Button>
              )}
              {!showPublish && (
                <Button size="sm" onClick={() => { setShowPublish(true); setShowAdPanel(false) }} disabled={busy !== null}>
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Post it
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 p-3">
            {showPublish && (
              <ReelPublishPanel
                videoBlob={output.blob}
                productName={productName}
                priceText={priceOn ? priceText.trim() : ''}
                onClose={() => setShowPublish(false)}
                onBoost={onBoostPost}
              />
            )}
            {showAdPanel && (
              <ReelAdPanel
                videoBlob={output.blob}
                productName={productName}
                priceText={priceOn ? priceText.trim() : ''}
                onClose={() => setShowAdPanel(false)}
              />
            )}
            <video src={output.url} controls className="mx-auto max-h-72 rounded-md bg-black" />
            {preBrand && (
              <p className="text-center text-[11px] text-muted-foreground">
                Branding is not locked in - tweak the title, price, or logo above and hit Update branding, or remove it.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
