import { Badge } from '@/components/ui/badge'
import { Phone, MapPin, Package, Bike, Calendar, Check } from 'lucide-react'
import { CmsEditActions } from '@/components/admin/cms-edit-actions'
import { RescheduleDialog } from '@/components/admin/reschedule-dialog'
import { CmsValidateActions } from '@/components/admin/cms-validate-actions'

/**
 * ONE CMS ORDER, rendered identically wherever it appears.
 *
 * This markup used to be a single ~130-line inline block inside the page, which
 * is why the page could only ever show ONE flat list: splitting the orders into
 * stages would have meant copying it. Extracted so the page can group by stage
 * without duplicating the row, and so a fix to the row applies everywhere.
 *
 * Every control the flat list had is still here - reschedule, edit, phone,
 * locality, product, rider, amount, dates - plus the validation buttons, which
 * render only for a stage that needs them.
 */

export interface CmsRowDelivery {
  id: string
  /** AK-1000042. Optional: only rows that have been issued a code carry one. */
  order_code?: string | null
  customer_name: string
  contact_1?: string | null
  contact_2?: string | null
  locality?: string | null
  products?: string | null
  qty?: number | null
  amount?: number | null
  status: string
  delivery_notes?: string | null
  delivery_date: string
  rescheduled_to?: string | null
  reschedule_requested_to?: string | null
  reschedule_reason?: string | null
  reschedule_validated_at?: string | null
  reschedule_declined_at?: string | null
  active_date?: string | null
  rider_id?: string | null
  contractor_id?: string | null
  sales_type?: string | null
}

