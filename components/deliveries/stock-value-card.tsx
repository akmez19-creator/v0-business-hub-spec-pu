'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Wallet, AlertTriangle, Check, Search, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fmtMur, fmtMurUnit } from '@/lib/inventory/cost'

interface MissingRow {
  id: string
  name: string | null
  sku: string | null
  category: string | null
  image_url: string | null
  quantity: number
}

interface ValuedRow {
  id: string
  name: string | null
  sku: string | null
  image_url: string | null
  quantity: number
  unitCost: number
  value: number
  source: 'manual' | 'po'
  poDate: string | null
  poQty: number | null
  poTotal: number | null
  pooledFrom: number
  yuanUnitPrice: number | null
}

interface Payload {
  valuation: {
    valuedCount: number
    valuedUnits: number
    total: number
    missingCount: number
    missingUnits: number
    manualCount: number
  }
  missing: MissingRow[]
  valued: ValuedRow[]
  unzoned: UnzonedRow[]
  unzonedValue: number
}

interface UnzonedRow {
  id: string
  name: string | null
  sku: string | null
  image_url: string | null
  quantity: number
  soldOut: boolean
  /** null when the product has no cost price, so it adds nothing to the total. */
  value: number | null
}

/**
 * What the stock on the shelf is worth, and the products stopping that number
 * from being complete.
 *
 * The missing count is shown as loudly as the total on purpose. Roughly half
 * the products with stock have no purchase history to price them, so a bare
 * total would read as the whole inventory when it covers part of it.
 */
