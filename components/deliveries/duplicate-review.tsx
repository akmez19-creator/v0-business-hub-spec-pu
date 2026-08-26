'use client'

// One-product-at-a-time duplicate review over the whole catalogue.
//
// The design rule throughout: this screen never decides anything and never
// hides a candidate. The database search is tuned so the true duplicate is
// always somewhere in the list, and the AI only reorders it. Everything the
// search found stays on screen, because the reviewer is the accuracy
// mechanism - if the interface filters on their behalf, the guarantee is gone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
// Supplier CDNs (alicdn and friends) answer 403 to a browser on our page, so
// every photo here goes through the existing authenticated media proxy.
import { mediaSrc } from '@/lib/media-url'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react'

type QueueItem = {
  id: string
  name: string
  topScore: number
  status: 'clear' | 'merged' | 'skip' | null
  quantity: number | null
  zone: string | null
  shelfCode: string | null
  imageUrl: string | null
}

type Side = {
  id: string
  name: string
  zone: string | null
  shelf_code: string | null
  quantity: number | null
  sku: string | null
  last_counted_at: string | null
  po_count: number
  image_count: number
  image_url: string | null
  score: number
  reasons: string[]
}

type Verdict = { verdict: 'same' | 'unsure' | 'different'; confidence: number; reason: string } | null

