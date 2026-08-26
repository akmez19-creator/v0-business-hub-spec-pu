'use client'

/**
 * Trade-in / exchange / refund raised against a DELIVERED order.
 *
 * Shape of the form follows the shape of the transaction: what the client is
 * HOLDING on the left, what the rider CARRIES BACK on the right. The delivered
 * item is resolved out of the original order rather than picked again - the
 * client already has it, so offering a dropdown for it invites the agent to
 * name the wrong thing.
 *
 * The outgoing side is a real order line - search, variant, quantity and
 * offer-aware price - because that is exactly what it becomes: a new delivery
 * a rider has to pick and carry.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import useSWR from 'swr'
import { Loader2, ArrowLeftRight, X, Search, Check, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createFollowUpOrder } from '@/lib/followup-actions'
import {
  composeOutLine,
  FOLLOW_UP_HELP,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_LABELS,
  sendsProductOut,
  settle,
  unitPaid,
  type FollowUpKind,
} from '@/lib/orders/follow-up'
import type { ClientOrder } from '@/lib/agent-actions'
import { offerLabel, priceFor, unitPrice, type QuickOrderProduct } from '@/lib/orders/quick-order'
import { parseOrderLines, pricedProductFor } from '@/lib/orders/order-lines'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const rs = (n: number) => `Rs ${Math.abs(n).toLocaleString()}`

export function OrderFollowUp({ order, onDone }: { order: ClientOrder; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<FollowUpKind>('exchange')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useSWR<{ products?: QuickOrderProduct[] }>(
    open ? '/api/extension' : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const products = useMemo(() => data?.products ?? [], [data])

  const [outProductId, setOutProductId] = useState('')
  const [outVariantId, setOutVariantId] = useState('')
  const [outQty, setOutQty] = useState(1)
  const [returnQty, setReturnQty] = useState(1)
  const [search, setSearch] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [allowanceText, setAllowanceText] = useState('')

  const sourceQty = Math.max(1, Number(order.qty ?? 1))
  const perUnit = unitPaid(order.amount, order.qty)

  // The delivered item, mapped back to the catalogue. The stored `products`
  // column is free text ("Name - Red - B1G1"), so it has to be resolved the
  // same way the order editor resolves it.
  const delivered = useMemo(() => {
    if (!products.length) return null
    const [line] = parseOrderLines(order.products, products)
    return line?.product ? { product: line.product, variant: line.variant ?? null } : null
  }, [products, order.products])

  // An exchange is a like-for-like replacement, so the thing going out IS the
  // thing that came back. Pre-mapping it removes the commonest way to get an
  // exchange wrong: sending a different product and calling it a swap.
  useEffect(() => {
    if (kind !== 'exchange') return
    setOutProductId(delivered?.product.id ?? '')
    setOutVariantId(delivered?.variant?.id ?? '')
    setOutQty(returnQty)
  }, [kind, delivered, returnQty])

  const outProduct = products.find((p) => p.id === outProductId) ?? null
  const outVariants = outProduct?.variants ?? []
  const outVariant = outVariants.find((v) => v.id === outVariantId) ?? null
  const outPriced = outProduct ? pricedProductFor(outProduct, outVariant) : null

  // Offer-aware, like every other order line in the system. All 843 active
  // products carry bundle tiers, so flat price x qty overcharges on any of them.
  const outValue = outPriced ? priceFor(outPriced, outQty) : 0
  const straight = outPriced ? unitPrice(outPriced) * outQty : 0
  const saving = straight - outValue

  // Refund is the only kind that still carries a typed figure, and even then it
  // starts at the full sum paid - 7 of the 9 traceable refunds are exactly
  // that, and the 2 partial ones are why the box survives at all. Exchange and
  // trade-in derive their credit inside settle(), which ignores this value.
  const defaultAllowance = perUnit * returnQty
  const allowance =
    kind !== 'refund'
      ? defaultAllowance
      : allowanceText.trim() === ''
        ? defaultAllowance
        : Number(allowanceText) || 0

  const money = settle({
    kind,
    orderAmount: order.amount,
    orderQty: order.qty,
    returnQty,
    outValue,
    allowance,
  })

  const needsOut = sendsProductOut(kind)
  const needsVariant = !!outProduct?.has_variants && !outVariant
  const ready =
    !!date &&
    !!reason.trim() &&
    (!needsOut || (!!outProduct && !needsVariant)) &&
    (kind === 'exchange' || money.credit > 0)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products.slice(0, 40)
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 40)
  }, [products, search])

  function reset() {
    setOutProductId('')
    setOutVariantId('')
    setOutQty(1)
    setAllowanceText('')
    setReason('')
    setReturnQty(1)
    setSearch('')
    setError(null)
  }

  function submit() {
    setError(null)
    start(async () => {
      const res = await createFollowUpOrder({
        sourceOrderId: order.id,
        kind,
        outProductId: needsOut ? outProductId : null,
        outVariantId: needsOut ? outVariantId || null : null,
        outQty,
        returnQty,
        allowance,
        deliveryDate: date,
        reason: reason.trim(),
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      reset()
      onDone()
    })
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />
        Trade-in / Refund
      </Button>
    )
  }

  const deliveredLabel =
    delivered
      ? `${delivered.product.name}${delivered.variant ? ` - ${delivered.variant.attribute_value}` : ''}`
      : order.products || 'Item from original order'

  return (
    <div className="mt-3 w-full rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium">Trade-in, exchange or refund</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false)
            reset()
          }}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>What is happening</Label>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k)
                  setAllowanceText('')
                  setError(null)
                  if (k !== 'exchange') {
                    setOutProductId('')
                    setOutVariantId('')
                    setOutQty(1)
                  }
                }}
                className={[
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  kind === k
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {FOLLOW_UP_LABELS[k]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{FOLLOW_UP_HELP[kind]}</p>
        </div>

        {/* Coming back: read off the delivered order, never picked. */}
        <div className="rounded-md border border-border bg-card p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Undo2 className="h-3.5 w-3.5" />
            Coming back from the client
          </div>
          <p className="text-sm font-medium">{deliveredLabel}</p>
          <p className="text-xs text-muted-foreground">
            Paid {rs(perUnit)} each
            {sourceQty > 1 ? ` - ${sourceQty} delivered` : ''}
          </p>

          {sourceQty > 1 && (
            <div className="mt-2.5 flex items-center gap-2">
              <Label htmlFor="fu-rqty" className="text-xs font-normal text-muted-foreground">
                How many back
              </Label>
              <Input
                id="fu-rqty"
                type="number"
                min={1}
                max={sourceQty}
                value={returnQty}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value) || 1)
                  setReturnQty(Math.min(sourceQty, Math.max(1, n)))
                }}
                className="h-8 w-20"
              />
              <span className="text-xs text-muted-foreground">of {sourceQty}</span>
            </div>
          )}
        </div>

        {needsOut && (
          <div className="rounded-md border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {kind === 'exchange' ? 'Replacement going out' : 'New item going out'}
            </div>

            {kind === 'exchange' ? (
              // Locked to the same item on purpose: swapping for something else
              // is a trade-in, and it is priced completely differently.
              <p className="text-sm font-medium">
                {deliveredLabel}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  same item, replaced
                </span>
              </p>
            ) : outProduct ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{outProduct.name}</span>
                {offerLabel(outPriced) && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                    {offerLabel(outPriced)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setOutProductId('')
                    setOutVariantId('')
                    setSearch('')
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={isLoading ? 'Loading catalogue...' : 'Search products'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-8"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border border-border">
                  {filtered.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {isLoading ? 'Loading...' : 'No product matches that'}
                    </p>
                  )}
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setOutProductId(p.id)
                        setOutVariantId('')
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {rs(unitPrice(p))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {outProduct && outVariants.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5">
                <Label className="text-xs font-normal text-muted-foreground">
                  {outVariants[0]?.attribute_name || 'Option'}
                </Label>
                <Select value={outVariantId} onValueChange={setOutVariantId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {outVariants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.attribute_value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {outProduct && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Label htmlFor="fu-oqty" className="text-xs font-normal text-muted-foreground">
                  Quantity
                </Label>
                <Input
                  id="fu-oqty"
                  type="number"
                  min={1}
                  value={outQty}
                  onChange={(e) =>
                    setOutQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                  className="h-8 w-20"
                  disabled={kind === 'exchange'}
                />
                <span className="text-sm">
                  {rs(outValue)}
                  {saving > 0 && (
                    <span className="ml-1.5 text-xs text-primary">saves {rs(saving)}</span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/*
          No input here on purpose. The trade-in credit is what the client paid
          for the item coming back, read off this very order - there is nothing
          for the agent to decide, and a box invites a typed figure that
          silently overrides the real one.
        */}
        {kind === 'trade_in' && (
          <div className="flex flex-col gap-1.5">
            <Label>Credit for the returned item</Label>
            <p className="text-xl font-semibold tabular-nums">{rs(money.credit)}</p>
            {money.credit > 0 ? (
              <p className="text-xs text-muted-foreground">
                What they paid for {returnQty > 1 ? `${returnQty} \u00d7 ` : ''}
                {deliveredLabel}. Taken from this order, so it is not negotiable here.
              </p>
            ) : (
              /* Without this the Create button just greys out with no reason on
                 screen, and a derived Rs 0 looks like a bug rather than a Rs 0
                 order. Mirrors the server's rejection message. */
              <p className="text-xs text-destructive">
                This order was recorded at Rs 0, so there is nothing to credit. Fix the original
                order first, or use Exchange if it is a straight swap.
              </p>
            )}
          </div>
        )}

        {kind === 'refund' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fu-refund">Amount to give back</Label>
            <Input
              id="fu-refund"
              inputMode="numeric"
              placeholder={String(perUnit * returnQty)}
              value={allowanceText}
              onChange={(e) => setAllowanceText(e.target.value)}
              className="w-40"
            />
            <p className="text-xs text-muted-foreground">
              Full refund is {rs(perUnit * returnQty)}. Enter less for a partial refund; it
              cannot exceed what was paid.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fu-date">Date to collect</Label>
            <Input
              id="fu-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fu-reason">Why</Label>
          <Input
            id="fu-reason"
            placeholder="Faulty motor, wrong size, client changed mind..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* The doorstep instruction, in words. A signed number alone is how a
            rider collects money that should have been paid out. */}
        <div className="rounded-md border border-border bg-card px-3 py-2.5">
          {money.direction === 'nothing' ? (
            <p className="text-sm font-medium">Straight swap - no money changes hands</p>
          ) : money.direction === 'collect' ? (
            <p className="text-sm font-medium">
              Rider collects <span className="text-primary">{rs(money.amount)}</span> from the
              client
            </p>
          ) : (
            <p className="text-sm font-medium">
              Rider pays <span className="text-destructive">{rs(money.amount)}</span> back to the
              client
            </p>
          )}
          {kind === 'trade_in' && outProduct && (
            <p className="mt-1 text-xs text-muted-foreground">
              {rs(money.outValue)} for {composeOutLine({
                productName: outProduct.name,
                variantValue: outVariant?.attribute_value ?? null,
                isB1g1: outPriced?.is_b1g1,
                qty: outQty,
              })}, less the {rs(money.credit)} they paid for the old one
            </p>
          )}
          {needsVariant && (
            <p className="mt-1 text-xs text-destructive">
              Choose which {outProduct?.name} is going out
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" onClick={submit} disabled={pending || !ready}>
            {pending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Schedule {FOLLOW_UP_LABELS[kind].toLowerCase()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false)
              reset()
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
