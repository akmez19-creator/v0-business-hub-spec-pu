'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { createCapture, confirmCaptureMatch, discardCapture } from '@/lib/stock-count-actions'
import type { MatchCandidate } from '@/lib/types'

interface SearchableProduct {
  id: string
  name: string
  category: string | null
  image_url: string | null
  shelf_code: string | null
}

type Phase = 'capture' | 'details' | 'choose'

/** Confidence bands, so the agent reads a word rather than decoding a decimal. */
function confidenceLabel(c: number): { text: string; className: string } {
  if (c >= 0.85) return { text: 'Strong match', className: 'text-emerald-400' }
  if (c >= 0.6) return { text: 'Likely', className: 'text-amber-400' }
  return { text: 'Weak - check carefully', className: 'text-muted-foreground' }
}

export function PhotoCountSheet({
  countId,
  products,
  onCounted,
  onClose,
}: {
  countId: string | null
  products: SearchableProduct[]
  onCounted: () => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('capture')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [qtyInput, setQtyInput] = useState('')
  const [shelfInput, setShelfInput] = useState('')

  // Analysis runs while the agent types, so its state is tracked separately from
  // whatever they are doing on screen.
  const [analysing, setAnalysing] = useState(false)
  const [aiLabel, setAiLabel] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<MatchCandidate[]>([])
  const [aiFailed, setAiFailed] = useState(false)

  const [captureId, setCaptureId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualSearch, setManualSearch] = useState('')
  const [showManual, setShowManual] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (phase === 'details') qtyRef.current?.focus()
  }, [phase])

  // Revoke the object URL rather than leaking one blob per photo across a shift.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  const manualResults = useMemo(() => {
    const q = manualSearch.trim().toLowerCase()
    if (!q) return []
    return products
      .filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q),
      )
      .slice(0, 20)
  }, [products, manualSearch])

  /**
   * True when the top two suggestions are too close to separate by score. Both
   * must have been judged on their photos - two weak text-only guesses being
   * near each other is just noise, not a genuine lookalike pair.
   */
  const lookalike = useMemo(() => {
    const [first, second] = candidates
    if (!first || !second) return false
    if (!first.visually_compared || !second.visually_compared) return false
    return first.confidence - second.confidence < 0.15
  }, [candidates])

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    // Shown immediately from the local file: the agent should see their shot
    // straight away rather than waiting on a round trip.
    const preview = URL.createObjectURL(file)
    setLocalPreview(preview)
    setPhase('details')

    try {
      const body = new FormData()
      body.append('file', file)
      body.append('folder', 'stock-count')
      const res = await fetch('/api/upload', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload failed')

      setPhotoUrl(json.url)
      setUploading(false)

      // Fire the match off now and let it run behind the quantity entry - this
      // is what keeps the AI wait off the agent's clock.
      void analyse(json.url)
    } catch (e) {
      setUploading(false)
      setError((e as Error).message || 'Could not upload the photo')
      setPhase('capture')
    }
  }

  async function analyse(url: string) {
    setAnalysing(true)
    setAiFailed(false)
    try {
      const res = await fetch('/api/stock-count/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: url }),
      })
      const json = await res.json()
      setCandidates(Array.isArray(json.candidates) ? json.candidates : [])
      setAiLabel(json.label ?? null)
      if (json.error) setAiFailed(true)
    } catch {
      // A failed match must never block the count - the agent can still pick
      // the product by hand, and the photo and quantity are already safe.
      setAiFailed(true)
      setCandidates([])
    } finally {
      setAnalysing(false)
    }
  }

  /** Save the photo + quantity, then move on to confirming which product it is. */
  async function handleSaveDetails() {
    if (!countId) {
      setError('No active count session')
      return
    }
    const qty = Number(qtyInput)
    if (qtyInput.trim() === '' || !Number.isInteger(qty) || qty < 0) {
      setError('Enter a whole number of 0 or more')
      return
    }
    if (!photoUrl) {
      setError(uploading ? 'Still uploading the photo - one moment' : 'Photo missing')
      return
    }

    setSaving(true)
    setError(null)
    const result = await createCapture({
      countId,
      photoUrl,
      countedQty: qty,
      shelfCode: shelfInput || null,
      aiLabel,
      aiCandidates: candidates.length ? candidates : null,
      // Still running: leave it as 'analysing' so it is visibly unfinished
      // rather than looking like "nothing found".
      aiStatus: analysing ? 'analysing' : candidates.length ? 'suggested' : 'unmatched',
    })
    setSaving(false)

    if (!result.ok || !result.data) {
      setError(result.ok ? 'Could not save this photo count' : result.error)
      return
    }
    setCaptureId(result.data.id)
    setPhase('choose')
  }

  async function handleConfirm(productId: string) {
    if (!captureId) return
    setSaving(true)
    setError(null)
    const result = await confirmCaptureMatch({ captureId, productId })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCounted()
    reset()
  }

  /** Leave it for an admin - better than forcing a guess at the shelf. */
  async function handleLeaveForAdmin() {
    onCounted()
    reset()
  }

  async function handleDiscard() {
    if (captureId) {
      setSaving(true)
      await discardCapture(captureId)
      setSaving(false)
    }
    reset()
  }

  function reset() {
    if (localPreview) URL.revokeObjectURL(localPreview)
    setPhase('capture')
    setPhotoUrl(null)
    setLocalPreview(null)
    setQtyInput('')
    setCandidates([])
    setAiLabel(null)
    setAiFailed(false)
    setCaptureId(null)
    setError(null)
    setManualSearch('')
    setShowManual(false)
    // shelfInput is deliberately kept: the next photo is usually the same shelf.
  }

  const preview = localPreview || photoUrl

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Camera className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Count by photo</h2>
          <p className="text-[11px] text-muted-foreground">
            {phase === 'capture' && 'Photograph the item on the shelf'}
            {phase === 'details' && 'Enter the quantity while we identify it'}
            {phase === 'choose' && 'Confirm which product this is'}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* ---------------------------------------------------- capture */}
        {phase === 'capture' && (
          <div className="flex flex-col items-center gap-6 py-10 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted">
              <Camera className="h-10 w-10 text-muted-foreground" />
            </div>
            <div className="max-w-xs">
              <p className="text-sm font-medium text-foreground">
                Take a photo of the item
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Get the label and packaging text in frame - that is what identifies
                it most reliably.
              </p>
            </div>
            <Button onClick={() => fileRef.current?.click()} className="gap-2">
              <Camera className="h-4 w-4" /> Open camera
            </Button>
            {error && <p className="text-[12px] text-rose-400">{error}</p>}
          </div>
        )}

        {/* ---------------------------------------------------- details */}
        {phase === 'details' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              {preview && (
                <ImageLightbox
                  src={preview}
                  alt="The item you photographed"
                  caption="Your photo"
                  className="h-20 w-20 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                {uploading && (
                  <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Uploading photo…
                  </p>
                )}
                {!uploading && analysing && (
                  <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Sparkles className="h-3 w-3 animate-pulse text-primary" />
                    Identifying in the background…
                  </p>
                )}
                {!uploading && !analysing && aiLabel && (
                  <p className="text-[12px] text-muted-foreground">
                    Looks like <span className="text-foreground">{aiLabel}</span>
                  </p>
                )}
                {!uploading && !analysing && aiFailed && (
                  <p className="text-[12px] text-amber-400">
                    Could not identify it - you can still pick it by hand
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 gap-1 px-2 text-[11px]"
                  onClick={() => fileRef.current?.click()}
                >
                  <RefreshCw className="h-3 w-3" /> Retake
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="photo-qty" className="text-[12px] font-medium text-foreground">
                Quantity on shelf
              </label>
              <Input
                id="photo-qty"
                ref={qtyRef}
                type="number"
                inputMode="numeric"
                min={0}
                value={qtyInput}
                onChange={e => setQtyInput(e.target.value)}
                onKeyDown={e => {
                  // Guard against CJK IME composition confirming with Enter.
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault()
                    void handleSaveDetails()
                  }
                }}
                placeholder="0"
                className="text-lg"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="photo-shelf" className="text-[12px] font-medium text-foreground">
                Shelf <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="photo-shelf"
                value={shelfInput}
                onChange={e => setShelfInput(e.target.value.toUpperCase())}
                placeholder="E2"
                className="font-mono uppercase"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                {shelfInput.trim()
                  ? `Zone ${shelfInput.trim().charAt(0).toUpperCase()}`
                  : 'Kept for the next photo, so a whole shelf is typed once'}
              </p>
            </div>

            {error && <p className="text-[12px] text-rose-400">{error}</p>}

            <Button onClick={handleSaveDetails} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save and identify
            </Button>
          </div>
        )}

        {/* ---------------------------------------------------- choose */}
        {phase === 'choose' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              {preview && (
                <ImageLightbox
                  src={preview}
                  alt="The item you photographed"
                  caption="Your photo"
                  className="h-14 w-14 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  Qty {qtyInput}
                  {shelfInput ? ` · shelf ${shelfInput}` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Saved. Now confirm the product.
                </p>
              </div>
            </div>

            {analysing && (
              <p className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Still identifying…
              </p>
            )}

            {!analysing && candidates.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Best matches
                </p>

                {/*
                  Real finding from testing: a bulb-style IP camera and a
                  separate "Bulb Camera" product scored within a whisker of each
                  other. When two products are that close the score cannot break
                  the tie - only a person looking at both can - so say so
                  instead of letting the ordering imply a winner.
                */}
                {lookalike && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-amber-400">
                        Two similar products.
                      </span>{' '}
                      Compare both photos before choosing - tap an image to
                      enlarge it.
                    </p>
                  </div>
                )}
                {candidates.map(c => {
                  const band = confidenceLabel(c.confidence)
                  return (
                    <div
                      key={c.product_id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-card p-2"
                    >
                      <ImageLightbox
                        src={c.image_url}
                        alt={c.name}
                        caption={c.name}
                        className="h-12 w-12 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {c.name}
                        </p>
                        <p className={`text-[11px] font-medium ${band.className}`}>
                          {band.text}
                          {!c.visually_compared && ' · name only'}
                        </p>
                        {/* The reason is the checkable part - a bare score is not. */}
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                          {c.reason}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={() => handleConfirm(c.product_id)}
                        className="shrink-0 gap-1"
                      >
                        <Check className="h-3 w-3" /> This one
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            {!analysing && candidates.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-[12px] font-medium text-amber-400">
                    No confident match
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    Nothing in the catalogue clearly matches this photo. Search for
                    it by hand, or leave it for an admin to resolve - your count is
                    already saved either way.
                  </p>
                </div>
              </div>
            )}

            {/* Manual fallback - always available, not just on failure. */}
            {!showManual ? (
              <Button
                variant="outline"
                onClick={() => setShowManual(true)}
                className="gap-2"
              >
                <Search className="h-4 w-4" /> Search for it by name
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  value={manualSearch}
                  onChange={e => setManualSearch(e.target.value)}
                  placeholder="Search products…"
                  autoFocus
                />
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {manualResults.map(p => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                    >
                      <ImageLightbox
                        src={p.image_url}
                        alt={p.name}
                        caption={p.name}
                        className="h-10 w-10"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{p.name}</p>
                        {p.shelf_code && (
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {p.shelf_code}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={saving}
                        onClick={() => handleConfirm(p.id)}
                      >
                        Pick
                      </Button>
                    </li>
                  ))}
                  {manualSearch.trim() && manualResults.length === 0 && (
                    <li className="px-2 py-3 text-[12px] text-muted-foreground">
                      Nothing matches that name.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {error && <p className="text-[12px] text-rose-400">{error}</p>}

            <div className="flex gap-2 border-t border-border pt-3">
              <Button
                variant="outline"
                onClick={handleLeaveForAdmin}
                disabled={saving}
                className="flex-1"
              >
                Leave for admin
              </Button>
              <Button
                variant="ghost"
                onClick={handleDiscard}
                disabled={saving}
                className="text-muted-foreground"
              >
                Discard
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* `capture` opens the rear camera on a phone but still allows a file pick
          on desktop, so this works at a desk as well as in the aisle. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          // Reset so retaking the same file still fires a change event.
          e.target.value = ''
          if (file) void handleFile(file)
        }}
      />
    </div>
  )
}
