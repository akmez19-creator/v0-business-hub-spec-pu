'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Download, ImageIcon, Loader2, Plus, Sparkles, Upload, X } from 'lucide-react'
import { MarketplaceSearchPanel } from '@/components/product-master/marketplace-search-panel'

type ModelInfo = { id: string; label: string; note: string; provider?: 'gateway' | 'google' }

const inlineUrl = (src: string) => `/api/product-master/video-fetch?inline=1&src=${encodeURIComponent(src)}`

/** Strip characters Windows and macOS reject in filenames. */
const sanitizeName = (s: string) =>
  s
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const money = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : ''
}

export function PosterStudioTab({
  productName,
  productImage,
  productPrice,
  productPromoPrice,
}: {
  productName: string
  productImage?: string | null
  productPrice?: number | string | null
  productPromoPrice?: number | string | null
}) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('')

  // Source photo. `sourceImage` is what gets sent; `sourceLabel` explains where
  // it came from so it is never a mystery which photo is being used.
  const [sourceImage, setSourceImage] = useState<string | null>(productImage ?? null)
  const [sourceLabel, setSourceLabel] = useState(productImage ? 'Product photo' : '')

  const [headline, setHeadline] = useState('BIG PROMO!')
  const [name, setName] = useState(productName)
  const [priceNow, setPriceNow] = useState(money(productPromoPrice))
  const [priceWas, setPriceWas] = useState(money(productPrice))
  const [features, setFeatures] = useState<string[]>([''])
  const [badges, setBadges] = useState<string[]>(['FREE DELIVERY ANYWHERE IN MAURITIUS'])
  const [extra, setExtra] = useState('')

  // Packed is the default because a sparse hero shot was the main complaint -
  // the dense sales-sheet layout is what actually converts
  const [layout, setLayout] = useState<'packed' | 'hero'>('packed')
  const [tagline, setTagline] = useState('')
  const [cta, setCta] = useState('ORDER NOW!')
  const [urgency, setUrgency] = useState("DON'T MISS OUT! STOCK IS LIMITED")
  const [lifestyleShots, setLifestyleShots] = useState(true)

  // The two price fields are easy to fill the wrong way round. A struck-out
  // "was" price lower than the asking price would produce a nonsensical
  // poster, so warn here rather than silently printing it.
  const nowNum = Number(priceNow.replace(/[^\d.]/g, ''))
  const wasNum = Number(priceWas.replace(/[^\d.]/g, ''))
  const pricesInverted = nowNum > 0 && wasNum > 0 && wasNum <= nowNum
  const savings = nowNum > 0 && wasNum > nowNum ? Math.round(wasNum - nowNum) : null

  // Preview loading strategy. Product photos live on our own Supabase storage
  // and load fine directly, but that host is not on the media proxy's
  // allowlist - routing them through it returns 403 and shows a broken image.
  // Marketplace CDNs are the opposite: they often refuse hotlinking and need
  // the proxy. So try direct first and fall back to the proxy on error, which
  // works for both without hardcoding which hosts are which.
  const [proxyPreview, setProxyPreview] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [poster, setPoster] = useState<string | null>(null)
  const [posterModel, setPosterModel] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/product-master/poster-generate')
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.success) return
        setModels(j.models || [])
        setModel((m) => m || j.defaultModel)
      })
      .catch(() => setError('Could not load the model list'))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setName(productName)
    setSourceImage(productImage ?? null)
    setSourceLabel(productImage ? 'Product photo' : '')
  }, [productName, productImage])

  // A new photo deserves a fresh direct attempt - otherwise one proxied
  // marketplace image would force every later photo through the proxy too.
  useEffect(() => {
    setProxyPreview(false)
  }, [sourceImage])

  const onUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      setSourceImage(String(reader.result))
      setSourceLabel(`Uploaded: ${file.name}`)
    }
    reader.readAsDataURL(file)
  }

  const generate = useCallback(async () => {
    if (!sourceImage || busy) return
    setBusy(true)
    setError('')
    setWarnings([])
    try {
      const res = await fetch('/api/product-master/poster-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          sourceImage,
          productName: name,
          headline,
          priceNow,
          priceWas,
          currency: 'Rs',
          features: features.filter((f) => f.trim()),
          badges: badges.filter((b) => b.trim()),
          extra,
          layout,
          tagline,
          cta,
          urgency,
          lifestyleShots,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Generation failed')
      setPoster(json.image)
      setPosterModel(json.modelLabel || '')
      setWarnings(json.warnings || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }, [
    badges,
    busy,
    cta,
    extra,
    features,
    headline,
    layout,
    lifestyleShots,
    model,
    name,
    priceNow,
    priceWas,
    sourceImage,
    tagline,
    urgency,
  ])

  const download = () => {
    if (!poster) return
    const a = document.createElement('a')
    a.href = poster
    a.download = `${sanitizeName(name) || 'Poster'} poster.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const setAt = (list: string[], i: number, v: string) => list.map((x, n) => (n === i ? v : x))

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Send a product photo to an AI model and get a finished promo poster back, text and all. Pick a photo
        from your product, upload one, or pull one from a marketplace listing below.
      </p>

      {/* ---- Source photo ---- */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product photo</h4>
        <div className="flex flex-wrap items-start gap-3">
          <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
            {sourceImage ? (
              <img
                src={
                  sourceImage.startsWith('data:')
                    ? sourceImage
                    : proxyPreview
                      ? inlineUrl(sourceImage)
                      : sourceImage
                }
                alt="Poster source"
                className="h-full w-full object-cover"
                onError={() => {
                  if (!proxyPreview && !sourceImage.startsWith('data:')) setProxyPreview(true)
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{sourceLabel || 'No photo selected yet'}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
                e.target.value = ''
              }}
            />
            <Button variant="outline" size="sm" className="h-7 w-fit px-2.5 text-[11px]" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1.5 h-3 w-3" />
              Upload a photo
            </Button>
          </div>
        </div>
      </section>

      {/* ---- Model ---- */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI model</h4>

        {/* Split by billing account. When one balance runs out the other still
            works, so which pool a model draws from is the useful distinction
            to surface - not a cosmetic grouping. */}
        {(
          [
            { key: 'google', title: 'Google Gemini', hint: 'billed to your Google API key' },
            { key: 'gateway', title: 'Vercel AI Gateway', hint: 'billed to Gateway credit' },
          ] as const
        ).map((group) => {
          const inGroup = models.filter((m) => (m.provider ?? 'gateway') === group.key)
          if (!inGroup.length) return null
          return (
            <div key={group.key} className="flex flex-col gap-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {group.title} <span className="normal-case opacity-70">({group.hint})</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {inGroup.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    title={m.note}
                    aria-pressed={model === m.id}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      model === m.id
                        ? 'bg-amber-500 text-black'
                        : 'border border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}

        {models.find((m) => m.id === model) && (
          <p className="text-[11px] text-muted-foreground">{models.find((m) => m.id === model)?.note}</p>
        )}
      </section>

      {/* ---- Layout ---- */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layout</h4>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: 'packed', label: 'Packed sales sheet', hint: 'Price block, feature rows, photo strip and order button. Busy, like a printed promo leaflet.' },
              { key: 'hero', label: 'Simple hero', hint: 'One big product shot with a headline and price. Much less text.' },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setLayout(o.key)}
              title={o.hint}
              aria-pressed={layout === o.key}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                layout === o.key
                  ? 'bg-amber-500 text-black'
                  : 'border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {layout === 'packed' && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={lifestyleShots}
              onChange={(e) => setLifestyleShots(e.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            Add a row of in-use photos along the bottom
          </label>
        )}
      </section>

      {/* ---- Poster text ---- */}
      <section className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Poster text</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Headline</span>
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="BIG PROMO!" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Product name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Now price (Rs)</span>
            <Input value={priceNow} onChange={(e) => setPriceNow(e.target.value)} inputMode="numeric" placeholder="1299" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Was price (Rs)</span>
            <Input value={priceWas} onChange={(e) => setPriceWas(e.target.value)} inputMode="numeric" placeholder="1875" />
          </label>
        </div>

        {/* Catch swapped prices before they reach the model, since a crossed-out
            price below the asking price makes the poster look like a mistake */}
        {pricesInverted && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
            <p className="text-[11px] text-amber-300">
              The was price (Rs {wasNum}) is not higher than the now price (Rs {nowNum}), so no discount will be
              shown. Did you mean to swap them?
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setPriceNow(priceWas)
                setPriceWas(priceNow)
              }}
            >
              Swap
            </Button>
          </div>
        )}
        {savings !== null && (
          <p className="text-[11px] text-muted-foreground">
            Poster will show <span className="font-semibold text-foreground">YOU SAVE Rs {savings}</span>
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Tagline (optional)</span>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Your ideal partner for health" />
          </label>
          {layout === 'packed' && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Button text</span>
              <Input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="ORDER NOW!" />
            </label>
          )}
        </div>

        {layout === 'packed' && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Bottom urgency line</span>
            <Input value={urgency} onChange={(e) => setUrgency(e.target.value)} placeholder="DON'T MISS OUT! STOCK IS LIMITED" />
          </label>
        )}

        {/* Features */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">Feature bullets</span>
          {features.map((f, i) => (
            <div key={i} className="flex gap-1.5">
              <Input
                value={f}
                onChange={(e) => setFeatures((l) => setAt(l, i, e.target.value))}
                placeholder="e.g. Relieves neck pain & stiffness"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 shrink-0 p-0"
                aria-label="Remove feature"
                onClick={() => setFeatures((l) => (l.length === 1 ? [''] : l.filter((_, n) => n !== i)))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-7 w-fit px-2.5 text-[11px]" onClick={() => setFeatures((l) => [...l, ''])}>
            <Plus className="mr-1 h-3 w-3" />
            Add feature
          </Button>
        </div>

        {/* Badges */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted-foreground">Corner badges</span>
          {badges.map((b, i) => (
            <div key={i} className="flex gap-1.5">
              <Input
                value={b}
                onChange={(e) => setBadges((l) => setAt(l, i, e.target.value))}
                placeholder="e.g. FREE DELIVERY ANYWHERE IN MAURITIUS"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 shrink-0 p-0"
                aria-label="Remove badge"
                onClick={() => setBadges((l) => (l.length === 1 ? [''] : l.filter((_, n) => n !== i)))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-7 w-fit px-2.5 text-[11px]" onClick={() => setBadges((l) => [...l, ''])}>
            <Plus className="mr-1 h-3 w-3" />
            Add badge
          </Button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Anything else (optional)</span>
          <Textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            placeholder="e.g. add a 2 year warranty seal, use a blue colour scheme"
          />
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={busy || !sourceImage || !model}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {busy ? 'Generating' : 'Generate poster'}
        </Button>
        {!sourceImage && <span className="text-[11px] text-muted-foreground">Pick a product photo first</span>}
        {busy && <span className="text-[11px] text-muted-foreground">This usually takes 20-60 seconds</span>}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {warnings.length > 0 && (
        <p className="text-xs text-amber-400">{warnings.join(' \u2014 ')}</p>
      )}

      {poster && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Result {posterModel && <span className="font-normal normal-case">via {posterModel}</span>}
            </h4>
            <Button size="sm" className="h-7 px-2.5 text-[11px]" onClick={download}>
              <Download className="mr-1.5 h-3 w-3" />
              Download
            </Button>
          </div>
          {/* AI text can misspell, so the poster is shown large enough to
              actually proofread before it goes out */}
          <p className="text-[11px] text-amber-400">
            Check every price and word before posting {'\u2014'} AI can misspell text.
          </p>
          <img src={poster || '/placeholder.svg'} alt={`Generated poster for ${name}`} className="w-full rounded-lg border border-border" />
        </section>
      )}

      {/* Marketplace listings double as a photo source for the poster */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Find a photo from marketplace listings
        </h4>
        <MarketplaceSearchPanel
          defaultQuery={productName}
          productImage={productImage}
          onMakePoster={({ image, title }) => {
            setSourceImage(image)
            setSourceLabel(`From listing: ${title.slice(0, 50)}`)
            // Jump back to the top controls so the newly chosen photo is
            // visible rather than leaving the user scrolled in the results
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      </section>
    </div>
  )
}
