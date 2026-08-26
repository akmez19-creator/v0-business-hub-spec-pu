import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The two dates a delivery carries, shown together.
 *
 * WHY THIS EXISTS: every screen printed `delivery_date` alone, so a
 * rescheduled order looked identical to one that was never moved - you could
 * pick a delivery date and never see that the order had already been pushed to
 * another day. 66 orders are rescheduled right now and none of them said so.
 *
 * The two dates mean genuinely different things and BOTH have to stay visible:
 *
 *   delivery_date  - the day the goods physically went out on the van.
 *                    IMMUTABLE. Van stock, cash collection and the
 *                    storekeeper's returns are keyed to it.
 *   rescheduled_to - the day it is now due. Confirmed by an agent.
 *
 * So the day it is DUE leads (that is what someone reading a list is planning
 * around) and the day it WENT OUT is kept underneath rather than replaced -
 * hiding it would strand the storekeeper, whose returns still sit on that day.
 *
 * A rider's proposal is shown too but styled as a question, not a fact:
 * `reschedule_requested_to` moves nothing until an agent confirms it.
 */

const fmt = (d: string, withYear = true) =>
  new Date(d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })

export function DeliveryDateCell({
  deliveryDate,
  rescheduledTo,
  requestedTo,
  className,
}: {
  deliveryDate: string | null
  rescheduledTo?: string | null
  requestedTo?: string | null
  className?: string
}) {
  if (!deliveryDate) return <span className="text-muted-foreground">-</span>

  // A stale reschedule pointing at the same day carries no information and
  // would just add noise to every row.
  const moved = rescheduledTo && rescheduledTo !== deliveryDate ? rescheduledTo : null
  const asked = requestedTo && requestedTo !== deliveryDate ? requestedTo : null

  return (
    <div className={cn('flex flex-col gap-0.5 leading-tight', className)}>
      {moved ? (
        <>
          <span className="inline-flex items-center gap-1 font-medium text-amber-600">
            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
            {fmt(moved)}
          </span>
          {/* Kept, not replaced - the returns for this order still sit here. */}
          <span className="text-[11px] text-muted-foreground">
            <span className="sr-only">Originally went out </span>
            was {fmt(deliveryDate, false)}
          </span>
        </>
      ) : (
        <span>{fmt(deliveryDate)}</span>
      )}

      {asked && !moved && (
        <span className="text-[11px] text-amber-600">
          rider asked: {fmt(asked, false)}
          <span className="text-muted-foreground"> (not approved)</span>
        </span>
      )}
    </div>
  )
}
