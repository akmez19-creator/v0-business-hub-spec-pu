'use client'

/**
 * Shows what we already know about the customer on the phone number, docked at
 * the top of Quick Order so an agent sees it before raising a new order.
 *
 * Two jobs: duplicate prevention (`openOrders` are deliveries still in flight -
 * two agents once created the same order 55 minutes apart because nothing on
 * the form showed the first one) and the "returning client" label that says
 * which details below were carried over from the last delivery. Read-only.
 */

import { History, MapPin, PackagePlus, Phone, StickyNote, TriangleAlert, UserRound } from 'lucide-react'
import { useCustomerRecord, localMobile, type CustomerRecord, type LastDelivery } from './use-customer-record'
import type { OrderDraft } from './quick-order-panel'

const RATING_LABEL: Record<string, string> = { good: 'Good client', bad: 'Bad client', new: 'New client' }

function formatDate(value: string | null) {
  if (!value) return ''
  const t = Date.parse(value)
  return Number.isFinite(t)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(t)
    : ''
}

/** Which prefilled details are still exactly what the last delivery recorded (so the label stays truthful once edited). */
function carriedOver(last: LastDelivery, draft: OrderDraft) {
  const same = (a: string | null | undefined, b: string) => Boolean(a?.trim()) && a!.trim().toLowerCase() === b.trim().toLowerCase()
  return {
    name: same(last.customerName, draft.customerName),
    locality: same(last.locality, draft.region),
    contact2: Boolean(localMobile(last.contact2)) && localMobile(last.contact2) === localMobile(draft.contact2),
    notes: same(last.notes, draft.notes),
  }
}

