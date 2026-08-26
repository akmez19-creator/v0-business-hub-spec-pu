'use client'

/**
 * Editing one existing order from the agent's Overview.
 *
 * Every value an agent can set here is chosen from a list, never typed. The
 * product list, the locality list and the pricing all come from the same
 * `/api/extension` payload and the same `lib/orders/quick-order` module that
 * the Chrome extension and the Quick Order panel use, so an amended order can
 * never disagree with how it was raised.
 *
 * One delivery row is one product: the extension creates a separate delivery
 * per product (content.js "Build one line per product"), and all 3,820 open
 * orders are single-product. So this edits a single product, exactly like the
 * form that created it.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import useSWR from 'swr'
import { Loader2, AlertTriangle, X, Pencil, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RegionTypeahead } from '@/components/dashboard/region-typeahead'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  cancelOrderAsAgent,
  setFreeItemAsAgent,
  updateOrderAsAgent,
  type ClientOrder,
  type OrderEdit,
} from '@/lib/agent-actions'
import {
  offerLabel,
  priceFor,
  unitPrice,
  type QuickOrderProduct,
  type QuickOrderVariant,
} from '@/lib/orders/quick-order'
import { parseOrderLines, pricedProductFor } from '@/lib/orders/order-lines'
import { OrderFollowUp } from '@/components/dashboard/order-follow-up'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  assigned: 'bg-primary/10 text-primary',
  picked_up: 'bg-primary/10 text-primary',
  delivered: 'bg-success/10 text-success',
  nwd: 'bg-destructive/10 text-destructive',
  cms: 'bg-warning/10 text-warning',
  cancelled: 'bg-destructive/10 text-destructive',
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  nwd: 'Not wanted',
  cms: 'With CS',
  cancelled: 'Cancelled',
}

function money(v: number | null) {
  if (v === null || v === undefined) return '-'
  return `Rs ${Number(v).toLocaleString('en-MU')}`
}

/** Column names are storage detail; agents read the field they changed. */
const FIELD_TEXT: Record<string, string> = {
  products: 'Product',
  qty: 'Quantity',
  amount: 'Amount',
  locality: 'Region',
  delivery_date: 'Delivery date',
  status: 'Status',
}