function fmtDate(dateStr?: string | null) {
  if (!dateStr) return '-'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/**
 * Which stage of the flow an order is at. Derived in ONE place so the stat
 * cards, the section a row lands in, and the row's own badge can never
 * disagree - they all call this.
 */
export function cmsStage(d: CmsRowDelivery) {
  const notes = d.delivery_notes || ''
  const isReviewed = notes.startsWith('[REVIEWED]')

  // A postponement exists if EITHER shape is present. The note text alone was
  // the old test, and it misses rows whose date lives only in the columns.
  const proposal = d.reschedule_requested_to || null
  const liveMove = d.rescheduled_to && d.rescheduled_to !== d.delivery_date
    ? d.rescheduled_to
    : null
  const postponedTo = proposal || liveMove || null

  // AWAITING VALIDATION - somebody asked for a new day and nobody confirmed it.
  // Note this is true even when the date is already live: `active_date` is
  // generated from `rescheduled_to`, so day-closure put 28 orders into the flow
  // with nothing recorded. An unvalidated date is steering the round already.
  const needsValidation = !!postponedTo && !d.reschedule_validated_at

  if (needsValidation) return { kind: 'validate' as const, postponedTo, isProposal: !!proposal, isReviewed }
  if (postponedTo) return { kind: 'scheduled' as const, postponedTo, isProposal: false, isReviewed }
  if (isReviewed) return { kind: 'reviewed' as const, postponedTo: null, isProposal: false, isReviewed }
  return { kind: 'pending' as const, postponedTo: null, isProposal: false, isReviewed }
}

const TONE = {
  validate: 'border-amber-500/40 bg-amber-500/[0.07]',
  scheduled: 'border-violet-500/30 bg-violet-500/5',
  pending: 'border-border bg-muted/30',
  reviewed: 'border-emerald-500/25 bg-emerald-500/5',
} as const

export function CmsDeliveryRow({
  delivery,
  riderMap,
  riders,
  regions,
  products,
  today,
}: {
  delivery: CmsRowDelivery
  riderMap: Record<string, string>
  riders: { id: string; name: string; email: string; role: 'rider' }[]
  regions: string[]
  products: string[]
  today: string
}) {
  const stage = cmsStage(delivery)

  // The reason text, with the internal marker stripped for display only.
  let reason = delivery.delivery_notes || 'No reason given'
  if (stage.isReviewed) reason = reason.replace('[REVIEWED] ', '')

  const isToday = delivery.delivery_date === today

  return (
    <div className={`rounded-lg border p-4 transition-colors hover:bg-muted/40 ${TONE[stage.kind]}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* WHO and WHY */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {stage.kind === 'reviewed' && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                <Check className="h-3 w-3 text-emerald-600" />
              </span>
            )}
            {(stage.kind === 'validate' || stage.kind === 'scheduled') && (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                <Calendar className="h-3 w-3 text-violet-500" />
              </span>
            )}
            {/* THE ORDER ID, before the name. 762 clients share a full name, so
                the name alone cannot identify an order on the phone. Rendered
                only when present - never a placeholder, because a made-up code
                would be read out loud as if it were real. */}
            {delivery.order_code && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {delivery.order_code}
              </span>
            )}
            <span className={`truncate font-semibold ${stage.kind === 'reviewed' ? 'text-muted-foreground' : ''}`}>
              {delivery.customer_name}
            </span>

            {/* The reason is the badge for un-postponed rows; for postponed
                ones the DATE is the headline and the reason sits below. */}
            {stage.postponedTo ? (
              <Badge variant="outline" className="shrink-0 border-violet-500/25 bg-violet-500/10 text-[10px] text-violet-500">
                {stage.isProposal ? 'asked for' : 'moved to'} {fmtDate(stage.postponedTo)}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] ${
                  stage.kind === 'reviewed'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-600'
                }`}
              >
                {reason}
              </Badge>
            )}

            {isToday && stage.kind === 'pending' && (
              <Badge variant="outline" className="shrink-0 border-blue-500/20 bg-blue-500/10 text-[10px] text-blue-500">
                Today
              </Badge>
            )}
            {delivery.reschedule_declined_at && (
              <Badge variant="outline" className="shrink-0 border-destructive/25 bg-destructive/10 text-[10px] text-destructive">
                previously rejected
              </Badge>
            )}
          </div>

          {stage.postponedTo && (
            <p className="mb-2 pl-7 text-xs text-muted-foreground">{reason}</p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {delivery.contact_1}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {delivery.locality}
            </span>
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3" />
              {delivery.qty || 1}x {delivery.products}
            </span>
            {delivery.rider_id && riderMap[delivery.rider_id] && (
              <span className="flex items-center gap-1">
                <Bike className="h-3 w-3" />
                {riderMap[delivery.rider_id]}
              </span>
            )}
          </div>
        </div>

        {/* MONEY, DATES and CONTROLS */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <span className="font-mono text-sm font-medium">Rs {delivery.amount || 0}</span>
            {/* The day it went out. Still shown once moved, because this day
                owns the van stock and the storekeeper's returns for the order. */}
            <p className="text-xs text-muted-foreground">went out {fmtDate(delivery.delivery_date)}</p>
            {stage.kind === 'scheduled' && (
              <p className="text-xs font-medium text-violet-500">
                validated for {fmtDate(stage.postponedTo)}
              </p>
            )}
            {stage.kind === 'validate' && (
              <p className="text-xs font-medium text-amber-600">
                {stage.isProposal ? 'not in the flow yet' : 'already in the flow, unchecked'}
              </p>
            )}
          </div>

          <RescheduleDialog delivery={delivery} />
          {/* Mapped explicitly rather than cast: the edit dialog requires
              these fields non-null, and the CMS query genuinely returns NULLs
              (locality is empty on plenty of rows). A blind cast would compile
              and then render "null" into the edit form's inputs. */}
          <CmsEditActions
            delivery={{
              id: delivery.id,
              customer_name: delivery.customer_name,
              contact_1: delivery.contact_1 ?? '',
              contact_2: delivery.contact_2 ?? undefined,
              locality: delivery.locality ?? '',
              products: delivery.products ?? '',
              qty: delivery.qty ?? 1,
              amount: delivery.amount ?? 0,
              rider_id: delivery.rider_id ?? undefined,
              delivery_date: delivery.delivery_date,
              delivery_notes: delivery.delivery_notes ?? undefined,
            }}
            riders={riders}
            regions={regions}
            products={products}
            riderMap={riderMap}
          />
        </div>
      </div>

      {/* The gate. Only the stage that needs a decision renders it. */}
      {stage.kind === 'validate' && stage.postponedTo && (
        <div className="mt-3 flex flex-col gap-2 border-t border-amber-500/20 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {stage.isProposal
              ? 'A rider asked for this day. It does not count until you validate it.'
              : 'This date is already steering the round, but nobody validated it.'}
          </p>
          <CmsValidateActions
            deliveryId={delivery.id}
            proposedDate={stage.postponedTo}
            isProposal={stage.isProposal}
          />
        </div>
      )}
    </div>
  )
}
