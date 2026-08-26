'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, X, Loader2, CalendarClock } from 'lucide-react'
import { validateReschedule } from '@/lib/reschedule-actions'

/**
 * VALIDATE ONE POSTPONEMENT: confirm the day, move it, or reject it.
 *
 * The whole point of this control is that a postponed order is NOT yet agreed.
 * `active_date` is generated from `rescheduled_to`, so a date written by
 * day-closure is already steering the flow - 28 of the 32 live postponements
 * got in exactly that way with no audit trail at all. Confirming here is what
 * records that a named person actually agreed to the day.
 */
export function CmsValidateActions({
  deliveryId,
  proposedDate,
  isProposal,
}: {
  deliveryId: string
  /** The day being asked for - a rider proposal or an unvalidated live date. */
  proposedDate: string
  /** True when the date has NOT reached the flow yet (rider proposal). */
  isProposal: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Opens only when the admin wants a DIFFERENT day than the one asked for -
  // the common case being a requested day that turns out to be a holiday.
  const [changing, setChanging] = useState(false)
  const [date, setDate] = useState(proposedDate)

  const today = new Date().toISOString().split('T')[0]

  async function run(accept: boolean, overrideDate?: string) {
    setBusy(accept ? 'accept' : 'decline')
    setError(null)
    const res = await validateReschedule(deliveryId, accept, overrideDate)
    setBusy(null)
    // The action returns a union of success/error shapes, so `error` is narrowed
    // in rather than read off blindly - a silent failure here would leave the
    // admin believing a day was confirmed when nothing was written.
    if (res && 'error' in res && res.error) {
      setError(res.error)
      return
    }
    setChanging(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2 items-stretch">
      {changing ? (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            min={today}
            onChange={e => setDate(e.target.value)}
            className="h-9 w-[9.5rem] text-sm"
            aria-label="Validate a different date"
          />
          <Button
            size="sm"
            onClick={() => run(true, date)}
            disabled={!date || busy !== null}
            className="h-9"
          >
            {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setChanging(false); setDate(proposedDate) }}
            disabled={busy !== null}
            className="h-9"
          >
            Cancel
          </Button>
        </div>
      ) : (
        // `flex-wrap`: these are THREE decisions and Reject is the last one, so
        // on a phone it was being clipped off the right edge - the owner could
        // see a button he could not reach. Wrapping keeps every choice
        // reachable instead of hiding the destructive one.
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => run(true)}
            disabled={busy !== null}
            className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {busy === 'accept'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Check className="w-4 h-4 mr-1" />Validate</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setChanging(true)}
            disabled={busy !== null}
            className="h-9"
            title="Validate a different day instead"
          >
            <CalendarClock className="w-4 h-4 mr-1" />
            Change day
          </Button>
          {/* Rejecting sends the order back to its ORIGINAL delivery_date -
              it does not cancel anything, so the wording says where it lands. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(false)}
            disabled={busy !== null}
            className="h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
            title={isProposal ? 'Refuse the request' : 'Undo the postponement'}
          >
            {busy === 'decline'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><X className="w-4 h-4 mr-1" />Reject</>}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
