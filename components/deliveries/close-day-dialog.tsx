'use client'

/**
 * "We did not deliver today" - close a day and push its work forward.
 *
 * Two-step by design. Step 1 reads the day and reports what is actually there;
 * step 2 commits. A bulk re-date of live orders is not something to fire off a
 * single click, and the numbers it shows (33 moving onto a day that already
 * holds 95) are exactly what decides whether the suggested day is the right
 * one.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { CalendarOff, Loader2, TriangleAlert, ArrowRight } from 'lucide-react'
import { CLOSURE_REASONS, type ClosurePreview } from '@/lib/day-closure'
import { previewDayClosure, closeDayAndReschedule } from '@/lib/day-closure-actions'
import { cn } from '@/lib/utils'

/** Local YYYY-MM-DD. `toISOString()` is UTC and lands on yesterday here. */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pretty(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y) return date
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

export function CloseDayDialog({ defaultDate }: { defaultDate?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(defaultDate || today())
  const [preview, setPreview] = useState<ClosurePreview | null>(null)
  const [target, setTarget] = useState('')
  const [reasonCode, setReasonCode] = useState<string>('')
  const [note, setNote] = useState('')
  const [blockNew, setBlockNew] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setPreview(null); setTarget(''); setReasonCode(''); setNote('')
    setError(null); setDone(null); setBlockNew(true)
  }

  function load(forDate: string) {
    setError(null)
    startTransition(async () => {
      const res = await previewDayClosure(forDate)
      if (!res.ok) { setError(res.error || 'Could not read that day'); setPreview(null); return }
      setPreview(res)
      setTarget(res.suggested)
    })
  }

  function commit() {
    setError(null)
    startTransition(async () => {
      const res = await closeDayAndReschedule({
        date, targetDate: target, reasonCode, note, blockNewOrders: blockNew,
      })
      if (!res.ok) { setError(res.error || 'Could not close the day'); return }
      setDone(
        `Moved ${res.moved} order${res.moved === 1 ? '' : 's'} to ${pretty(res.targetDate!)}` +
        (res.closureAdded ? ' and closed the day to new orders.' : '.'),
      )
      router.refresh()
    })
  }

  const canCommit =
    !!preview?.movable.total && !!target && !!reasonCode &&
    (reasonCode !== 'other' || note.trim().length > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={o => { setOpen(o); if (!o) reset() }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarOff className="w-4 h-4 mr-2" />
          Close a day
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Close a delivery day</DialogTitle>
          <DialogDescription>
            Moves that day&apos;s pending and assigned orders to another day and
            records why. Delivered and cancelled orders stay where they are.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-medium text-emerald-400">{done}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="close-day-date">Day that did not run</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="close-day-date" type="date" value={date}
                  onChange={e => { setDate(e.target.value); setPreview(null) }}
                  className="flex-1"
                />
                <Button
                  type="button" variant="secondary" disabled={pending || !date}
                  onClick={() => load(date)}
                >
                  {pending && !preview ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check'}
                </Button>
              </div>
            </div>

            {preview && (
              <>
                {/* The honest count. A total with no breakdown would hide that
                    cancelled rows are being left behind on purpose. */}
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  {preview.movable.total === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing to move - no pending or assigned orders on {pretty(date)}.
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        {preview.movable.total} order{preview.movable.total === 1 ? '' : 's'} will move
                        <span className="text-muted-foreground font-normal">
                          {' '}({preview.movable.pending} pending, {preview.movable.assigned} assigned,
                          {' '}{preview.movable.units} units)
                        </span>
                      </p>
                      {preview.staying.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Staying on {pretty(date)}:{' '}
                          {preview.staying.map(s => `${s.rows} ${s.status}`).join(', ')}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {preview.stockWarning && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
                    <TriangleAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-200 leading-relaxed">{preview.stockWarning}</p>
                  </div>
                )}

                {preview.movable.total > 0 && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="close-day-target">Move the work to</Label>
                      <Input
                        id="close-day-target" type="date" value={target} min={date}
                        onChange={e => setTarget(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {target === preview.suggested
                          ? `Next working day, skipping Sundays and closed days.`
                          : `Suggested: ${pretty(preview.suggested)}.`}
                        {' '}
                        {/* The load on the receiving day is the whole reason
                            this is editable rather than automatic. */}
                        {target === preview.suggested && preview.suggestedExisting > 0 && (
                          <span className="text-amber-400">
                            {pretty(preview.suggested)} already has {preview.suggestedExisting} order
                            {preview.suggestedExisting === 1 ? '' : 's'} - it would become{' '}
                            {preview.suggestedExisting + preview.movable.total}.
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label>Reason</Label>
                      <div className="flex flex-wrap gap-2">
                        {CLOSURE_REASONS.map(r => (
                          <button
                            key={r.code} type="button"
                            onClick={() => setReasonCode(r.code)}
                            className={cn(
                              'px-3 h-9 rounded-lg border text-sm transition-colors',
                              reasonCode === r.code
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background border-border hover:bg-muted',
                            )}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <Input
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder={reasonCode === 'other' ? 'Describe what happened' : 'Add a note (optional)'}
                        aria-label="Reason detail"
                        maxLength={200}
                      />
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={blockNew}
                        onCheckedChange={v => setBlockNew(v === true)}
                        className="mt-0.5"
                      />
                      <span className="text-sm leading-relaxed">
                        Stop new orders being booked onto {pretty(date)}
                        <span className="block text-xs text-muted-foreground">
                          Adds it to the closed-days list the order form and extension already follow.
                          {preview.alreadyClosed && ' This day is already closed.'}
                        </span>
                      </span>
                    </label>
                  </>
                )}
              </>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={() => { setOpen(false); reset() }}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={commit} disabled={!canCommit || pending}>
                {pending && preview
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Moving...</>
                  : <>
                      Move {preview?.movable.total || 0} order
                      {preview?.movable.total === 1 ? '' : 's'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