/** "1 photos" reads like a bug and quietly costs the screen credibility. */
function count(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** How many candidates are shown before the rest go behind "show the other N". */
const VISIBLE = 5

/** Products prepared per batch, so a run has a definite end the reviewer chose. */
const BATCH_SIZE = 20

/**
 * A product photo, or an honest gap where one should be.
 *
 * Plain <img> rather than next/image: these come from three different hosts
 * (a supplier CDN, Supabase and Blob) and the project already runs with image
 * optimisation off, so next/image would add host configuration and no benefit.
 *
 * A missing photo says so instead of rendering an empty grey square - "no
 * photo on this product" is a fact the reviewer needs, because it tells them
 * why they are being asked to judge on the name alone.
 */
function Thumb({
  url,
  alt,
  className = 'w-24 h-24',
  onZoom,
}: {
  url: string | null
  alt: string
  className?: string
  onZoom?: (url: string) => void
}) {
  if (!url) {
    return (
      <div
        className={`${className} shrink-0 rounded-md border border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-1 text-muted-foreground`}
      >
        <ImageOff className="w-4 h-4" aria-hidden="true" />
        <span className="text-[10px] leading-none">No photo</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onZoom?.(url)}
      className={`${className} shrink-0 rounded-md border border-border overflow-hidden bg-muted/30 hover:border-foreground/40 transition-colors`}
      aria-label={`Enlarge photo of ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mediaSrc(url) || '/placeholder.svg'}
        alt={alt}
        loading="lazy"
        className="w-full h-full object-cover"
      />
    </button>
  )
}

export function DuplicateReview() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const [target, setTarget] = useState<Side | null>(null)
  const [candidates, setCandidates] = useState<Side[]>([])
  const [verdicts, setVerdicts] = useState<Verdict[]>([])
  const [aiError, setAiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [merging, setMerging] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, QueueItem['status']>>({})
  const [nameChoice, setNameChoice] = useState<string | null>(null)
  const [forceMerge, setForceMerge] = useState<Record<string, true>>({})
  const [flash, setFlash] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [lookedAtPhotos, setLookedAtPhotos] = useState(false)
  const [batch, setBatch] = useState<{
    running: boolean
    doneInBatch: number
    target: number
    prepared: number
    total: number
    note: string | null
  }>({ running: false, doneInBatch: 0, target: 0, prepared: 0, total: 0, note: null })

  const current = queue?.[cursor] ?? null

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/products/review/queue')
        if (res.status === 401) throw new Error('Your session expired. Sign in again to carry on.')
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'The review queue could not be loaded.')
        setQueue(json.queue)
        const seen: Record<string, QueueItem['status']> = {}
        for (const q of json.queue as QueueItem[]) if (q.status) seen[q.id] = q.status
        setDone(seen)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [])

  const load = useCallback(async (productId: string) => {
    setLoading(true)
    setError(null)
    setAiError(null)
    setExpanded(false)
    setNameChoice(null)
    // Per-product decisions must not survive the move to the next product.
    setForceMerge({})
    setTarget(null)
    setCandidates([])
    setVerdicts([])
    setLookedAtPhotos(false)
    try {
      const res = await fetch(`/api/products/review/${productId}`)
      if (res.status === 401) throw new Error('Your session expired. Sign in again to carry on.')
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'The candidate search failed.')
      setTarget(json.target)
      setCandidates(json.candidates)
      setVerdicts(json.verdicts || [])
      setAiError(json.aiError ?? null)
      setLookedAtPhotos(Boolean(json.lookedAtPhotos))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (current) load(current.id)
  }, [current, load])

  // Escape closes the enlarged photo. Without it the overlay covers the whole
  // screen and the only way out is finding the button.
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  // Standing count of how much is already prepared, so the button can say what
  // it will actually do rather than making the reviewer guess.
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/products/review/prepare')
        const json = await res.json()
        if (json.success) {
          setBatch(b => ({ ...b, prepared: json.prepared, total: json.total }))
        }
      } catch {
        // A missing count is cosmetic; the page works without it.
      }
    })()
  }, [])

  /**
   * Prepare the next BATCH_SIZE products ahead of the reviewer.
   *
   * Loops small server chunks instead of asking for all 20 at once, because a
   * single request cannot outlive the platform's 60s cap and a 20-product run
   * takes minutes. Each chunk commits on the server, so stopping half way
   * keeps everything already done.
   */
  const runBatch = useCallback(async () => {
    setBatch(b => ({ ...b, running: true, doneInBatch: 0, target: BATCH_SIZE, note: null }))
    let completed = 0
    try {
      while (completed < BATCH_SIZE) {
        const res = await fetch('/api/products/review/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: Math.min(6, BATCH_SIZE - completed) }),
        })
        if (res.status === 401) throw new Error('Your session expired. Sign in again to carry on.')
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Preparation failed.')

        completed += json.done
        setBatch(b => ({
          ...b,
          doneInBatch: completed,
          prepared: json.prepared,
          total: json.total,
        }))

        // Nothing left to prepare, or a whole chunk failed. Either way,
        // looping again would spin without progress.
        if (json.exhausted || json.done === 0) {
          setBatch(b => ({
            ...b,
            note: json.exhausted
              ? 'Everything in the queue is prepared.'
              : 'That batch could not be prepared - the AI may be rate-limited. Try again shortly.',
          }))
          break
        }
      }
      setBatch(b => ({
        ...b,
        note: b.note ?? `Prepared ${completed} product${completed === 1 ? '' : 's'}. They open instantly now.`,
      }))
      // The product on screen may have just been prepared with photo evidence.
      if (current) load(current.id)
    } catch (e) {
      setBatch(b => ({ ...b, note: (e as Error).message }))
    } finally {
      setBatch(b => ({ ...b, running: false }))
    }
  }, [current, load])

  async function record(status: 'clear' | 'skip' | 'merged', id: string) {
    setDone(d => ({ ...d, [id]: status }))
    try {
      await fetch(`/api/products/review/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    } catch {
      // The decision is already reflected locally; a failed save just means it
      // will come round again next session, which is the safe direction.
    }
  }

  function advance() {
    // Allowed to land one PAST the last product. Clamping to the final item
    // instead left the reviewer parked on product 861 with no sign the run was
    // over, and no prompt about anything they had put off.
    setCursor(c => Math.min(c + 1, queue?.length ?? 0))
  }

  /**
   * Whether this candidate shows its merge controls up front. Anything the AI
   * did not reject is offered directly, including 'unsure' - the whole point
   * is that you decide, so hiding a genuine maybe would be the AI filtering
   * your view. Only an explicit 'different' is folded away, and even then the
   * reviewer can open it.
   */
  function showMergeFor(c: Side, v: Verdict | null) {
    if (forceMerge[c.id]) return true
    return !v || v.verdict !== 'different'
  }

  /**
   * Resolves exactly what a merge would do, so the preview text and the
   * request itself are computed from ONE place. When these were derived
   * separately the button could promise one thing and the API do another.
   */
  function outcome(t: Side, c: Side) {
    // The winner is the shelved row: only a shelved, counted row carries a
    // real on-hand figure, and merging into the other one would throw it away.
    const tShelved = Boolean(t.shelf_code?.trim() || t.last_counted_at)
    const cShelved = Boolean(c.shelf_code?.trim() || c.last_counted_at)
    const winner = !tShelved && cShelved ? c : t
    const loser = winner === t ? c : t
    const keepName = nameChoice ?? defaultName(t, c)
    return {
      winner,
      loser,
      keepName,
      droppedName: keepName === t.name ? c.name : t.name,
      keptQty: winner.quantity ?? 0,
      keptShelf: winner.shelf_code?.trim() || null,
    }
  }

  /**
   * Link instead of merge: both rows survive, the duplicate is retired.
   *
   * Reversible, so this is the answer when the reviewer is not certain enough
   * to destroy a row. The retired name becomes an alias pointing at the
   * survivor - the one thing a merge does NOT do.
   */
  async function link(cand: Side) {
    if (!target) return
    const { winner, loser } = outcome(target, cand)

    setLinking(cand.id)
    setError(null)
    try {
      // Retiring hides the row from every picker, so units left on it are
      // unsellable. But if the shelf was counted once and written under both
      // spellings, moving would double the on-hand figure - so ask.
      const qty = loser.quantity ?? 0
      let moveStock = false
      if (qty > 0) {
        moveStock = window.confirm(
          `"${loser.name}" holds ${qty} on hand.\n\n` +
            `OK - move those ${qty} onto "${winner.name}".\n` +
            `Cancel - leave them on the retired row (they will not be sellable).\n\n` +
            `Choose Cancel if that shelf was counted once and written under both names.`,
        )
      }
      const res = await fetch('/api/products/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId: winner.id, retiredId: loser.id, moveStock }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'The link did not go through.')
      await record('merged', target.id)
      const stockNote = json.stockMoved
        ? ` ${json.stockMoved} unit${json.stockMoved === 1 ? '' : 's'} moved across.`
        : json.stockStranded
          ? ` ${json.stockStranded} unit${json.stockStranded === 1 ? '' : 's'} left on the retired row.`
          : ''
      setFlash(
        `Linked. Both rows kept - "${json.retiredName}" is retired and now resolves to ` +
          `"${json.survivorName}".${stockNote} Reversible from the inventory list.`,
      )

      // The retired row still EXISTS, but it is hidden from every picker, so
      // leaving it in this queue would offer the reviewer a product they can
      // no longer act on. Same renumbering care as merge: if it sat at or
      // before the cursor, everything shifts left and a plain cursor+1 would
      // skip the next product silently.
      const at = (queue ?? []).findIndex(item => item.id === loser.id)
      if (at === -1) {
        advance()
      } else {
        const next = at <= cursor ? cursor : cursor + 1
        setQueue(q => (q ? q.filter(item => item.id !== loser.id) : q))
        setCursor(Math.max(0, Math.min(next, (queue?.length ?? 1) - 2)))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLinking(null)
    }
  }

  async function merge(cand: Side) {
    if (!target) return
    const { winner, loser } = outcome(target, cand)

    setMerging(cand.id)
    setError(null)
    try {
      const keep = outcome(target, cand).keepName
      const res = await fetch('/api/products/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerId: winner.id,
          loserId: loser.id,
          finalName: keep !== winner.name ? keep : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'The merge did not go through.')
      await record('merged', target.id)
      setFlash(
        `Merged. One product left, named "${json.finalName || winner.name}", holding ${
          winner.quantity ?? 0
        } on hand${winner.shelf_code ? ` at ${winner.shelf_code}` : ''}.`,
      )

      // The loser ROW is gone from the database, but it is usually still
      // sitting in this queue, which was built before the merge - leaving it
      // there walks the reviewer into a dead product id and a red "no longer
      // exists" error for something they just deliberately removed.
      //
      // Dropping it renumbers the list, so the cursor is recomputed here
      // instead of calling advance(): if the removed row sat at or before the
      // cursor everything shifts left by one and a plain cursor+1 would jump
      // clean over the next product - a silent skip, the one failure this
      // tool cannot have. Note the loser CAN be the target itself, since the
      // shelved row wins regardless of which one we started from.
      const at = (queue ?? []).findIndex(item => item.id === loser.id)
      if (at === -1) {
        advance()
      } else {
        const next = at <= cursor ? cursor : cursor + 1
        setQueue(q => (q ? q.filter(item => item.id !== loser.id) : q))
        setCursor(Math.max(0, Math.min(next, (queue?.length ?? 1) - 2)))
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setMerging(null)
    }
  }

  /**
   * Default kept name follows the record count, not the winner - the shelved
   * row is usually the hand-typed one carrying the typo.
   */
  function defaultName(a: Side, b: Side) {
    const wa = a.po_count + a.image_count
    const wb = b.po_count + b.image_count
    if (wa === wb) return a.name
    return wa > wb ? a.name : b.name
  }

  // "Decide later" is the opposite of a decision, so a skipped product must
  // NOT count as reviewed - otherwise the bar creeps to 861 of 861 while
  // products are still genuinely outstanding, and the run looks finished when
  // it is not. Skips are counted separately and shown so they cannot be
  // quietly forgotten at the end of the pass.
  const reviewedCount = useMemo(
    () => (queue ? queue.filter(q => done[q.id] && done[q.id] !== 'skip').length : 0),
    [queue, done],
  )
  const skippedCount = useMemo(
    () => (queue ? queue.filter(q => done[q.id] === 'skip').length : 0),
    [queue, done],
  )

  if (error && !queue) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!queue) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading the catalogue…
      </div>
    )
  }

  const shown = expanded ? candidates : candidates.slice(0, VISIBLE)
  const hidden = candidates.length - shown.length
  const zoomedName = zoom
    ? zoom === target?.image_url
      ? target.name
      : (candidates.find(c => c.image_url === zoom)?.name ?? null)
    : null

  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/deliveries/inventory">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Inventory
              </Link>
            </Button>
            <h1 className="text-xl font-semibold text-balance">Duplicate review</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {reviewedCount} of {queue.length} reviewed
            {skippedCount > 0 ? ` · ${skippedCount} left for later` : ''}
          </p>
        </div>
        <Progress value={(reviewedCount / Math.max(queue.length, 1)) * 100} className="h-1" />
        <p className="text-sm text-muted-foreground leading-relaxed">
          One product at a time, ordered so the likeliest duplicates come first. Every candidate the search
          found is listed — the AI only orders them and explains why. Nothing merges until you say so.
        </p>

        {/* Batch preparation. Kept visible rather than automatic: it spends
            real money on the AI, so it starts when the reviewer says so. */}
        <div className="flex items-center gap-3 flex-wrap rounded-md border border-border bg-muted/30 px-4 py-3">
          <Button size="sm" onClick={runBatch} disabled={batch.running}>
            {batch.running ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Preparing {batch.doneInBatch} of {batch.target}…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Prepare next {BATCH_SIZE}
              </>
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {batch.total > 0
              ? `${batch.prepared} of ${batch.total} products already worked out in advance. Prepared ones open straight away; the rest take about ten seconds each.`
              : 'Works out candidates ahead of time so products open instantly.'}
          </span>
          {batch.note && <span className="text-sm text-foreground w-full">{batch.note}</span>}
        </div>
      </header>

      {flash && (
        <div className="rounded-md border border-foreground/20 bg-muted/40 px-4 py-3 text-sm">{flash}</div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* End of the run. This must not say "all done" while skipped products
          are still outstanding - that is exactly how a deferred decision gets
          forgotten - so it counts them and offers to jump straight back. */}
      {!current && queue.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-6 flex flex-col gap-3">
          <h2 className="text-lg font-medium">
            {skippedCount > 0 ? 'End of the list, with some left for later' : 'Every product reviewed'}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You went through all {queue.length} products. {reviewedCount} decided
            {skippedCount > 0
              ? `, and ${skippedCount} you chose to come back to. Those are still outstanding.`
              : '. Nothing is outstanding.'}
          </p>
          <div className="flex gap-2 flex-wrap">
            {skippedCount > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  const at = queue.findIndex(q => done[q.id] === 'skip')
                  if (at >= 0) setCursor(at)
                }}
              >
                Go to the first one left for later
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/deliveries/inventory">Back to inventory</Link>
            </Button>
          </div>
        </section>
      )}

      {current && (
        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-start justify-between gap-4 p-5 border-b border-border flex-wrap">
            <div className="flex items-start gap-4">
              <Thumb
                url={target?.image_url ?? current.imageUrl}
                alt={current.name}
                className="w-28 h-28"
                onZoom={setZoom}
              />
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Product {cursor + 1} of {queue.length}
                </span>
                <h2 className="text-lg font-medium text-balance">{current.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {target
                    ? `${target.quantity ?? 0} on hand${
                        target.shelf_code ? ` at ${target.shelf_code}` : ', not on a shelf'
                      } · ${count(target.po_count, 'order')} · ${count(target.image_count, 'photo')}`
                    : '…'}
                </p>
                {lookedAtPhotos && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    The AI compared photos on the close calls
                  </span>
                )}
              </div>
            </div>
            {done[current.id] && (
              <Badge variant="secondary" className="shrink-0">
                {done[current.id] === 'clear'
                  ? 'Marked no duplicate'
                  : done[current.id] === 'merged'
                    ? 'Merged'
                    : 'Skipped'}
              </Badge>
            )}
          </div>

          <div className="flex flex-col gap-4 p-5">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching all {queue.length} products, then asking the AI to rank them…
              </div>
            )}

            {aiError && !loading && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{aiError}</span>
              </div>
            )}

            {!loading && !candidates.length && (
              <div className="flex flex-col gap-1 py-4">
                <p className="text-sm font-medium">Nothing in the catalogue resembles this product.</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  The search covered every one of the {queue.length} active products by name, shared photo,
                  shared 1688 listing and SKU.
                </p>
              </div>
            )}

            {!loading &&
              shown.map((c, i) => {
                const v = verdicts[i] ?? null
                return (
                  <article
                    key={c.id}
                    className="flex flex-col gap-3 rounded-md border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3">
                        <Thumb url={c.image_url} alt={c.name} onZoom={setZoom} />
                        <div className="flex flex-col gap-1">
                          <span className="font-medium text-balance">{c.name}</span>
                          <span className="text-sm text-muted-foreground">
                            {c.quantity ?? 0} on hand
                        {c.shelf_code ? ` at ${c.shelf_code}` : ', not on a shelf'} ·{' '}
                        {count(c.po_count, 'order')} · {count(c.image_count, 'photo')}
                          </span>
                        </div>
                      </div>
                      {/* "Different · 100%" next to "Likely the same · 100%"
                          reads as the same strength of claim when both are one
                          identical badge - the number means confidence, not
                          sameness. Say which way it points in words. */}
                      {v && (
                        <Badge
                          variant={v.verdict === 'same' ? 'default' : 'outline'}
                          className="shrink-0"
                        >
                          {v.verdict === 'same'
                            ? `Likely the same · ${Math.round(v.confidence * 100)}% sure`
                            : v.verdict === 'unsure'
                              ? 'Not sure - your call'
                              : `Not a duplicate · ${Math.round(v.confidence * 100)}% sure`}
                        </Badge>
                      )}
                    </div>

                    {v && <p className="text-sm text-muted-foreground leading-relaxed">{v.reason}</p>}

                    <div className="flex items-center gap-2 flex-wrap">
                      {c.reasons.map(r => (
                        <span
                          key={r}
                          className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {r}
                        </span>
                      ))}
                    </div>

                    {target && showMergeFor(c, v) && (
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span className="text-muted-foreground">Keep the name:</span>
                        {[target.name, c.name].map(n => {
                          const active = (nameChoice ?? defaultName(target, c)) === n
                          return (
                            <Button
                              key={n}
                              size="sm"
                              variant={active ? 'secondary' : 'ghost'}
                              className={active ? 'border border-foreground/30' : ''}
                              onClick={() => setNameChoice(n)}
                            >
                              {n}
                            </Button>
                          )
                        })}
                      </div>
                    )}

                    {/* Spell out the outcome before the click, not after. The
                        surviving row and the surviving NAME can be different
                        rows, which is impossible to guess from a bare button
                        and is exactly where an irreversible mistake happens. */}
                    {/* A candidate the AI rejected keeps its merge behind one
                        deliberate click. The AI is not allowed to DECIDE - the
                        option stays reachable - but a rejected pair must not
                        sit under the same one-tap button as a real duplicate,
                        or a fast reviewer merges it by reflex. */}
                    {target && !showMergeFor(c, v) && (
                      <button
                        type="button"
                        onClick={() => setForceMerge(m => ({ ...m, [c.id]: true }))}
                        className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        I disagree - merge these anyway
                      </button>
                    )}

                    {target && showMergeFor(c, v) && (() => {
                      const o = outcome(target, c)
                      return (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            One product will be left: {o.keptQty} on hand
                            {o.keptShelf ? ` at ${o.keptShelf}` : ', not on a shelf'}, named &ldquo;{o.keepName}
                            &rdquo;. Orders and photos from both move onto it. &ldquo;{o.droppedName}&rdquo; will
                            no longer exist.{' '}
                            <span className="text-foreground/70">
                              Linking instead keeps both rows: &ldquo;{o.loser.name}&rdquo; is hidden from the
                              pickers and resolves to &ldquo;{o.winner.name}&rdquo;, and it can be undone.
                            </span>
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              size="sm"
                              className="self-start"
                              disabled={merging === c.id || linking === c.id}
                              onClick={() => merge(c)}
                            >
                              {merging === c.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                              Merge into &ldquo;{o.keepName}&rdquo;
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="self-start"
                              disabled={merging === c.id || linking === c.id}
                              onClick={() => link(c)}
                            >
                              {linking === c.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                              Link &amp; retire &ldquo;{o.loser.name}&rdquo;
                            </Button>
                          </div>
                        </div>
                      )
                    })()}
                  </article>
                )
              })}

            {!loading && hidden > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} className="self-start">
                <Search className="w-4 h-4 mr-2" />
                Show the other {hidden} the search found
              </Button>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-border p-5 flex-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                record('clear', current.id)
                advance()
              }}
            >
              <Check className="w-4 h-4 mr-2" />
              No duplicate, next
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                record('skip', current.id)
                advance()
              }}
            >
              <SkipForward className="w-4 h-4 mr-2" />
              Decide later
            </Button>
            <Button variant="ghost" onClick={() => load(current.id)} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Search again
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={cursor === 0}
                onClick={() => setCursor(c => Math.max(0, c - 1))}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button variant="ghost" size="sm" disabled={cursor >= queue.length - 1} onClick={advance}>
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </footer>
        </section>
      )}

      {/* Enlarged photo. A candidate is shown NEXT TO the product being
          reviewed rather than alone - the question is never "what is this?",
          it is "are these two the same thing?", and answering that from
          memory across a scroll is exactly what goes wrong. */}
      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Compare photos"
          className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-6"
          onClick={() => setZoom(null)}
        >
          <div className="flex items-start gap-8 flex-wrap justify-center" onClick={e => e.stopPropagation()}>
            {target?.image_url && zoom !== target.image_url && (
              <figure className="flex flex-col items-center gap-2 max-w-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaSrc(target.image_url) || '/placeholder.svg'}
                  alt={target.name}
                  className="max-h-[60vh] w-auto rounded-md border border-border object-contain"
                />
                <figcaption className="text-sm text-center text-pretty">
                  <span className="font-medium">{target.name}</span>
                  <span className="block text-muted-foreground">the product you are reviewing</span>
                </figcaption>
              </figure>
            )}
            <figure className="flex flex-col items-center gap-2 max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={zoom || '/placeholder.svg'}
                alt={zoomedName ?? 'Product photo'}
                className="max-h-[60vh] w-auto rounded-md border border-border object-contain"
              />
              <figcaption className="text-sm text-center text-pretty">
                <span className="font-medium">{zoomedName ?? 'This product'}</span>
                {zoom !== target?.image_url && (
                  <span className="block text-muted-foreground">possible duplicate</span>
                )}
              </figcaption>
            </figure>
          </div>
          <Button variant="outline" size="sm" onClick={() => setZoom(null)}>
            <X className="w-4 h-4 mr-2" />
            Close
          </Button>
        </div>
      )}
    </div>
  )
}
