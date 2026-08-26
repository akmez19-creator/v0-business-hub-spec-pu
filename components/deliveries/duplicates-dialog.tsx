'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Sparkles, AlertTriangle, Check, MapPin, RefreshCw } from 'lucide-react'

type Side = {
  id: string
  name: string
  quantity: number | null
  zone: string | null
  shelf_code: string | null
  last_counted_at: string | null
  po_count: number
  image_count: number
}

type Pair = {
  a: Side
  b: Side
  winner: Side | null
  loser: Side | null
  reason: 'identical' | 'typo'
  undecided: 'both-zoned' | 'neither-zoned' | null
}

type Verdict = { sameProduct: boolean; confidence: number; reason: string } | null

export function DuplicatesDialog({
  open,
  onOpenChange,
  onMerged,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onMerged: () => void
}) {
  const [pairs, setPairs] = useState<Pair[] | null>(null)
  const [verdicts, setVerdicts] = useState<Verdict[]>([])
  const [loading, setLoading] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [dismissed, setDismissed] = useState<Record<string, true>>({})
  const [nameChoice, setNameChoice] = useState<Record<string, string>>({})

  /**
   * Which spelling to pre-select. NOT the winner's: the winner is chosen by
   * who is on the shelf, and the shelved row is frequently the hand-typed one
   * with the typo ("Airfryer Backet" beats "Air Fryer Basket" on zone alone),
   * so defaulting to it invites a fast reviewer to enshrine the misspelling.
   * The side with more real records behind it is the spelling the business has
   * actually been transacting under. Ties fall back to the winner.
   */
  function defaultName(pair: Pair): string {
    const fallback = (pair.winner ?? pair.a).name
    const weight = (s: Side) => s.po_count + s.image_count
    if (weight(pair.a) === weight(pair.b)) return fallback
    return weight(pair.a) > weight(pair.b) ? pair.a.name : pair.b.name
  }

  const key = (p: Pair) => `${p.a.id}:${p.b.id}`

  async function scan(withAi: boolean) {
    withAi ? setAiRunning(true) : setLoading(true)
    setError(null)
    setAiNote(null)
    try {
      const res = await fetch('/api/products/duplicates', { method: withAi ? 'POST' : 'GET' })
      // A 401 is the session expiring mid-review, not a scan failure. Saying
      // "no duplicates" here would be a lie about the catalogue.
      if (res.status === 401) {
        setError('Your session has expired. Sign in again to review duplicates.')
        return
      }
      const json = await res.json()
      if (!json.success) {
        setError(json.error || 'The scan could not run.')
        return
      }
      setPairs(json.pairs)
      setVerdicts(json.verdicts || [])
      if (json.aiError) setAiNote(json.aiError)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAiRunning(false)
      setLoading(false)
    }
  }

  async function merge(pair: Pair, winner: Side, loser: Side) {
    setMerging(key(pair))
    setError(null)
    try {
      // Which row survives and which spelling it carries are separate choices.
      const chosen = nameChoice[key(pair)] ?? defaultName(pair)
      const finalName = chosen && chosen !== winner.name ? chosen : undefined
      const res = await fetch('/api/products/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId: winner.id, loserId: loser.id, finalName }),
      })
      if (res.status === 401) {
        setError('Your session has expired. Sign in again before merging.')
        return
      }
      const json = await res.json()
      if (!json.success) {
        setError(json.error || 'The merge did not run.')
        return
      }
      const movedTotal = Object.values(json.moved as Record<string, number>).reduce((a, b) => a + b, 0)
      setDone(d => ({
        ...d,
        [key(pair)]: `Kept the ${winner.zone?.trim() ? `shelved row (Zone ${winner.zone})` : 'chosen row'} as "${
          json.finalName || winner.name
        }", holding ${winner.quantity ?? 0} on hand. ${movedTotal} record${
          movedTotal === 1 ? '' : 's'
        } moved across from "${loser.name}".`,
      }))
      onMerged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setMerging(null)
    }
  }

  /**
   * Link instead of merge: keep both rows, retire the duplicate.
   *
   * Nothing is deleted, so this is the safe answer when the pair has real
   * history on both sides or the reviewer is unsure. The retired row's name
   * becomes an alias, which is what keeps old spellings resolving.
   */
  async function link(pair: Pair, survivor: Side, retired: Side) {
    setLinking(key(pair))
    setError(null)
    try {
      // Retiring hides the row from the pickers, so stock left on it becomes
      // unsellable. Ask rather than guess: if one person counted the shelf
      // once under both spellings, moving would double the on-hand figure.
      const qty = retired.quantity ?? 0
      let moveStock = false
      if (qty > 0) {
        moveStock = window.confirm(
          `"${retired.name}" holds ${qty} on hand.\n\n` +
            `OK - move those ${qty} onto "${survivor.name}".\n` +
            `Cancel - leave them on the retired row (they will not be sellable).\n\n` +
            `Choose Cancel if that shelf was counted once and written under both names.`,
        )
      }
      const res = await fetch('/api/products/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ survivorId: survivor.id, retiredId: retired.id, moveStock }),
      })
      if (res.status === 401) {
        setError('Your session has expired. Sign in again before linking.')
        return
      }
      const json = await res.json()
      if (!json.success) {
        setError(json.error || 'The link did not run.')
        return
      }
      const stockNote = json.stockMoved
        ? ` ${json.stockMoved} unit${json.stockMoved === 1 ? '' : 's'} moved across.`
        : json.stockStranded
          ? ` ${json.stockStranded} unit${json.stockStranded === 1 ? '' : 's'} left on the retired row.`
          : ''
      setDone(d => ({
        ...d,
        [key(pair)]:
          `Linked. Both rows kept: "${json.retiredName}" is retired and now resolves to ` +
          `"${json.survivorName}".${stockNote} Reversible from the inventory list.`,
      }))
      onMerged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLinking(null)
    }
  }

  // The parent opens this dialog by flipping its own state, so onOpenChange
  // never fires for the opening edge - hanging the first scan off it left the
  // dialog permanently empty even though the API was fine. Watch `open`.
  useEffect(() => {
    if (open && !pairs && !loading) scan(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const visible = (pairs || []).filter(p => !dismissed[key(p)])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Possible duplicate products</DialogTitle>
          <DialogDescription>
            Products whose names are near-identical, so the same item may have been counted under
            one name and ordered under another. Nothing merges until you say so.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => scan(false)} disabled={loading || aiRunning}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Rescan
          </Button>
          <Button size="sm" onClick={() => scan(true)} disabled={loading || aiRunning}>
            {aiRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {aiRunning ? 'Checking each pair…' : 'Check with AI'}
          </Button>
          {pairs && (
            <span className="text-sm text-muted-foreground ml-auto">
              {visible.length} pair{visible.length === 1 ? '' : 's'} to review
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {aiNote && (
          <div className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
            {aiNote}
          </div>
        )}

        {loading && !pairs && (
          <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Comparing every product name…
          </div>
        )}

        {pairs && visible.length === 0 && !loading && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No near-identical product names left to review.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {visible.map(pair => {
            const i = (pairs || []).indexOf(pair)
            const v = verdicts[i]
            const k = key(pair)
            const finished = done[k]

            if (finished) {
              return (
                <div key={k} className="rounded-lg border border-border bg-muted/40 p-4 flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5 text-foreground shrink-0" />
                  <p className="text-sm text-foreground">{finished}</p>
                </div>
              )
            }

            return (
              <div key={k} className="rounded-lg border border-border p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {v && (
                    <Badge variant={v.sameProduct ? 'default' : 'secondary'}>
                      AI: {v.sameProduct ? 'same product' : 'different products'}
                    </Badge>
                  )}
                  {pair.undecided && (
                    <Badge variant="outline" className="gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {pair.undecided === 'both-zoned' ? 'Both have a zone' : 'Neither has a zone'}
                    </Badge>
                  )}
                </div>

                {v && <p className="text-sm text-muted-foreground">{v.reason}</p>}

                <div className="grid gap-3 md:grid-cols-2">
                  {[pair.a, pair.b].map(side => {
                    const isWinner = pair.winner?.id === side.id
                    const other = side.id === pair.a.id ? pair.b : pair.a
                    return (
                      <div
                        key={side.id}
                        className={`rounded-md border p-3 flex flex-col gap-2 ${
                          isWinner ? 'border-foreground/40 bg-muted/40' : 'border-border'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm text-foreground text-pretty">{side.name}</span>
                          {/* Says why this side wins, not "keeps this name" -
                              the name is chosen separately below. */}
                          {isWinner && <Badge className="shrink-0">On the shelf</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {side.zone?.trim()
                              ? `Zone ${side.zone}${side.shelf_code ? ` · ${side.shelf_code}` : ''}`
                              : 'No zone'}
                          </span>
                          <span>{side.quantity ?? 0} on hand</span>
                          <span>{side.po_count} orders</span>
                          <span>{side.image_count} photos</span>
                          <span>{side.last_counted_at ? 'Counted' : 'Never counted'}</span>
                        </div>
                        {pair.undecided && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-auto"
                            disabled={merging === k}
                            onClick={() => merge(pair, side, other)}
                          >
                            {merging === k ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : null}
                            Keep this one
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* The zoned row wins the DATA, but it is often the row with
                    the typo - "Airfryer Backet" outranks "Air Fryer Basket" on
                    zone alone. Choosing the surviving spelling separately keeps
                    the shelf truth without writing the misspelling in for good. */}
                {!pair.undecided && pair.winner && pair.loser && (
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="text-muted-foreground">Keep the name:</span>
                    {[pair.winner.name, pair.loser.name].map(n => {
                      const active = (nameChoice[k] ?? defaultName(pair)) === n
                      return (
                        <Button
                          key={n}
                          size="sm"
                          variant={active ? 'secondary' : 'ghost'}
                          className={active ? 'border border-foreground/30' : ''}
                          disabled={merging === k}
                          onClick={() => setNameChoice(c => ({ ...c, [k]: n }))}
                        >
                          {n}
                        </Button>
                      )
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  {!pair.undecided && pair.winner && pair.loser && (
                    <Button size="sm" disabled={merging === k} onClick={() => merge(pair, pair.winner!, pair.loser!)}>
                      {merging === k ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Merge into &ldquo;{nameChoice[k] ?? defaultName(pair)}&rdquo;
                    </Button>
                  )}
                  {/* The softer action: keeps BOTH rows. Offered beside merge
                      because merge is irreversible and a reviewer who is only
                      80% sure should have somewhere to go other than "skip". */}
                  {!pair.undecided && pair.winner && pair.loser && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={merging === k || linking === k}
                      onClick={() => link(pair, pair.winner!, pair.loser!)}
                    >
                      {linking === k ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Link &amp; retire &ldquo;{pair.loser.name}&rdquo;
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDismissed(d => ({ ...d, [k]: true }))}
                    disabled={merging === k || linking === k}
                  >
                    Not a duplicate
                  </Button>
                </div>

                {/* The merged-away name is not kept as an alias, so a future
                    import using it creates a fresh product. Said plainly here
                    rather than discovered later. */}
                {!pair.undecided && pair.loser && pair.winner && (() => {
                  // The name that disappears is whichever one is NOT kept, and
                  // that is no longer always the loser's - picking the loser's
                  // spelling means the WINNER's wording is the one retired.
                  const keep = nameChoice[k] ?? defaultName(pair)
                  const dropped = keep === pair.winner!.name ? pair.loser!.name : pair.winner!.name
                  return (
                    <p className="text-xs text-muted-foreground">
                      One product is left, holding {pair.winner!.quantity ?? 0} on hand
                      {pair.winner!.shelf_code ? ` at ${pair.winner!.shelf_code}` : ''}, named &ldquo;{keep}
                      &rdquo;. Orders, photos and counts from both move onto it, and existing purchase orders keep
                      their original wording. &ldquo;{dropped}&rdquo; is not kept as an alias, so an import using it
                      again would create a new product.
                      {' '}
                      <span className="text-foreground/70">
                        Link &amp; retire keeps both rows instead: &ldquo;{pair.loser!.name}&rdquo; stays in the
                        database but is hidden from the pickers and resolves to &ldquo;{pair.winner!.name}&rdquo;,
                        so that spelling keeps working and the whole thing can be undone.
                      </span>
                    </p>
                  )
                })()}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
