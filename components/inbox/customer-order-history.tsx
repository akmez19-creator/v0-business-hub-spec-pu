'use client'

/**
 * Shows what we already know about the customer on the phone number, docked at
 * the top of Quick Order so an agent sees it before raising a new order.
 *
 * The point is duplicate prevention: `openOrders` are deliveries still in
 * flight for this number (pending/assigned), and two agents once created the
 * same order 55 minutes apart because nothing on the form showed the first one.
 * Read-only - it calls the existing /api/clients/rating point read and never
 * writes anything.
 */

import useSWR from 'swr'
import { History, TriangleAlert } from 'lucide-react'

type OpenOrder = {
  id: string
  products: string | null
  qty: number | null
  amount: number
  deliveryDate: string | null
  createdAt: string
  status: string
  agent: string | null
}

type RatingResponse = {
  found: boolean
  rating?: string
  name?: string | null
  totalOrders?: number
  delivered?: number
  cms?: number
  lastOrderDate?: string | null
  openOrders?: OpenOrder[]
}

/** Local Mauritian mobile (8 digits from 5), from the order phone or the wa_id. */
function localMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('230')) digits = digits.slice(3)
  return /^5\d{7}$/.test(digits) ? digits : null
}

const fetcher = async (url: string): Promise<RatingResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('lookup failed')
  return res.json()
}

const RATING_LABEL: Record<string, string> = { good: 'Good client', bad: 'Bad client', new: 'New client' }

function formatDate(value: string | null) {
  if (!value) return ''
  const t = Date.parse(value)
  return Number.isFinite(t)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(t)
    : ''
}

export function CustomerOrderHistory({ phone, waId }: { phone: string; waId: string | null }) {
  // Prefer what the agent typed; fall back to the WhatsApp number so the
  // history is there even before any field is filled.
  const lookup = localMobile(phone) ?? localMobile(waId)
  const { data, isLoading } = useSWR<RatingResponse>(
    lookup ? `/api/clients/rating?phone=${encodeURIComponent(lookup)}` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  if (!lookup) return null
  if (isLoading && !data) {
    return <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">Checking this customer…</p>
  }
  if (!data) return null

  const open = data.openOrders ?? []
  const hasRollup = data.found && (data.totalOrders ?? 0) > 0
  if (!open.length && !hasRollup) {
    return <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">No previous orders for this number.</p>
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span>{data.name?.trim() || 'This customer'}</span>
        {data.rating ? (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
              data.rating === 'good'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                : data.rating === 'bad'
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {RATING_LABEL[data.rating] ?? data.rating}
          </span>
        ) : null}
      </div>

      {hasRollup ? (
        <p className="text-[11px] text-muted-foreground">
          {data.delivered ?? 0} delivered
          {data.cms ? ` · ${data.cms} failed` : ''}
          {data.lastOrderDate ? ` · last ${formatDate(data.lastOrderDate)}` : ''}
        </p>
      ) : null}

      {open.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {open.length} order{open.length === 1 ? '' : 's'} already open — check before creating another
          </p>
          <ul className="flex flex-col gap-1.5">
            {open.map(order => (
              <li key={order.id} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed">
                <span className="font-medium text-foreground">{order.products?.trim() || 'Order'}</span>
                {order.qty ? <span className="text-muted-foreground"> × {order.qty}</span> : null}
                {order.amount ? <span className="text-muted-foreground"> · Rs {order.amount.toLocaleString('en-GB')}</span> : null}
                <span className="block text-muted-foreground">
                  {order.status}
                  {order.deliveryDate ? ` · ${formatDate(order.deliveryDate)}` : ''}
                  {order.agent ? ` · ${order.agent}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