/** "today 13:33" beats a full timestamp when an order is edited minutes apart. */
function whenText(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `today ${time}`
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return `yesterday ${time}`
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${time}`
}

export function AgentOrderEditor({
  order,
  onDone,
}: {
  order: ClientOrder
  onDone: () => void
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'cancel'>('view')
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const { data, isLoading, mutate } = useSWR<{
    products?: QuickOrderProduct[]
    regions?: string[]
    regionDelivery?: Record<string, { contractor: string; rider: string | null }>
  }>(mode === 'edit' ? '/api/extension' : null, fetcher, { revalidateOnFocus: false })

  const products = useMemo(() => data?.products ?? [], [data])
  const regions = useMemo(() => data?.regions ?? [], [data])

  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [qty, setQty] = useState(order.qty && order.qty > 0 ? order.qty : 1)
  const [locality, setLocality] = useState(order.locality ?? '')
  const [date, setDate] = useState(order.delivery_date ?? '')
  const [reason, setReason] = useState('')
  const [customAmount, setCustomAmount] = useState(false)
  const [amountText, setAmountText] = useState('')
  /** The order was written with B1G1 for a product that no longer carries it. */
  const [honouredOffer, setHonouredOffer] = useState(false)
  /** The stored text matched no catalogue product - the agent must choose one. */
  const [unmatchedText, setUnmatchedText] = useState<string | null>(null)
  /** Variant chosen as the B1G1 free unit, saved as its own Rs 0 row. */
  const [freeItemId, setFreeVariantId] = useState('')
  /**
   * Whether the agent actually touched the free-unit picker. The existing gift
   * row is not loaded into this editor, so an untouched picker reads "Not
   * chosen yet" even when a gift is already recorded. Without this flag a
   * routine edit (a date, a region) would silently delete a free unit the
   * client was promised.
   */
  const [freeTouched, setFreeTouched] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // The stored `products` column is free text, so it has to be resolved back to
  // a catalogue id before the dropdown can show the current value. Runs once
  // the catalogue arrives; before that every lookup would fail.
  useEffect(() => {
    if (mode !== 'edit' || !products.length) return
    const [line] = parseOrderLines(order.products, products)
    if (line?.product) {
      setProductId(line.product.id)
      setVariantId(line.variant?.id ?? '')
      setHonouredOffer(!!line.offerHonoured)
      setUnmatchedText(null)
    } else {
      setProductId('')
      setVariantId('')
      setHonouredOffer(false)
      setUnmatchedText(order.products || null)
    }
  }, [mode, products, order.products])

  // Measured on live data: 14 open orders store a region that differs from the
  // canonical spelling only by case. Left alone they would be written back in
  // the wrong case and counted as a "change", so they are snapped on open.
  // Genuine typos (8 more: "M0oka", "rose hi", "troi") are left visible in the
  // box for the agent to correct - never silently guessed at.
  useEffect(() => {
    if (mode !== 'edit' || !regions.length) return
    const stored = (order.locality ?? '').trim()
    if (!stored) return
    const insensitive = regions.find((r) => r.toLowerCase() === stored.toLowerCase())
    if (insensitive && insensitive !== stored) setLocality(insensitive)
  }, [mode, regions, order.locality])

  const isKnownRegion = useMemo(() => {
    const v = locality.trim().toLowerCase()
    return !!v && regions.some((r) => r.toLowerCase() === v)
  }, [locality, regions])

  const product = products.find((p) => p.id === productId) ?? null
  const variants = product?.variants ?? []
  const variant = variants.find((v) => v.id === variantId) ?? null
  const priced = product ? pricedProductFor(product, variant) : null

  // Offer-aware. priceFor() walks the bundle tiers as a cheapest-combination,
  // and deliberately does not discount B1G1 - the free unit is bonus stock, so
  // the client still pays for the units ordered.
  const autoAmount = priced ? priceFor(priced, qty) : 0
  const straight = priced ? unitPrice(priced) * qty : 0
  const saving = straight - autoAmount
  const effectiveAmount = customAmount && amountText.trim() !== '' ? Number(amountText) : autoAmount

  const routing = locality ? data?.regionDelivery?.[locality] : undefined
  const label = priced ? offerLabel(priced) : ''

  /** Rebuilt in the extension's wire format so the picking list still parses it. */
  function composeProducts() {
    if (!product) return order.products ?? ''
    let name = variant ? `${product.name} - ${variant.attribute_value}` : product.name
    // The flag drives whether a free unit goes in the box, so it must survive
    // an edit even after the offer was withdrawn from the catalogue.
    if (priced?.is_b1g1 || (honouredOffer && product.id === productId)) name += ' - B1G1'
    return qty > 1 ? `${name} x${qty}` : name
  }

  function beginEdit() {
    setQty(order.qty && order.qty > 0 ? order.qty : 1)
    setLocality(order.locality ?? '')
    setDate(order.delivery_date ?? '')
    setCustomAmount(false)
    setAmountText('')
    setFreeVariantId('')
    setFreeTouched(false)
    setReason('')
    setMessage(null)
    setWarning(null)
    setMode('edit')
  }

  function save() {
    if (!product) {
      setMessage('Choose a product from the list before saving.')
      return
    }
    if (!locality.trim()) {
      setMessage('Choose a region from the list before saving.')
      return
    }
    // The box accepts typing, so it also accepts a typo. Saving one is how a
    // parcel ends up in a region no contractor covers, so the value must be a
    // real region - the agent picks from the suggestions to clear this.
    if (!isKnownRegion) {
      setMessage(`"${locality.trim()}" is not a region - choose one from the suggestions.`)
      return
    }
    start(async () => {
      const res = await updateOrderAsAgent(
        order.id,
        {
          products: composeProducts(),
          qty,
          amount: effectiveAmount,
          locality,
          delivery_date: date || null,
        },
        reason,
      )
      if ('error' in res && res.error) {
        setMessage(res.error)
        return
      }

      // Only sent when the agent actually used the picker. The gift row is not
      // loaded here, so an untouched picker must never be read as "no gift".
      let freeChanged = 0
      if (freeTouched) {
        const freeRes = await setFreeItemAsAgent(order.id, freeItemId || null, reason)
        if ('error' in freeRes && freeRes.error) {
          setMessage(freeRes.error)
          return
        }
        freeChanged = freeRes.changed ?? 0
      }

      if (res.changed === 0 && freeChanged === 0) {
        setMessage('Nothing was different, so no change was saved.')
        return
      }
      if (res.riderNeedsReview) {
        setWarning('Region changed on an order a rider already has - dispatch may need to reassign.')
      }
      setMode('view')
      onDone()
    })
  }

  function doCancel() {
    start(async () => {
      const res = await cancelOrderAsAgent(order.id, reason)
      if ('error' in res && res.error) {
        setMessage(res.error)
        return
      }
      setMode('view')
      onDone()
    })
  }

  const isCancelled = order.status === 'cancelled'
  /** The client physically has the goods - the precondition for a trade-in. */
  const isDelivered = order.status === 'delivered'

  // One save writes one log row PER FIELD, so a single change of product + qty
  // + amount is three rows sharing a timestamp. Grouped back into saves, or the
  // history reads as three separate edits by the same person a second apart.
  const saves = useMemo(() => {
    const groups = new Map<
      string,
      { at: string; who: string; reason: string | null; fields: OrderEdit[] }
    >()
    for (const e of order.edits ?? []) {
      // The cancellation is already shown as "Cancelled: reason" above.
      if (e.field === 'status' && e.new_value === 'cancelled') continue
      // Keyed on the timestamp as text: the same save must collapse to one
      // entry, and a Date object would key by identity and never match.
      const key = String(e.created_at)
      const g = groups.get(key) ?? {
        at: key,
        who: e.changed_by_name ?? 'someone',
        reason: e.reason,
        fields: [],
      }
      g.fields.push(e)
      groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1))
  }, [order.edits])

  const lastEdit = saves[0]

  // "Cancelled: Duplicate" with no name is the same blind spot as "by Hanna" -
  // on this client three orders were cancelled and the screen never said who.
  const cancelledBy = useMemo(() => {
    const row = (order.edits ?? []).find(
      (e) => e.field === 'status' && e.new_value === 'cancelled',
    )
    return row ? { who: row.changed_by_name ?? 'someone', at: row.created_at } : null
  }, [order.edits])

  return (
    <div className={`rounded-lg border border-border p-3 ${isCancelled ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${isCancelled ? 'line-through' : ''}`}>
            {order.products || 'No product listed'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {order.qty ? `${order.qty} x ` : ''}
            {money(order.amount)}
            {order.locality ? ` - ${order.locality}` : ''}
            {order.delivery_date ? ` - ${order.delivery_date}` : ''}
            {order.agent_name ? ` - taken by ${order.agent_name}` : ''}
          </p>
          {order.cancel_reason && (
            <p className="mt-1 text-xs text-destructive">
              Cancelled: {order.cancel_reason}
              {cancelledBy ? ` - by ${cancelledBy.who}, ${whenText(cancelledBy.at)}` : ''}
            </p>
          )}
          {lastEdit && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-xs text-warning hover:underline"
              >
                <History className="h-3 w-3" />
                {`Changed by ${lastEdit.who} - ${whenText(lastEdit.at)}`}
                {saves.length > 1 ? ` (${saves.length} changes)` : ''}
              </button>
              {showHistory && (
                <ul className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-border pl-2">
                  {saves.map((s) => (
                    <li key={s.at} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{s.who}</span>
                      {` - ${whenText(s.at)}`}
                      {s.reason ? ` - "${s.reason}"` : ''}
                      <ul className="mt-0.5">
                        {s.fields.map((f, i) => (
                          <li key={i}>
                            {FIELD_TEXT[f.field] ?? f.field}: {f.old_value || 'empty'}
                            {' -> '}
                            {f.new_value || 'empty'}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            STATUS_TONE[order.status] ?? 'bg-muted text-muted-foreground'
          }`}
        >
          {STATUS_TEXT[order.status] ?? order.status}
        </span>
      </div>

      {mode === 'view' && !isCancelled && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={beginEdit}>
            <Pencil className="mr-1 h-3 w-3" /> Change
          </Button>
          {/* Cancelling is only offered while the goods are still with us.
              cancelOrderAsAgent refuses a delivered order outright, so showing
              the button there was a guaranteed error message - the client
              already has the item, and taking it back is a trade-in or a
              refund, not a cancellation. */}
          {!isDelivered && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                setReason('')
                setMessage(null)
                setMode('cancel')
              }}
            >
              <X className="mr-1 h-3 w-3" /> Cancel order
            </Button>
          )}
          {isDelivered && <OrderFollowUp order={order} onDone={onDone} />}
        </div>
      )}

      {mode === 'edit' && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading catalogue...
            </p>
          ) : (
            <>
              {unmatchedText && (
                <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {'"'}
                    {unmatchedText}
                    {'"'} is not in the catalogue under that name, so nothing is preselected. Pick
                    the right product below - the order keeps its old text until you do.
                  </span>
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`prod-${order.id}`}>Product</Label>
                <Select
                  value={productId}
                  onValueChange={(v) => {
                    setProductId(v)
                    setVariantId('')
                  }}
                >
                  <SelectTrigger id={`prod-${order.id}`}>
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
                <div className="flex flex-wrap gap-2">
                  {label && <span className="text-xs text-primary">{label}</span>}
                  {honouredOffer && (
                    <span className="text-xs text-warning">
                      B1G1 honoured - offer since withdrawn, kept for this order
                    </span>
                  )}
                </div>
              </div>

              {variants.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`var-${order.id}`}>
                    {variants[0].attribute_name || 'Variety'}
                  </Label>
                  <Select value={variantId} onValueChange={setVariantId}>
                    <SelectTrigger id={`var-${order.id}`}>
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {/* A model quantity of 0 means NOBODY COUNTED IT, not
                          "none left" - product_variants has no last_counted_at,
                          so the column cannot tell the two apart. Calling it
                          "sold out" told agents a stocked model was empty (66W
                          Powerbank has 11 in zone D with all 3 models at 0).
                          Only a positive count is real information. */}
                      {variants.map((v: QuickOrderVariant) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.attribute_value}
                          {typeof v.quantity === 'number' && v.quantity > 0
                            ? ` (${v.quantity} left)`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* B1G1 gives a second unit of THE SAME product free, so the only
                  question is which model - hence this product's models and no
                  others. Saved as its own Rs 0 row so stock deducts it without
                  it counting as a second order. A product with no models has
                  nothing to ask, so no picker is shown. */}
              {(priced?.is_b1g1 || honouredOffer) && variants.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2.5">
                  <Label htmlFor={`free-${order.id}`} className="text-warning">
                    Free model (B1G1)
                  </Label>
                  <Select
                    value={freeItemId || 'none'}
                    onValueChange={(v) => {
                      setFreeVariantId(v === 'none' ? '' : v)
                      setFreeTouched(true)
                    }}
                  >
                    <SelectTrigger id={`free-${order.id}`}>
                      <SelectValue placeholder="Not chosen yet" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      <SelectItem value="none">Not chosen yet</SelectItem>
                      {/* Same rule as above: an uncounted model must never be
                          unselectable, or the gift cannot be recorded at all. */}
                      {variants.map((v: QuickOrderVariant) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.attribute_value}
                          {typeof v.quantity === 'number' && v.quantity > 0
                            ? ` (${v.quantity} left)`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Ships as a separate Rs 0 line on this order.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <div className="flex w-[110px] flex-col gap-1.5">
                  <Label htmlFor={`qty-${order.id}`}>Quantity</Label>
                  <Select value={String(qty)} onValueChange={(v) => setQty(Number(v))}>
                    <SelectTrigger id={`qty-${order.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
                  <Label htmlFor={`date-${order.id}`}>Delivery date</Label>
                  <Input
                    id={`date-${order.id}`}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`loc-${order.id}`}>Region</Label>
                <RegionTypeahead
                  id={`loc-${order.id}`}
                  value={locality}
                  regions={regions}
                  onChange={setLocality}
                  onReload={() => mutate()}
                />
                {/* Free text is how "M0oka" and "rose hi" reached the database
                    in the first place. The typing stays, but an unrecognised
                    region is called out instead of being saved in silence. */}
                {locality.trim() && !isKnownRegion && (
                  <p className="text-xs text-warning">
                    {'"'}
                    {locality.trim()}
                    {'"'} is not in the region list - pick one from the suggestions.
                  </p>
                )}
                {/* A region with no contractor is the silent failure - the
                    parcel simply never gets routed. */}
                {isKnownRegion && (
                  <p className="text-xs text-muted-foreground">
                    {routing
                      ? `Routes to ${routing.contractor}${routing.rider ? ` - ${routing.rider}` : ''}`
                      : 'No contractor covers this region yet - dispatch will have to assign it by hand.'}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Amount</span>
                  <span className="text-base font-semibold">{money(effectiveAmount)}</span>
                </div>
                {saving > 0 && !customAmount && (
                  <p className="text-xs text-success">Bundle price saves {money(saving)}</p>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`amt-override-${order.id}`}
                    checked={customAmount}
                    onCheckedChange={(v) => {
                      const on = v === true
                      setCustomAmount(on)
                      setAmountText(on ? String(autoAmount) : '')
                    }}
                  />
                  <Label
                    htmlFor={`amt-override-${order.id}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Charge a different amount
                  </Label>
                </div>
                {customAmount && (
                  <Input
                    type="number"
                    min={0}
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    aria-label="Custom amount"
                  />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`why-${order.id}`}>Why are you changing this?</Label>
                <Input
                  id={`why-${order.id}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. client asked for a different colour"
                />
              </div>

              {message && <p className="text-xs text-destructive">{message}</p>}

              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={pending || !reason.trim()}>
                  {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Save change
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('view')} disabled={pending}>
                  Never mind
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'cancel' && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            The order stays on record as cancelled. It stops counting as an open order and its
            stock is released, and the client&apos;s rating is not affected.
          </p>
          <Label htmlFor={`cwhy-${order.id}`}>Reason for cancelling</Label>
          <Input
            id={`cwhy-${order.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate of another order"
          />
          {message && <p className="text-xs text-destructive">{message}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={doCancel}
              disabled={pending || !reason.trim()}
            >
              {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Cancel this order
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('view')} disabled={pending}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {warning && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {warning}
        </p>
      )}
    </div>
  )
}
