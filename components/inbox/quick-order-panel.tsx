'use client'

/**
 * Quick Order, docked beside the conversation.
 *
 * This posts to the same /api/extension endpoint the Chrome extension uses,
 * so an order raised here is identical to one raised on facebook.com: the
 * server still resolves the locality to a route code, contractor and rider,
 * and still pushes the delivery date off Sundays and configured holidays.
 * Nothing about those rules is reimplemented on the client.
 */

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { beginAnotherOrder, readInbox, type OrderOperation, type RecordSeedFields } from './inbox-session'
import useSWR from 'swr'
import { Check, Copy, Loader2, PackagePlus, Sparkles, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { deliveryDayLabel, isNonWorkingDay, offerLabel, priceFor, unitPrice, upcomingDeliveryDates, type Holiday, type QuickOrderProduct } from '@/lib/orders/quick-order'
import type { UnifiedThread } from '@/lib/inbox/unified'
import { todayInMauritius } from '@/lib/business-date'
import { composeReturnLine, settle } from '@/lib/orders/follow-up'
import { Checkbox } from '@/components/ui/checkbox'
import { amendmentLabel, describeAmendments, detectAmendments, type AmendableField, type Amendment } from '@/lib/inbox/order-amendment'
import { CustomerOrderHistory } from './customer-order-history'
import { localMobile, prefillFromLastDelivery, prefillFromOpenOrder, primaryOpenOrder, useCustomerRecord } from './use-customer-record'

const fetcher = readInbox

export type OrderDraft = {
  customerName: string
  contact1: string
  contact2: string
  region: string
  productId: string | null
  qty: number
  notes: string
  deliveryDate: string
  /**
   * 'exchange' = the rider swaps a faulty unit for the same item, no charge.
   * 'trade_in' = a DIFFERENT item goes out; what they paid is credited and only
   * the difference changes hands (lib/orders/follow-up settle()).
   */
  salesType: 'sale' | 'exchange' | 'trade_in'
  /** The delivered order the exchange / trade-in replaces (deliveries.source_delivery_id). */
  sourceDeliveryId: string | null
}

export const EMPTY_ORDER: OrderDraft = {
  customerName: '',
  contact1: '',
  contact2: '',
  region: '',
  productId: null,
  qty: 1,
  notes: '',
  deliveryDate: '',
  salesType: 'sale',
  sourceDeliveryId: null,
}

/**
 * Lets the conversation pane raise the order itself when the agent sends an
 * order confirmation, so the confirmation is never sent for an order that was
 * not recorded. Mirrors the panel's own button exactly (same checks, same POST).
 */
export type QuickOrderController = {
  /** Every required field is present and no order has been created yet in this session. */
  readyToCreate: boolean
  /** An order already exists for this session (nothing more to create). */
  created: boolean
  /** What the form still lacks, for the message shown when Send is refused. */
  missing: string[]
  submit: () => Promise<{ ok: boolean; error?: string }>
  /** Changes to an EXISTING open order that this reply promises and the agent kept ticked. */
  pendingAmendments: Amendment[]
  /** Writes those changes to the open order; called just before the reply goes out. */
  applyAmendments: () => Promise<{ ok: boolean; error?: string }>
}

export function QuickOrderPanel({
  thread,
  draft,
  onChange,
  aiPending,
  unmatched,
  onOrderCreated,
  onPrefill,
  operation,
  onOperationChange,
  controller,
  messageText,
  onAmendmentsChange,
}: {
  thread: UnifiedThread
  /** Which existing-order fields this send will change, for the composer's button. */
  onAmendmentsChange?: (labels: string) => void
  /**
   * The reply about to be sent. An order that already exists is only changed
   * for the fields this text actually promises - see lib/inbox/order-amendment.
   */
  messageText: string
  controller?: MutableRefObject<QuickOrderController | null>
  operation: OrderOperation
  onOperationChange: (update: (value: OrderOperation) => OrderOperation) => void
  draft: OrderDraft
  onChange: (next: OrderDraft, field: keyof OrderDraft) => void
  /** The AI is still reading the thread, so fields may yet fill in. */
  aiPending: boolean
  /** Values the AI read but could not match to the catalogue. */
  unmatched?: { product: string | null; locality: string | null } | null
  onOrderCreated: (result: { proformaLink: string | null }) => void
  /** Details recorded on this number's last delivery; the session fills only empty, untouched fields. */
  onPrefill: (fields: RecordSeedFields) => void
}) {
  const { saving, created, previousCreated, business } = operation
  const submitting = useRef(false)
  const setSaving = (value: boolean) => onOperationChange((state) => ({ ...state, saving: value }))
  const setCreated = (value: OrderOperation['created']) => onOperationChange((state) => ({ ...state, created: value }))
  const setBusiness = (value: string) => onOperationChange((state) => ({ ...state, business: value }))
  const { toast } = useToast()

  // Same endpoint and payload the extension loads, so the catalogue, the
  // locality list and the pricing rules can never drift between the two.
  const { data } = useSWR<{
    authenticated?: boolean
    products?: QuickOrderProduct[]
    regions?: string[]
    regionDelivery?: Record<string, { contractor: string; rider: string | null }>
    settings?: {
      pageMappings?: { match: string; code: string; pageId?: string }[]
      cutoffTime?: string
      deliveryDayScheme?: Record<string, string>
      holidays?: Holiday[]
      pinnedDeliveryDate?: string | null
    }
  }>('/api/extension', fetcher, { revalidateOnFocus: false })

  const products = data?.products ?? []
  const regions = data?.regions ?? []

  // The same delivery-day rules the AI draft quotes to the customer, so the
  // chips and the draft can never offer different days.
  const deliveryOptions = useMemo(() => {
    const s = data?.settings
    if (!s) return []
    return upcomingDeliveryDates(new Date(), s.cutoffTime || '20:00', s.deliveryDayScheme || {}, s.holidays || [], 4, s.pinnedDeliveryDate)
  }, [data?.settings])

  const product = useMemo(
    () => products.find((p) => p.id === draft.productId) ?? null,
    [products, draft.productId],
  )

  // An exchange is the same product going out again at no charge; the faulty
  // unit comes back with the rider, so the row carries Rs 0 and return_product.
  const isExchange = draft.salesType === 'exchange'
  const isTradeIn = draft.salesType === 'trade_in'
  const isFollowUp = isExchange || isTradeIn
  const outValue = product && !isExchange ? priceFor(product, draft.qty) : 0
  const unit = isExchange ? 0 : unitPrice(product) * draft.qty
  const saved = unit - outValue

  const routing = draft.region ? data?.regionDelivery?.[draft.region] : undefined

  /**
   * Which business the order belongs to (MBM, DBM, HSM...).
   *
   * `medium` is NOT a channel column: every existing row holds a business code,
   * and reports group by it. The extension endpoint falls back to the literal
   * string "Extension" when no code is sent, which would quietly add a bogus
   * business to those reports - so resolve it from the same admin-configured
   * mappings the extension uses, matching on Page id first and only then on
   * the display name.
   */
  const pageMappings = data?.settings?.pageMappings

  const businesses = useMemo(() => {
    const codes = (pageMappings ?? []).map((m) => m.code).filter(Boolean)
    return Array.from(new Set(codes))
  }, [pageMappings])

  const pageCode = useMemo(() => {
    const mappings = pageMappings ?? []
    const byId = thread.pageId
      ? mappings.find((m) => m.pageId && m.pageId === thread.pageId)
      : undefined
    if (byId) return byId.code
    // WhatsApp threads carry a phone number as their source, never a Page name,
    // so this match only ever succeeds for Messenger and comments.
    const source = thread.source.toLowerCase()
    return mappings.find((m) => source.includes(m.match.toLowerCase()))?.code
  }, [pageMappings, thread.pageId, thread.source])

  // Seeded from the mapping but kept editable, because auto-detection cannot
  // work for WhatsApp and an unmapped Page would otherwise be filed silently.
  useEffect(() => {
    if (pageCode) onOperationChange((state) => state.business ? state : { ...state, business: pageCode })
  }, [pageCode, thread.key, onOperationChange])

  // A returning client's recorded details land in the form as soon as the record
  // and the locality list are both here. Keyed on the delivery id so a re-render
  // never re-applies; the session helper is a no-op for anything already filled.
  const lookup = localMobile(draft.contact1) ?? (thread.channel === 'whatsapp' ? localMobile(thread.recipientId) : null)
  const { data: record, mutate: mutateRecord } = useCustomerRecord(lookup)
  const lastDelivery = record?.lastDelivery ?? null
  const prefill = useMemo(
    () => (lastDelivery && regions.length ? prefillFromLastDelivery(lastDelivery, regions) : null),
    [lastDelivery, regions],
  )
  const appliedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!prefill || !lastDelivery) return
    const key = `${thread.key}:${lastDelivery.id}`
    if (appliedFor.current === key) return
    appliedFor.current = key
    onPrefill(prefill.fields)
  }, [prefill, lastDelivery, thread.key, onPrefill])

  // A customer with an order still open is adding to it, not starting over: the new
  // item rides with that order (same drop, same day, same address) and is saved
  // linked to it. Only the earliest root order still ahead, in this business, is the
  // target so every add-on shares it; past-dated or other-business orders never are.
  const openOrders = record?.openOrders ?? []
  const orderBusiness = operation.business || pageCode || null
  // The order being replaced: the AI's pick, else the earliest order on this
  // number carrying the same product. Shown in the history as "replacing this".
  // A trade-in comes back FROM a different item, so its source is the AI's pick,
  // else the newest past-dated order on this number (the one they are holding).
  const today = todayInMauritius()
  const exchangeOf = isExchange
    ? openOrders.find(o => o.id === draft.sourceDeliveryId)
      ?? (product ? openOrders.find(o => (o.products ?? '').trim().toLowerCase() === product.name.trim().toLowerCase()) : undefined)
      ?? null
    : isTradeIn
      ? openOrders.find(o => o.id === draft.sourceDeliveryId)
        ?? [...openOrders].filter(o => o.deliveryDate && o.deliveryDate.slice(0, 10) < today).sort((a, b) => (b.deliveryDate ?? '').localeCompare(a.deliveryDate ?? ''))[0]
        ?? null
      : null
  // Trade-in money, the house rule: credit = what they paid for the item coming
  // back; the door figure is the difference and may be a payout. The server
  // recomputes this from the source row, so the browser figure is display only.
  const tradeIn = isTradeIn && exchangeOf
    ? settle({ kind: 'trade_in', orderAmount: exchangeOf.amount, orderQty: exchangeOf.qty, returnQty: Math.max(1, exchangeOf.qty ?? 1), outValue, allowance: 0 })
    : null
  const amount = isTradeIn ? tradeIn?.amount ?? 0 : outValue
  const addOnTarget = created || isFollowUp ? null : primaryOpenOrder(openOrders, today, orderBusiness)
  const addOnPrefill = useMemo(
    () => (addOnTarget && regions.length ? prefillFromOpenOrder(addOnTarget, regions) : null),
    [addOnTarget, regions],
  )
  const addOnAppliedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!addOnPrefill || !addOnTarget) return
    const key = `${thread.key}:${addOnTarget.id}`
    if (addOnAppliedFor.current === key) return
    addOnAppliedFor.current = key
    onPrefill(addOnPrefill)
  }, [addOnPrefill, addOnTarget, thread.key, onPrefill])
  // Same product as an open line is the duplicate case, not an add-on.
  // (An exchange is the same product by definition, so it is never a duplicate.)
  const sameAsOpen = !isFollowUp && Boolean(product) && openOrders.some(o => (o.products ?? '').trim().toLowerCase() === product!.name.trim().toLowerCase())
  const addingTo = addOnTarget && product && !sameAsOpen ? addOnTarget : null

  // --- Changing an order that already exists ------------------------------
  // The order this conversation is about: the open row carrying the same
  // product, else the only open root order on the number. Past-dated pending
  // rows count here (rescheduling one is exactly the point), unlike the
  // add-on target which must still be ahead.
  const amendTarget = created || isFollowUp
    ? null
    : (product ? openOrders.find(o => (o.products ?? '').trim().toLowerCase() === product.name.trim().toLowerCase()) : undefined)
      ?? (() => {
        // No product match (the item itself may be what is changing), so fall
        // back to the one open order this chat can only mean. Add-ons follow
        // their root, and the other business's orders are not this chat's.
        const roots = openOrders.filter(o => !o.parentDeliveryId && (!orderBusiness || !o.business || o.business === orderBusiness))
        return roots.length === 1 ? roots[0] : null
      })()
      ?? null
  // While adding a SECOND item, the quantity and product describe that new
  // item, not the open row - only the shared day and address may move.
  const amendments = useMemo(() => amendTarget ? detectAmendments({
    open: { deliveryDate: amendTarget.deliveryDate, qty: amendTarget.qty, locality: amendTarget.locality, products: amendTarget.products },
    next: {
      deliveryDate: draft.deliveryDate,
      qty: addingTo ? Number(amendTarget.qty ?? 0) : draft.qty,
      region: draft.region,
      productName: addingTo ? null : product?.name ?? null,
    },
    text: messageText,
    regions,
  }) : [], [amendTarget, addingTo, draft.deliveryDate, draft.qty, draft.region, product, messageText, regions])

  // Fields the message states are ticked for the agent; the rest are theirs to
  // decide. Keyed by what is on offer so a new draft re-proposes cleanly.
  const [amendChoice, setAmendChoice] = useState<Partial<Record<AmendableField, boolean>>>({})
  const amendKey = `${thread.key}|${amendTarget?.id ?? ''}|${amendments.map(a => `${a.field}:${a.to}:${a.confirmed}`).join(',')}`
  const amendKeyRef = useRef(amendKey)
  if (amendKeyRef.current !== amendKey) { amendKeyRef.current = amendKey; if (Object.keys(amendChoice).length) setAmendChoice({}) }
  const isPicked = (a: Amendment) => amendChoice[a.field] ?? a.confirmed
  const picked = amendments.filter(isPicked)

  // The composer labels its own button ("Update order & send"), and it renders
  // BEFORE this panel, so the controller ref it could read would always be one
  // render behind. Report the choice upward instead.
  const pickedLabels = picked.map((a) => amendmentLabel(a.field)).join(', ')
  useEffect(() => { onAmendmentsChange?.(pickedLabels) }, [pickedLabels, onAmendmentsChange])

  const applyAmendments = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!amendTarget || !picked.length) return { ok: true }
    const payload: Record<string, unknown> = { id: amendTarget.id, contact1: draft.contact1.trim() }
    for (const a of picked) {
      if (a.field === 'deliveryDate') payload.deliveryDate = a.value
      if (a.field === 'qty') payload.qty = a.value
      if (a.field === 'region') payload.region = a.value
      if (a.field === 'product') payload.products = a.value
    }
    try {
      const res = await fetch('/api/inbox/order-amendment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const json = (await res.json()) as { success: boolean; error?: string; changed?: string[]; movedAddOns?: number }
      if (!json.success) {
        toast({ title: 'Order not changed', description: json.error ?? 'Unknown error', variant: 'destructive' })
        return { ok: false, error: json.error ?? 'Unknown error' }
      }
      await mutateRecord()
      toast({
        title: 'Order updated',
        description: `${describeAmendments(picked)}${json.movedAddOns ? ` · ${json.movedAddOns} item${json.movedAddOns === 1 ? '' : 's'} riding with it moved too` : ''}`,
      })
      return { ok: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Network error'
      toast({ title: 'Order not changed', description: error, variant: 'destructive' })
      return { ok: false, error }
    }
  }
  // The new total is that drop's: the root plus add-ons already riding with it.
  const openTotal = addingTo
    ? openOrders.filter(o => o.id === addingTo.id || o.parentDeliveryId === addingTo.id).reduce((sum, o) => sum + o.amount, 0)
    : 0

  const set = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) =>
    onChange({ ...draft, [key]: value }, key)

  // Keep the exchange pointed at the order it replaces once the history loads.
  const exchangeOfId = exchangeOf?.id ?? null
  useEffect(() => {
    if (isFollowUp && exchangeOfId && draft.sourceDeliveryId !== exchangeOfId) onChange({ ...draft, sourceDeliveryId: exchangeOfId }, 'sourceDeliveryId')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the draft object changes every keystroke; only the link matters here
  }, [isFollowUp, exchangeOfId, draft.sourceDeliveryId])

  const missing: string[] = []
  // Without the order the item came from there is no paid figure to credit.
  if (isTradeIn && !exchangeOf) missing.push('the past order the item comes from')
  if (!draft.customerName.trim()) missing.push('name')
  if (!draft.contact1.trim()) missing.push('phone')
  if (!draft.region.trim()) missing.push('locality')
  if (!product) missing.push('product')
  if (!business) missing.push('business')
  // Catch a Sunday/holiday HERE so the agent picks again before promising it -
  // the server refuses such a date rather than moving it behind their back.
  const closedDay = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.deliveryDate)
    if (!m) return null
    const holidays = (data?.settings?.holidays || []) as Array<Holiday & { label?: string }>
    if (!isNonWorkingDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), holidays)) return null
    const hit = holidays.find(h => draft.deliveryDate >= h.start && draft.deliveryDate <= (h.end || h.start))
    return hit?.label || 'a Sunday'
  })()
  if (closedDay) missing.push(`another delivery date (${deliveryDayLabel(draft.deliveryDate)} is ${closedDay})`)

  const submit = async (): Promise<{ ok: boolean; error?: string }> => {
    if (created) return { ok: true }
    if (missing.length || !product) return { ok: false, error: `Still need: ${missing.join(', ')}` }
    if (saving || submitting.current) return { ok: false, error: 'An order is already being created.' }
    submitting.current = true
    setSaving(true)
    try {
      const res = await fetch('/api/extension', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: draft.customerName.trim(),
          contact1: draft.contact1.trim(),
          contact2: draft.contact2.trim(),
          region: draft.region,
          products: product.name,
          qty: draft.qty,
          amount,
          deliveryDate: draft.deliveryDate || undefined,
          notes: draft.notes.trim(),
          // Ties the order back to the ad that produced the lead, so the
          // campaign gets credit for the sale without anyone typing an id.
          adId: thread.adId ?? undefined,
          pageCode: business,
          salesType: draft.salesType,
          // The faulty unit the rider collects, and the delivered order it came
          // from; the server re-checks that order belongs to this phone.
          returnProduct: isExchange ? product.name : isTradeIn && exchangeOf ? composeReturnLine(exchangeOf.products ?? '', Math.max(1, exchangeOf.qty ?? 1)) : undefined,
          sourceDeliveryId: isFollowUp ? draft.sourceDeliveryId ?? exchangeOf?.id ?? undefined : undefined,
          // Trade-in: the server reads the credit off the source row and settles
          // against this catalogue value; the amount above is display only.
          outValue: isTradeIn ? outValue : undefined,
          returnQty: isTradeIn && exchangeOf ? Math.max(1, exchangeOf.qty ?? 1) : undefined,
          // Links the row to the order it rides with; the server re-checks that
          // order is still open on this phone before accepting the link.
          parentDeliveryId: addingTo?.id,
        }),
      })
      const json = (await res.json()) as {
        success: boolean
        error?: string
        proformaLink?: string | null
      }
      if (!json.success) {
        toast({
          title: 'Order not created',
          description: json.error ?? 'Unknown error',
          variant: 'destructive',
        })
        return { ok: false, error: json.error ?? 'Unknown error' }
      }
      const result = { proformaLink: json.proformaLink ?? null }
      setCreated(result)
      onOrderCreated(result)
      toast({
        title: isExchange ? 'Exchange created' : isTradeIn ? 'Trade-in created' : addingTo ? 'Added to order' : 'Order created',
        description: isExchange
          ? `${product.name} replacement for ${draft.customerName} - the rider collects the faulty unit`
          : isTradeIn
            ? `${draft.qty} × ${product.name} for ${draft.customerName} - the rider collects ${exchangeOf?.products?.trim() || 'the delivered item'}; ${amount > 0 ? `collects Rs ${amount.toLocaleString('en-GB')}` : amount < 0 ? `pays back Rs ${Math.abs(amount).toLocaleString('en-GB')}` : 'nothing to collect'}`
            : addingTo ? `${product.name} rides with ${addingTo.products?.trim() || 'the open order'} for ${draft.customerName}` : `${product.name} for ${draft.customerName}`,
      })
      return { ok: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Network error'
      toast({ title: 'Order not created', description: error, variant: 'destructive' })
      return { ok: false, error }
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  if (controller) {
    controller.current = { readyToCreate: !created && missing.length === 0 && Boolean(product), created: Boolean(created), missing, submit, pendingAmendments: picked, applyAmendments }
  }

  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-l border-border">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <PackagePlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="flex-1 text-sm font-semibold">Quick order</h3>
        {aiPending ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Reading
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* What we already know about this number: past orders and, critically,
            any order still in flight - the guard against two agents raising the
            same order. Falls back to the WhatsApp number until the phone fills. */}
        <CustomerOrderHistory
          exchangeOfId={exchangeOfId}
          phone={draft.contact1}
          waId={thread.channel === 'whatsapp' ? thread.recipientId : null}
          draft={draft}
          localityNotInList={prefill?.localityNotInList ?? false}
          addingToId={addingTo?.id ?? null}
          sameAsOpen={sameAsOpen}
        />

        {/* This reply changes an order that already exists. Ticked items are
            written to that order the moment Send is pressed, so the rider never
            keeps the old day or the old address. Anything the message only ASKS
            about stays unticked with the reason. */}
        {amendments.length ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
            <p className="text-xs font-medium">
              Sending this updates the open order
              {amendTarget?.deliveryDate ? ` of ${deliveryDayLabel(amendTarget.deliveryDate)}` : ''}
            </p>
            <ul className="flex flex-col gap-1.5">
              {amendments.map((a) => (
                <li key={a.field} className="flex items-start gap-2">
                  <Checkbox
                    id={`qo-amend-${a.field}`}
                    className="mt-0.5"
                    checked={isPicked(a)}
                    onCheckedChange={(value) => setAmendChoice((state) => ({ ...state, [a.field]: value === true }))}
                  />
                  <Label htmlFor={`qo-amend-${a.field}`} className="cursor-pointer text-xs font-normal leading-relaxed text-pretty">
                    {amendmentLabel(a.field)}:{' '}
                    <span className="text-muted-foreground line-through">
                      {a.field === 'deliveryDate' ? deliveryDayLabel(a.from) : a.from}
                    </span>{' '}
                    <span className="font-medium">
                      {a.field === 'deliveryDate' ? deliveryDayLabel(String(a.value)) : a.to}
                    </span>
                    {a.hold ? <span className="text-muted-foreground"> — not ticked: {a.hold}</span> : null}
                  </Label>
                </li>
              ))}
            </ul>
            {picked.length ? null : (
              <p className="text-xs text-muted-foreground text-pretty">
                Nothing is ticked, so the order stays as it is and only the message goes out.
              </p>
            )}
          </div>
        ) : null}

        {/* Say plainly what the AI could not resolve. A blank field with no
            explanation reads as a bug; this reads as a decision to confirm. */}
        {unmatched?.product || unmatched?.locality ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-pretty">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            <span>
              The customer said
              {unmatched.product ? ` "${unmatched.product}"` : ''}
              {unmatched.product && unmatched.locality ? ' and' : ''}
              {unmatched.locality ? ` "${unmatched.locality}"` : ''}
              {', which does not match the catalogue. Pick the right one below.'}
            </span>
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-name">Customer name</Label>
          <Input
            id="qo-name"
            value={draft.customerName}
            onChange={(e) => set('customerName', e.target.value)}
            placeholder="Full name"
          />
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="qo-c1">Phone</Label>
            <Input
              id="qo-c1"
              value={draft.contact1}
              onChange={(e) => set('contact1', e.target.value)}
              placeholder="5xxx xxxx"
              inputMode="tel"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="qo-c2">Alt. phone</Label>
            <Input
              id="qo-c2"
              value={draft.contact2}
              onChange={(e) => set('contact2', e.target.value)}
              placeholder="Optional"
              inputMode="tel"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label id="qo-type-label">Type</Label>
          <div role="radiogroup" aria-labelledby="qo-type-label" className="flex gap-1.5">
            {(['sale', 'exchange', 'trade_in'] as const).map((type) => (
              <Button
                key={type}
                type="button"
                role="radio"
                aria-checked={draft.salesType === type}
                variant={draft.salesType === type ? 'default' : 'outline'}
                size="sm"
                onClick={() => onChange({ ...draft, salesType: type, sourceDeliveryId: type === 'sale' ? null : draft.sourceDeliveryId }, 'salesType')}
              >
                {type === 'sale' ? 'Sale' : type === 'exchange' ? 'Exchange' : 'Trade-in'}
              </Button>
            ))}
          </div>
          {isExchange ? (
            <p className="text-xs text-muted-foreground">Replacement at no charge; the rider brings the new unit and takes the faulty one back.</p>
          ) : null}
          {isTradeIn ? (
            <p className="text-xs text-muted-foreground">
              {exchangeOf
                ? `A different item goes out; the rider collects ${exchangeOf.products?.trim() || 'the delivered item'} and Rs ${exchangeOf.amount.toLocaleString('en-GB')} they paid for it is credited.`
                : 'A different item goes out in place of one already delivered. No past order found on this number yet to read the credit from.'}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-product">Product</Label>
          <Select
            value={draft.productId ?? ''}
            onValueChange={(v) => set('productId', v)}
          >
            <SelectTrigger id="qo-product">
              <SelectValue placeholder="Choose a product" />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {product && offerLabel(product) ? (
            <p className="text-xs text-primary">{offerLabel(product)}</p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <div className="flex w-[110px] flex-col gap-1.5">
            <Label htmlFor="qo-qty">Quantity</Label>
            <Input
              id="qo-qty"
              type="number"
              min={1}
              max={50}
              value={draft.qty}
              onChange={(e) => set('qty', Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="qo-date">Delivery date</Label>
            <Input
              id="qo-date"
              type="date"
              value={draft.deliveryDate}
              onChange={(e) => set('deliveryDate', e.target.value)}
              aria-invalid={Boolean(closedDay)}
            />
          </div>
        </div>
        {closedDay ? (
          <p className="flex items-start gap-2 text-xs text-amber-500">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{deliveryDayLabel(draft.deliveryDate)} is {closedDay} - no deliveries. Pick one of the days below.</span>
          </p>
        ) : null}
        {deliveryOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Next delivery days">
            {deliveryOptions.map((d, i) => {
              const active = draft.deliveryDate === d
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('deliveryDate', d)}
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {deliveryDayLabel(d)}
                  {i === 0 && <span className="sr-only"> (next available)</span>}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-business">Business</Label>
          <Select value={business} onValueChange={setBusiness}>
            <SelectTrigger id="qo-business">
              <SelectValue placeholder="Which business is this order for?" />
            </SelectTrigger>
            <SelectContent>
              {businesses.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!pageCode ? (
            <p className="text-xs text-muted-foreground">
              {thread.channel === 'whatsapp'
                ? 'WhatsApp numbers are not mapped to a business, so pick one.'
                : `No mapping for ${thread.source} - pick the business.`}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-region">Locality</Label>
          <Select value={draft.region} onValueChange={(v) => set('region', v)}>
            <SelectTrigger id="qo-region">
              <SelectValue placeholder="Choose a locality" />
            </SelectTrigger>
            <SelectContent className="max-h-[320px]">
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Confirms the parcel will actually be routed, before the order
              exists. A locality with no contractor is the silent failure. */}
          {routing ? (
            <p className="text-xs text-muted-foreground">
              {/* Labelled, because a bare uppercase name in the form reads as a
                  stray value rather than the resolved delivery route. */}
              <span className="text-muted-foreground/70">Routed to </span>
              <span className="text-foreground">{routing.contractor}</span>
              {routing.rider ? ` · ${routing.rider}` : ''}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qo-notes">Notes</Label>
          <Textarea
            id="qo-notes"
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className="resize-none"
            placeholder="Delivery instructions"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-4">
        {product ? (
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">
              {draft.qty} × {product.name}
            </span>
            <span className="flex items-baseline gap-2">
              {saved > 0 ? (
                <span className="text-xs text-muted-foreground line-through tabular-nums">
                  Rs{unit.toLocaleString()}
                </span>
              ) : null}
              <span className="text-lg font-semibold tabular-nums">
                {isExchange
                  ? 'No charge'
                  : isTradeIn
                    ? amount > 0 ? `Collect Rs${amount.toLocaleString()}` : amount < 0 ? `Pay back Rs${Math.abs(amount).toLocaleString()}` : 'Nothing to collect'
                    : `Rs${amount.toLocaleString()}`}
              </span>
            </span>
          </div>
        ) : null}
        {isExchange && product ? (
          <p className="text-xs text-muted-foreground">Rider collects the faulty {product.name} and hands over the replacement.</p>
        ) : null}
        {isTradeIn && product && tradeIn && exchangeOf ? (
          <p className="text-xs text-muted-foreground">
            Rs{outValue.toLocaleString()} for {draft.qty} × {product.name}, less Rs{tradeIn.credit.toLocaleString()} paid for {exchangeOf.products?.trim() || 'the delivered item'}. Rider collects it back.
          </p>
        ) : null}

        {created ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs text-primary">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {isExchange ? 'Exchange created' : isTradeIn ? 'Trade-in created' : 'Order created'}
            </p>
            {created.proformaLink ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(created.proformaLink!)
                  toast({ title: 'Proforma link copied' })
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Copy proforma link
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onOperationChange(beginAnotherOrder)}>New order for this customer</Button>
          </div>
        ) : (
          <>
            {previousCreated?.proformaLink ? <a href={previousCreated.proformaLink} target="_blank" rel="noopener noreferrer" className="text-center text-xs underline">View previous order confirmation</a> : null}
            <Button onClick={submit} disabled={missing.length > 0 || saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {saving ? (addingTo ? 'Adding...' : 'Creating...') : isExchange ? 'Create exchange' : isTradeIn ? 'Create trade-in' : addingTo ? 'Add to open order' : 'Create order'}
            </Button>
            {missing.length ? (
              <p className="text-center text-xs text-muted-foreground">
                Still need: {missing.join(', ')}
              </p>
            ) : addingTo && product ? (
              <p className="text-center text-xs text-muted-foreground">
                Rides with {addingTo.products?.trim() || 'the open order'}
                {addingTo.deliveryDate ? ` on ${deliveryDayLabel(addingTo.deliveryDate)}` : ''} · order total becomes Rs {(openTotal + amount).toLocaleString('en-GB')}
              </p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
