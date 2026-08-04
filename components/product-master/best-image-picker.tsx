'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, Crown, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Feature 7: score every candidate product photo and surface the best one.
 *
 * The five axes are deliberately e-commerce specific rather than generic
 * "quality": a technically sharp photo covered in Chinese packaging text is a
 * bad product photo, and textFree catches exactly that.
 */

type Scores = {
  clarity: number
  productFocus: number
  background: number
  lighting: number
  textFree: number
}

type Result = {
  imageUrl: string
  scores: Scores | null
  total: number
  reason: string
  label: string
  cached: boolean
  error?: string
}

const AXES: Array<{ key: keyof Scores; label: string }> = [
  { key: 'clarity', label: 'Sharp' },
  { key: 'productFocus', label: 'Fills frame' },
  { key: 'background', label: 'Clean bg' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'textFree', label: 'No text' },
]

export function BestImagePicker({
  productId,
  images,
  selected,
  onSelect,
}: {
  productId?: string | null
  images: string[]
  selected?: string | null
  onSelect?: (url: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[]>([])

  const run = useCallback(
    async (force = false) => {
      if (busy || images.length === 0) return
      setBusy(true)
      setError('')
      try {
        const res = await fetch('/api/product-master/rank-images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: productId ?? null, images, force }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Ranking failed')
        setResults(json.results ?? [])
        // Auto-apply the winner so the common case needs no second click
        if (json.best?.imageUrl && onSelect) onSelect(json.best.imageUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ranking failed')
      } finally {
        setBusy(false)
      }
    },
    [busy, images, onSelect, productId],
  )

  if (images.length === 0) return null

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            Pick the best product photo
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Every photo is judged on sharpness, framing, background, lighting and whether it carries foreign
            packaging text.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => void run(false)} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? 'Scoring\u2026' : `Score ${images.length}`}
          </Button>
          {results.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void run(true)} disabled={busy}>
              Rescore
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {results.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((r, i) => {
            const isBest = i === 0 && r.total >= 0
            const isSelected = selected === r.imageUrl
            return (
              <li key={r.imageUrl}>
                <button
                  type="button"
                  onClick={() => onSelect?.(r.imageUrl)}
                  className={`flex w-full flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-border hover:border-emerald-500/50'
                  }`}
                >
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.imageUrl}
                      alt={`Candidate ${i + 1}`}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                    {isBest && (
                      <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-emerald-950">
                        <Crown className="h-3 w-3" />
                        BEST
                      </span>
                    )}
                  </div>

                  {r.error ? (
                    <p className="text-[11px] text-muted-foreground">{r.error}</p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold">{r.total}/50</span>
                        <span className="text-[10px] text-muted-foreground">{r.label}</span>
                      </div>
                      {r.scores && (
                        <ul className="flex flex-col gap-0.5">
                          {AXES.map((a) => {
                            const v = r.scores?.[a.key] ?? 0
                            return (
                              <li key={a.key} className="flex items-center gap-1.5">
                                <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
                                  {a.label}
                                </span>
                                <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                  <span
                                    className={`block h-full rounded-full ${
                                      v >= 7 ? 'bg-emerald-500' : v >= 4 ? 'bg-amber-500' : 'bg-destructive'
                                    }`}
                                    style={{ width: `${v * 10}%` }}
                                  />
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {r.reason && (
                        <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{r.reason}</p>
                      )}
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