export function CustomerOrderHistory({ phone, waId, draft, localityNotInList, addingToId = null, sameAsOpen = false, exchangeOfId = null }: {
  phone: string
  waId: string | null
  draft: OrderDraft
  /** The last delivery's locality is not in today's active list, so it was left for the agent to pick. */
  localityNotInList: boolean
  /** The open order the item in the form will be added to (null = a new, separate order). */
  addingToId?: string | null
  /** The product in the form is already on an open order - the duplicate case. */
  sameAsOpen?: boolean
  /** The form is an exchange replacing this delivered order (no duplicate warning). */
  exchangeOfId?: string | null
}) {
  // Prefer what the agent typed; fall back to the WhatsApp number so the
  // history is there even before any field is filled.
  const lookup = localMobile(phone) ?? localMobile(waId)
  const { data, isLoading } = useCustomerRecord(lookup)

  if (!lookup) return null
  if (isLoading && !data) {
    return <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">Checking this customer…</p>
  }
  if (!data) return null

  const open = data.openOrders ?? []
  const last = data.lastDelivery ?? null
  const hasRollup = data.found && (data.totalOrders ?? 0) > 0
  if (!open.length && !hasRollup && !last) {
    return <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">No previous orders for this number.</p>
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
      <Header data={data} last={last} />

      {hasRollup ? (
        <p className="text-[11px] text-muted-foreground">
          {data.delivered ?? 0} delivered
          {data.cms ? ` · ${data.cms} failed` : ''}
          {data.lastOrderDate ? ` · last ${formatDate(data.lastOrderDate)}` : ''}
        </p>
      ) : null}

      {last ? <LastDeliveryDetails last={last} draft={draft} localityNotInList={localityNotInList} /> : null}

      {open.length ? (
        <div className="flex flex-col gap-1.5">
          {exchangeOfId ? (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <PackagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {draft.salesType === 'trade_in'
                ? 'Trade-in — the order marked below comes back; what they paid for it is credited against the new item.'
                : 'Exchange — replaces the order marked below. No charge, faulty unit collected.'}
            </p>
          ) : addingToId && !sameAsOpen ? (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <PackagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Adding to the open order — same drop, same day. Details below carried over.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {sameAsOpen
                ? 'This product is already on an open order — do not create it twice'
                : `${open.length} order${open.length === 1 ? '' : 's'} already open — pick the product to add it, or check before creating another`}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {open.map(order => {
              const replaced = order.id === exchangeOfId
              const target = (order.id === addingToId && !sameAsOpen) || replaced
              return (
                <li key={order.id} className={`rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed ${target ? 'border-primary/40 bg-primary/5' : exchangeOfId ? 'border-border' : 'border-amber-500/30 bg-amber-500/5'}`}>
                  <span className="font-medium text-foreground">{order.products?.trim() || 'Order'}</span>
                  {order.qty ? <span className="text-muted-foreground"> × {order.qty}</span> : null}
                  {order.amount ? <span className="text-muted-foreground"> · Rs {order.amount.toLocaleString('en-GB')}</span> : null}
                  {order.parentDeliveryId ? <span className="text-muted-foreground"> · add-on</span> : null}
                  <span className="block text-muted-foreground">
                    {order.status}
                    {order.deliveryDate ? ` · ${formatDate(order.deliveryDate)}` : ''}
                    {order.agent ? ` · ${order.agent}` : ''}
                    {replaced ? <span className="text-primary"> · being replaced by this exchange</span> : target ? <span className="text-primary"> · new item rides with this</span> : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Header({ data, last }: { data: CustomerRecord; last: LastDelivery | null }) {
  const name = data.name?.trim() || last?.customerName?.trim() || 'This customer'
  const returning = Boolean(last)
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium">
      <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{name}</span>
      {returning ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          Returning client
        </span>
      ) : null}
      {data.rating && data.rating !== 'new' ? (
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
            data.rating === 'good'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
              : 'bg-destructive/15 text-destructive'
          }`}
        >
          {RATING_LABEL[data.rating] ?? data.rating}
        </span>
      ) : null}
    </div>
  )
}

/** The last delivery as recorded, each line marked when the form below is still using it. */
function LastDeliveryDetails({ last, draft, localityNotInList }: { last: LastDelivery; draft: OrderDraft; localityNotInList: boolean }) {
  const used = carriedOver(last, draft)
  const altPhone = localMobile(last.contact2)
  const rows = [
    { key: 'name', icon: UserRound, label: 'Name', value: last.customerName?.trim() || null, used: used.name },
    { key: 'locality', icon: MapPin, label: 'Delivered to', value: last.locality?.trim() || null, used: used.locality, warn: localityNotInList },
    { key: 'contact2', icon: Phone, label: 'Alt. phone', value: altPhone, used: used.contact2 },
    { key: 'notes', icon: StickyNote, label: 'Instructions', value: last.notes?.trim() || null, used: used.notes },
  ].filter(r => r.value)
  if (!rows.length) return null
  const usedCount = rows.filter(r => r.used).length
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">
        From the last order{last.products?.trim() ? `, ${last.products.trim()}` : ''}
        {last.createdAt ? ` · ${formatDate(last.createdAt)}` : ''}
        {last.pastOrders > 1 ? ` · ${last.pastOrders} orders on this number` : ''}
      </p>
      <dl className="flex flex-col gap-1">
        {rows.map(({ key, icon: Icon, label, value, used, warn }) => (
          <div key={key} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
            <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <dt className="sr-only">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-foreground">{value}</dd>
            {warn ? (
              <span className="shrink-0 text-amber-700 dark:text-amber-300">not in list - pick below</span>
            ) : used ? (
              <span className="shrink-0 text-primary">in form</span>
            ) : (
              <span className="shrink-0 text-muted-foreground">changed</span>
            )}
          </div>
        ))}
      </dl>
      <p className="text-[11px] text-muted-foreground">
        {usedCount === rows.length ? 'All details prefilled below. Confirm with the customer before creating.' : usedCount ? `${usedCount} of ${rows.length} details prefilled below.` : 'Details below differ from the last order.'}
      </p>
    </div>
  )
}