export function StockValueCard() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [zoneOpen, setZoneOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/inventory/costs')
      if (res.status === 401) throw new Error('Your session expired. Sign in again to see stock value.')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Could not work out stock value')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not work out stock value')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const v = data?.valuation

  return (
    <>
      <section
        aria-label="Stock value"
        className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Wallet className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Value of stock on the shelf
            </p>
            {loading ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Working it out…
              </p>
            ) : error ? (
              <p className="mt-1 text-sm text-destructive">{error}</p>
            ) : (
              <>
                <p className="text-2xl font-bold tabular-nums text-foreground">{fmtMur(v?.total ?? 0)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {`${(v?.valuedUnits ?? 0).toLocaleString()} units across ${v?.valuedCount ?? 0} products, at landed cost`}
                  {v?.manualCount ? ` · ${v.manualCount} priced by hand` : ''}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {!loading && !error && (v?.missingCount ?? 0) > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="max-w-[15rem]">
                {`${v!.missingCount} products with stock have no cost price, so ${v!.missingUnits.toLocaleString()} units are not counted above.`}
              </span>
            </p>
          )}
          {!loading && !error && (
            <Button variant={v?.missingCount ? 'default' : 'outline'} onClick={() => setOpen(true)}>
              {v?.missingCount ? `Add ${v.missingCount} cost prices` : 'Cost prices'}
            </Button>
          )}
          {error && (
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          )}
        </div>
      </section>

      {!loading && !error && (data?.unzoned?.length ?? 0) > 0 && (
        <section
          aria-label="Products with stock but no zone"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-4.5 w-4.5 flex-shrink-0 text-amber-600 dark:text-amber-500"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {`${data!.unzoned.length} products have stock but no zone`}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {`Nothing is holding these ${data!.unzoned
                  .reduce((s, p) => s + p.quantity, 0)
                  .toLocaleString()} units, so they are probably sold out with a quantity nobody cleared. `}
                {data!.unzonedValue > 0
                  ? `They add ${fmtMur(data!.unzonedValue)} to the total above.`
                  : 'None of them carry a cost price, so they add nothing to the total above.'}
              </p>
            </div>
          </div>
          <Button variant="outline" className="flex-shrink-0" onClick={() => setZoneOpen(true)}>
            Review
          </Button>
        </section>
      )}

      <CostPriceDialog open={open} onOpenChange={setOpen} data={data} onSaved={load} />
      <UnzonedDialog open={zoneOpen} onOpenChange={setZoneOpen} rows={data?.unzoned ?? []} />
    </>
  )
}

/**
 * The section for filling in cost prices.
 *
 * Deliberately not one-at-a-time: with ~281 products to price, a dialog per
 * product is the same trap the photo review had. Everything is on one screen
 * and saved in a single pass.
 */
function CostPriceDialog({
  open,
  onOpenChange,
  data,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  data: Payload | null
  onSaved: () => void
}) {
  const [tab, setTab] = useState<'missing' | 'valued'>('missing')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  // Reopening after a save must not resurrect the previous run's typing.
  useEffect(() => {
    if (open) {
      setDraft({})
      setError(null)
      setSavedNote(null)
      setQ('')
    }
  }, [open])

  const missing = data?.missing ?? []
  const valued = data?.valued ?? []

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list: Array<MissingRow | ValuedRow> = tab === 'missing' ? missing : valued
    if (!needle) return list
    return list.filter(r =>
      `${r.name ?? ''} ${r.sku ?? ''}`.toLowerCase().includes(needle),
    )
  }, [tab, missing, valued, q])

  /** Only well-formed, positive entries are offered for saving. */
  const pending = useMemo(
    () =>
      Object.entries(draft)
        .map(([productId, raw]) => ({ productId, raw: raw.trim() }))
        .filter(e => e.raw !== '')
        .map(e => ({ productId: e.productId, cost: Number.parseFloat(e.raw), raw: e.raw })),
    [draft],
  )
  const bad = pending.filter(p => !Number.isFinite(p.cost) || p.cost <= 0)
  const good = pending.filter(p => Number.isFinite(p.cost) && p.cost > 0)

  /** Value the typed costs unlock, so the effect of the work is visible. */
  const pendingValue = useMemo(() => {
    let sum = 0
    for (const p of good) {
      const row = missing.find(m => m.id === p.productId)
      if (row) sum += row.quantity * p.cost
    }
    return sum
  }, [good, missing])

  async function save() {
    if (!good.length) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/inventory/costs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costs: good.map(g => ({ productId: g.productId, cost: g.cost })) }),
      })
      if (res.status === 401) throw new Error('Your session expired. Sign in again - nothing was saved.')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Could not save the cost prices')
      setSavedNote(`${json.saved} cost price${json.saved === 1 ? '' : 's'} saved.`)
      setDraft({})
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the cost prices')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col gap-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Cost prices</DialogTitle>
          <DialogDescription>
            The landed cost of one unit in Rs - what it cost to get here, not what you sell it for. Products with a
            purchase order are priced from it automatically: the order&apos;s total landed cost divided by its quantity.
            Enter the rest by hand.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setTab('missing')}
              className={`rounded px-3 py-1 text-xs font-medium ${
                tab === 'missing' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {`Needs a cost (${missing.length})`}
            </button>
            <button
              type="button"
              onClick={() => setTab('valued')}
              className={`rounded px-3 py-1 text-xs font-medium ${
                tab === 'valued' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {`Already priced (${valued.length})`}
            </button>
          </div>
          <div className="relative min-w-[12rem] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by name or SKU"
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {tab === 'missing'
                ? q
                  ? 'No products match that search.'
                  : 'Every product with stock has a cost price.'
                : 'Nothing priced yet.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="p-2 text-left font-medium">Product</th>
                  <th className="p-2 text-right font-medium">On shelf</th>
                  {tab === 'missing' ? (
                    <>
                      <th className="p-2 text-right font-medium">Cost per unit (Rs)</th>
                      <th className="p-2 text-right font-medium">Value</th>
                    </>
                  ) : (
                    <>
                      <th className="p-2 text-right font-medium">Cost per unit</th>
                      <th className="p-2 text-left font-medium">From</th>
                      <th className="p-2 text-right font-medium">Value</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isMissing = tab === 'missing'
                  const vr = r as ValuedRow
                  const typed = draft[r.id] ?? ''
                  const n = Number.parseFloat(typed)
                  const okTyped = typed.trim() !== '' && Number.isFinite(n) && n > 0
                  const badTyped = typed.trim() !== '' && !okTyped
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {r.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.image_url || '/placeholder.svg'}
                              alt=""
                              className="h-8 w-8 flex-shrink-0 rounded object-cover"
                            />
                          ) : (
                            <span className="h-8 w-8 flex-shrink-0 rounded bg-muted" aria-hidden="true" />
                          )}
                          <span className="line-clamp-2 text-xs font-medium">{r.name || 'Unnamed product'}</span>
                        </div>
                      </td>
                      <td className="p-2 text-right text-xs tabular-nums">{r.quantity.toLocaleString()}</td>
                      {isMissing ? (
                        <>
                          <td className="p-2 text-right">
                            <Input
                              value={typed}
                              onChange={e => setDraft(d => ({ ...d, [r.id]: e.target.value }))}
                              inputMode="decimal"
                              placeholder="0.00"
                              aria-label={`Cost per unit for ${r.name || 'product'}`}
                              aria-invalid={badTyped}
                              className={`ml-auto h-8 w-28 text-right text-xs tabular-nums ${
                                badTyped ? 'border-destructive' : ''
                              }`}
                            />
                          </td>
                          <td className="p-2 text-right text-xs tabular-nums text-muted-foreground">
                            {okTyped ? fmtMur(n * r.quantity) : '—'}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-2 text-right text-xs tabular-nums">{fmtMurUnit(vr.unitCost)}</td>
                          <td className="p-2 text-left text-xs text-muted-foreground">
                            {vr.source === 'manual' ? (
                              'Entered by hand'
                            ) : (
                              <span>
                                {`${vr.pooledFrom > 1 ? `${vr.pooledFrom} POs` : 'PO'}: ${fmtMur(vr.poTotal ?? 0)} ÷ ${(vr.poQty ?? 0).toLocaleString()}`}
                                {vr.yuanUnitPrice ? ` · ¥${vr.yuanUnitPrice} on 1688` : ''}
                                {vr.pooledFrom > 1 ? ' · same date, pooled' : ''}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right text-xs tabular-nums">{fmtMur(vr.value)}</td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {error && (
          <p className="flex-shrink-0 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>
        )}
        {savedNote && !error && (
          <p className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-600 dark:text-emerald-500">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {savedNote}
          </p>
        )}

        <DialogFooter className="flex-shrink-0 items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {bad.length > 0
              ? `${bad.length} entr${bad.length === 1 ? 'y is' : 'ies are'} not a valid amount and will not be saved.`
              : good.length > 0
                ? `${good.length} cost${good.length === 1 ? '' : 's'} ready, adding ${fmtMur(pendingValue)} to stock value.`
                : 'Type a cost against any product to price it.'}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Close
            </Button>
            <Button onClick={save} disabled={saving || good.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {good.length ? `Save ${good.length} cost${good.length === 1 ? '' : 's'}` : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Read-only list of products holding stock with no zone.
 *
 * Deliberately has no bulk "clear these" action. A zone is the only record of
 * where an item physically sits, but a missing zone has two possible meanings -
 * the product sold out, or nobody ever filled the zone in - and they are
 * indistinguishable from the data. Zeroing all of them at once would erase
 * counted stock for the second group, so each row links out to be settled
 * individually on the row it belongs to.
 */
function UnzonedDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  rows: UnzonedRow[]
}) {
  const units = rows.reduce((s, p) => s + p.quantity, 0)
  const valued = rows.filter(p => p.value !== null)
  const total = valued.reduce((s, p) => s + (p.value ?? 0), 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[94vw] max-w-3xl flex-col gap-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Stock with no zone</DialogTitle>
          <DialogDescription>
            {`${rows.length} products hold ${units.toLocaleString()} units but are not assigned to a zone. `}
            {total > 0
              ? `${fmtMur(total)} of the stock value comes from them.`
              : 'None of them have a cost price, so they add nothing to the stock value.'}
          </DialogDescription>
        </DialogHeader>

        <p className="flex-shrink-0 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
          Nothing is changed from here. A missing zone usually means the product sold out, but it can also mean the zone
          was never recorded — and the stored quantity cannot tell those apart. Set the zone, or mark it sold out, on the
          product row itself.
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Product
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Qty on record
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Value in total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{p.name ?? 'Unnamed product'}</span>
                    {p.sku ? <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span> : null}
                    {p.soldOut ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        already flagged sold out
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">{p.quantity.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {p.value === null ? 'no cost price' : fmtMur(p.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
