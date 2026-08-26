'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { CalendarClock, Undo2, AlertTriangle } from 'lucide-react'
import { rescheduleDelivery, clearReschedule } from '@/lib/reschedule-actions'

interface RescheduleDialogProps {
  delivery: {
    id: string
    customer_name: string
    products?: string | null
    delivery_date: string
    rescheduled_to?: string | null
    reschedule_requested_to?: string | null
    reschedule_reason?: string | null
    status: string
  }
  /** Rendered as the trigger. Falls back to a labelled button. */
  children?: React.ReactNode
}

function fmt(d?: string | null) {
  if (!d) return null
  const dt = new Date(`${d}T00:00:00`)
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function RescheduleDialog({ delivery, children }: RescheduleDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]
  // Pre-fills a rider's proposal when there is one, so confirming it is one
  // click and the admin cannot mistype the day the rider actually asked for.
  const [date, setDate] = useState(
    delivery.reschedule_requested_to || delivery.rescheduled_to || '',
  )
  const [reason, setReason] = useState(delivery.reschedule_reason || '')

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await rescheduleDelivery(delivery.id, date, reason)
    setBusy(false)
    if (res?.error) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  async function undo() {
    setBusy(true)
    setError(null)
    const res = await clearReschedule(delivery.id)
    setBusy(false)
    if (res?.error) {
      setError(res.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarClock className="w-4 h-4" />
            Reschedule
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            Reschedule delivery
          </DialogTitle>
          <DialogDescription>
            {delivery.customer_name}
            {delivery.products ? ` - ${delivery.products}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Both dates shown side by side. The original is READ-ONLY and
              labelled, so it is clear the reschedule adds a new target rather
              than editing the day the goods went out. */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Originally went out</p>
              <p className="text-sm font-medium tabular-nums">{fmt(delivery.delivery_date)}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Currently due</p>
              <p className="text-sm font-medium tabular-nums">
                {fmt(delivery.rescheduled_to) || fmt(delivery.delivery_date)}
              </p>
            </div>
          </div>

          {delivery.reschedule_requested_to && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                The rider asked for{' '}
                <span className="font-semibold">{fmt(delivery.reschedule_requested_to)}</span>.
                It is filled in below but not applied until you save.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="resched-date">New delivery day</Label>
            <Input
              id="resched-date"
              type="date"
              value={date}
              min={today}
              onChange={e => setDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              No day is suggested automatically - the next day may be a holiday or
              an off-day for this region.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="resched-reason">Reason</Label>
            <Textarea
              id="resched-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why is this being moved?"
              rows={2}
            />
          </div>

          <p className="text-xs text-muted-foreground/80 border-t border-border pt-3">
            The original day stays on the record, so van stock, returns and the
            day&apos;s cash figures are unaffected.
          </p>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {delivery.rescheduled_to && (
            <Button
              variant="ghost"
              onClick={undo}
              disabled={busy}
              className="gap-2 mr-auto text-muted-foreground"
            >
              <Undo2 className="w-4 h-4" />
              Back to {fmt(delivery.delivery_date)}
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !date || !reason.trim()}>
            {busy ? 'Saving...' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Compact read-only display of the reschedule state, for list rows. */
export function RescheduleBadge({
  deliveryDate,
  rescheduledTo,
  requestedTo,
}: {
  deliveryDate: string
  rescheduledTo?: string | null
  requestedTo?: string | null
}) {
  if (rescheduledTo && rescheduledTo !== deliveryDate) {
    return (
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px] gap-1">
        <CalendarClock className="w-3 h-3" />
        moved to {fmt(rescheduledTo)}
      </Badge>
    )
  }
  if (requestedTo) {
    return (
      <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-[10px] gap-1">
        <AlertTriangle className="w-3 h-3" />
        rider asked for {fmt(requestedTo)}
      </Badge>
    )
  }
  return null
}
