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

import { useEffect, useMemo, useState } from 'react'
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
import { offerLabel, priceFor, unitPrice, type QuickOrderProduct } from '@/lib/orders/quick-order'
import type { UnifiedThread } from '@/lib/inbox/unified'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export type OrderDraft = {
  customerName: string
  contact1: string
  contact2: string
  region: string
  productId: string | null
  qty: number
  notes: string
  deliveryDate: string
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
}

export function QuickOrderPanel({
  thread,
  draft,
  onChange,
  aiPending,
  unmatched,
  onOrderCreated,
}: {
  thread: UnifiedThread
  draft: OrderDraft
  onChange: (next: OrderDraft) => void
  /** The AI is still reading the thread, so fields may yet fill in. */
  aiPending: boolean
  /** Values the AI read but could not match to the catalogue. */
  unmatched?: { product: string | null; locality: string | null } | null
  onOrderCreated: (result: { proformaLink: string | null }) => void
}) {
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{ proformaLink: string | null } | null>(null)
  const { toast } = useToast()

  // Same endpoint and payload the extension loads, so the catalogue, the
  // locality list and the pricing rules can never drift between the two.
  const { data } = useSWR<{
    authenticated?: boolean
    products?: QuickOrderProduct[]
    regions?: string[]
    regionDelivery?: Record<string, { contractor: string; rider: string | null }>
  }>('/api/extension', fetcher, { revalidateOnFocus: false })

  const products = data?.products ?? []
  const regions = data?.regions ?? []

  // A new lead is a new order: never let the previous customer's success
  // banner sit above a different person's form.
  useEffect(() => {
    setCreated(null)
  }, [thread.key])

  const product = useMemo(
    () => products.find((p) => p.id === draft.productId) ?? null,
    [products, draft.productId],
  )

  const amount = product ? priceFor(product, draft.qty) : 0
  const unit = unitPrice(product) * draft.qty
  const saved = unit - amount

  const routing = draft.region ? data?.regionDelivery?.[draft.region] : undefined

  const set = <K extends keyof OrderDraft>(key: K, value: OrderDraft[K]) =>
    onChange({ ...draft, [key]: value })

  const missing: string[] = []
  if (!draft.customerName.trim()) missing.push('name')
  if (!draft.contact1.trim()) missing.push('phone')
  if (!draft.region.trim()) missing.push('locality')
  if (!product) missing.push('product')

  const submit = async () => {
    if (missing.length || saving || !product) return
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
          salesType: 'sale',
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
        return
      }
      const result = { proformaLink: json.proformaLink ?? null }
      setCreated(result)
      onOrderCreated(result)
      toast({ title: 'Order created', description: `${product.name} for ${draft.customerName}` })
    } catch (e) {
      toast({
        title: 'Order not created',
        description: e instanceof Error ? e.message : 'Network error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-l border-border">
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
            />
          </div>
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
              {routing.contractor}
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
              <span className="text-lg font-semibold tabular-nums">Rs{amount.toLocaleString()}</span>
            </span>
          </div>
        ) : null}

        {created ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs text-primary">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Order created
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
          </div>
        ) : (
          <>
            <Button onClick={submit} disabled={missing.length > 0 || saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {saving ? 'Creating...' : 'Create order'}
            </Button>
            {missing.length ? (
              <p className="text-center text-xs text-muted-foreground">
                Still need: {missing.join(', ')}
              </p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
