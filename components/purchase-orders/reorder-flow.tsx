'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProductPicker } from '@/components/local-purchasing/product-picker'
import { ProductThumb } from '@/components/ui/product-thumb'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import type { ImportReference } from '@/lib/purchase-orders/workflow'

type Product = ReorderCatalogue['products'][number]
type Tier = 'exact' | 'high' | 'medium' | 'low' | 'none'
type Step = 'paste' | 'match' | 'interest'

type MatchResult = {
  excelProduct: string
  matchedId: string | null
  matchedName: string | null
  confidence: number
  tier: Tier
  reason?: string
  alternatives: { id: string; name: string; score: number }[]
}

type Row = {
  key: string
  input: string
  qty: number | null
  productId: string | null
  productName: string | null
  tier: Tier
  reason: string
  alternatives: { id: string; name: string; score: number }[]
  include: boolean
}

export type InterestItem = {
  product: Product
  qty: number | null
  reference: ImportReference | null
}

type ParsedLine = { name: string; qty: number | null }

const MAX_LINES = 200
// Exact/high/medium arrive ticked; low/none stay unticked so a wrong AI guess
// cannot slip into the draft unnoticed.
const AUTO_INCLUDE: Tier[] = ['exact', 'high', 'medium']

// A paste from a sheet is `name<TAB>qty`; a plain list is one name per line.
// Thousands separators are stripped; missing or non-numeric qty stays null.
function parseLines(text: string): ParsedLine[] {
  const seen = new Set<string>()
  const lines: ParsedLine[] = []
  for (const raw of text.split('\n')) {
    const cells = raw.split('\t')
    const name = cells[0]?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const rawQty = (cells[1] ?? '').replace(/[,\s]/g, '')
    const qty = rawQty ? Math.floor(Number(rawQty)) : NaN
    lines.push({ name, qty: Number.isFinite(qty) && qty > 0 ? qty : null })
    if (lines.length >= MAX_LINES) break
  }
  return lines
}

function tierLabel(tier: Tier) {
  if (tier === 'exact') return 'Exact'
  if (tier === 'high') return 'Match'
  if (tier === 'medium') return 'Likely'
  if (tier === 'low') return 'Doubtful'
  return 'Not found'
}

const positive = (value: number | null | undefined) => (Number(value) > 0 ? Number(value) : null)

// The latest import of this exact product (parent, no variant) is the cost
// reference. A suspect (>4x median) row is shown but never used as a price.
function latestOwnReference(productId: string, references: ImportReference[]): ImportReference | null {
  let best: ImportReference | null = null
  for (const ref of references) {
    if (ref.product_id !== productId || ref.variant_id) continue
    const stamp = ref.order_date || ref.created_at
    const bestStamp = best ? best.order_date || best.created_at : ''
    if (!best || stamp > bestStamp) best = ref
  }
  return best
}

export function referenceUnitPrice(reference: ImportReference | null): number | null {
  if (!reference || reference.referenceWarning) return null
  return positive(reference.discounted_unit_price) ?? positive(reference.unit_price)
}

export function referenceChinaFreight(reference: ImportReference | null): number | null {
  if (!reference) return null
  return positive(reference.discounted_shipment_to_warehouse) ?? positive(reference.shipment_to_warehouse)
}

// The same columns as the owner's PO sheet, projected onto the expected qty.
// Per-unit prices are the last import's; shipment and totals are scaled by
// qty (freight per unit = last shipment / last qty). MUR uses the last
// import's own CNY->MUR ratio when no rate is given, and is null otherwise.
export type ExpectedCost = {
  unitPrice: number | null
  discountedUnitPrice: number | null
  shipment: number | null
  discountedShipment: number | null
  discountPercent: number | null
  totalYuan: number | null
  totalMur: number | null
}

export function expectedCost(reference: ImportReference | null, qty: number | null, fxRate: number | null): ExpectedCost {
  const none: ExpectedCost = {
    unitPrice: null,
    discountedUnitPrice: null,
    shipment: null,
    discountedShipment: null,
    discountPercent: null,
    totalYuan: null,
    totalMur: null,
  }
  if (!reference || reference.referenceWarning) return none
  const unitPrice = positive(reference.unit_price)
  const discountedUnitPrice = positive(reference.discounted_unit_price) ?? unitPrice
  const lastQty = positive(reference.qty)
  const scale = qty && lastQty ? qty / lastQty : null
  const shipment = scale != null && positive(reference.shipment_to_warehouse) != null
    ? reference.shipment_to_warehouse! * scale
    : null
  const discountedShipment =
    scale != null && positive(reference.discounted_shipment_to_warehouse) != null
      ? reference.discounted_shipment_to_warehouse! * scale
      : shipment
  const discountPercent =
    reference.discounted_percentage != null && Number.isFinite(reference.discounted_percentage)
      ? reference.discounted_percentage
      : null
  const totalYuan = qty && discountedUnitPrice != null ? qty * discountedUnitPrice + (discountedShipment ?? 0) : null
  const impliedRate =
    positive(reference.total_payment_supplier) != null && positive(reference.total_payment_supplier_yuan) != null
      ? reference.total_payment_supplier! / reference.total_payment_supplier_yuan!
      : null
  const rate = fxRate ?? impliedRate
  const totalMur = totalYuan != null && rate != null ? totalYuan * rate : null
  return { unitPrice, discountedUnitPrice, shipment, discountedShipment, discountPercent, totalYuan, totalMur }
}

/**
 * The PO sheet stores the discount as a signed fraction (-0.26 = 26% off),
 * while some rows carry a whole percentage (26). Show both as "26% off".
 */
export function formatDiscountPercent(value: number): string {
  const pct = Math.abs(value) <= 1 ? Math.abs(value) * 100 : Math.abs(value)
  if (pct === 0) return '0%'
  return `${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}% off`
}

const cny = (value: number) => `¥${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const mur = (value: number) => `Rs ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

function StepHeader({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'paste', label: 'Paste list' },
    { id: 'match', label: 'Match products' },
    { id: 'interest', label: 'List of interest' },
  ]
  const index = steps.findIndex((s) => s.id === step)
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={
              i === index
                ? 'flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground'
                : i < index
                  ? 'flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground'
                  : 'flex size-6 items-center justify-center rounded-full border border-border text-xs text-muted-foreground'
            }
          >
            {i < index ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={i === index ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
          {i < steps.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" />}
        </li>
      ))}
    </ol>
  )
}

export function ReorderFlow({
  products,
  references,
  fxRate,
  disabled,
  existingProductIds,
  onAddMany,
}: {
  products: Product[]
  references: ImportReference[]
  fxRate: number | null
  disabled: boolean
  existingProductIds: Set<string>
  onAddMany: (items: InterestItem[]) => void
}) {
  const [step, setStep] = useState<Step>('paste')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [matching, setMatching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => parseLines(text), [text])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const patch = (key: string, changes: Partial<Row>) =>
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...changes } : row)))

  const chooseProduct = (key: string, product: Product) =>
    patch(key, { productId: product.id, productName: product.name, tier: 'exact', reason: 'Chosen by you', include: true })

  async function runMatch() {
    if (!parsed.length) {
      setError('Paste at least one product line first.')
      return
    }
    setError(null)
    setMatching(true)
    try {
      const res = await fetch('/api/purchase-orders/ai-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: parsed.map((line) => ({ name: line.name })),
          candidates: products.map((p) => ({ id: p.id, name: p.name })),
        }),
      })
      if (!res.ok) throw new Error('Matching failed. Try again in a moment.')
      const data = (await res.json()) as { matches: MatchResult[] }
      const qtyByName = new Map(parsed.map((line) => [line.name.toLowerCase(), line.qty]))
      setRows(
        (data.matches ?? []).map((m) => ({
          key: crypto.randomUUID(),
          input: m.excelProduct,
          qty: qtyByName.get(m.excelProduct.toLowerCase()) ?? null,
          productId: m.matchedId,
          productName: m.matchedName,
          tier: m.tier,
          reason: m.reason ?? '',
          alternatives: m.alternatives ?? [],
          include: Boolean(m.matchedId) && AUTO_INCLUDE.includes(m.tier),
        })),
      )
      setStep('match')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Matching failed.')
    } finally {
      setMatching(false)
    }
  }

  // One interest item per product (first ticked row wins), with its history.
  const interest = useMemo<InterestItem[]>(() => {
    const seen = new Set<string>()
    const items: InterestItem[] = []
    for (const row of rows) {
      if (!row.include || !row.productId || seen.has(row.productId)) continue
      if (existingProductIds.has(row.productId)) continue
      const product = byId.get(row.productId)
      if (!product) continue
      seen.add(row.productId)
      items.push({ product, qty: row.qty, reference: latestOwnReference(product.id, references) })
    }
    return items
  }, [rows, byId, existingProductIds, references])

  const setInterestQty = (productId: string, qty: number | null) =>
    setRows((list) => list.map((row) => (row.productId === productId ? { ...row, qty } : row)))

  const counts = useMemo(
    () => ({
      matched: rows.filter((r) => r.productId && AUTO_INCLUDE.includes(r.tier)).length,
      review: rows.filter((r) => r.tier === 'low').length,
      rejected: rows.filter((r) => !r.productId).length,
    }),
    [rows],
  )

  const totals = useMemo(() => {
    let units = 0
    let yuan = 0
    let mur = 0
    let murCovered = 0
    let priced = 0
    for (const item of interest) {
      const cost = expectedCost(item.reference, item.qty, fxRate)
      if (item.qty) units += item.qty
      if (cost.totalYuan != null) {
        yuan += cost.totalYuan
        priced += 1
        if (cost.totalMur != null) {
          mur += cost.totalMur
          murCovered += 1
        }
      }
    }
    return { units, yuan, mur, murCovered, priced, unpriced: interest.length - priced }
  }, [interest, fxRate])

  function finish() {
    if (!interest.length) {
      setError('Nothing in the list of interest, or everything is already in the draft.')
      return
    }
    onAddMany(interest)
    setRows([])
    setText('')
    setError(null)
    setStep('paste')
  }

  return (
    <div className="flex flex-col gap-4">
      <StepHeader step={step} />

      {step === 'paste' && (
        <>
          <Textarea
            value={text}
            disabled={disabled || matching}
            onChange={(e) => setText(e.target.value)}
            placeholder={'One product per line. Paste straight from your sheet with the quantity in the next column, e.g.\nFlynova Pro Spinner\t200\nAluminium Tape\t1000'}
            rows={8}
            className="font-mono text-sm"
            aria-label="Products to order, one per line with optional quantity"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {parsed.length
                ? `${parsed.length} line${parsed.length === 1 ? '' : 's'} · ${parsed.filter((l) => l.qty != null).length} with a quantity`
                : 'Nothing pasted yet'}
            </p>
            <Button type="button" onClick={runMatch} disabled={disabled || matching || !parsed.length}>
              {matching ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Match with AI
            </Button>
          </div>
        </>
      )}

      {step === 'match' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{counts.matched} matched</Badge>
              {counts.review > 0 && <Badge variant="outline">{counts.review} to review</Badge>}
              {counts.rejected > 0 && <Badge variant="destructive">{counts.rejected} not found</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep('paste')} disabled={disabled}>
                <ArrowLeft />
                Back to list
              </Button>
              <Button type="button" size="sm" onClick={() => setStep('interest')} disabled={disabled || interest.length === 0}>
                Continue with {interest.length || ''}
                <ArrowRight />
              </Button>
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => {
              const already = row.productId ? existingProductIds.has(row.productId) : false
              return (
                <li key={row.key} className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <Checkbox
                      aria-label={`Include ${row.input}`}
                      checked={row.include}
                      disabled={disabled || !row.productId || already}
                      onCheckedChange={(v) => patch(row.key, { include: v === true })}
                      className="mt-1"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.input}</span>
                        <Badge variant={row.tier === 'none' ? 'destructive' : row.tier === 'low' ? 'outline' : 'secondary'}>
                          {tierLabel(row.tier)}
                        </Badge>
                        {already && <Badge variant="outline">Already in draft</Badge>}
                      </div>
                      {row.productId ? (
                        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Check className="size-3.5 text-foreground" />
                          <span className="truncate">{row.productName}</span>
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">{row.reason || 'No match in the catalogue'}</p>
                      )}
                      {(row.tier === 'low' || row.tier === 'none' || row.tier === 'medium') && (
                        <div className="flex flex-wrap items-center gap-2">
                          {row.alternatives.slice(0, 4).map((alt) => {
                            const product = byId.get(alt.id)
                            if (!product || alt.id === row.productId) return null
                            return (
                              <Button
                                key={alt.id}
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={() => chooseProduct(row.key, product)}
                              >
                                {alt.name}
                              </Button>
                            )
                          })}
                          <ProductPicker products={products} disabled={disabled} onPick={(product) => chooseProduct(row.key, product)} />
                        </div>
                      )}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      Qty
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={row.qty ?? ''}
                        disabled={disabled}
                        onChange={(e) => {
                          const n = Math.floor(Number(e.target.value))
                          patch(row.key, { qty: Number.isFinite(n) && n > 0 ? n : null })
                        }}
                        placeholder="Not set"
                        aria-label={`Quantity for ${row.input}`}
                        className="h-8 w-24"
                      />
                    </label>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {step === 'interest' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Expected cost comes from each product&apos;s latest import. It is an estimate the supplier will confirm.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep('match')} disabled={disabled}>
                <ArrowLeft />
                Back to matches
              </Button>
              <Button type="button" size="sm" onClick={finish} disabled={disabled || interest.length === 0}>
                <Check />
                Add {interest.length || ''} to this draft
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Unit prices and discount are the last import&apos;s. Shipment and totals are scaled to the expected qty.
            Total in MUR uses the terms rate, or the last import&apos;s own rate when none is set.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Discounted Unit Price</TableHead>
                  <TableHead className="text-right">Shipment to Warehouse</TableHead>
                  <TableHead className="text-right">Discounted Shipment</TableHead>
                  <TableHead className="text-right">Discount %</TableHead>
                  <TableHead className="text-right">Total Payment CNY</TableHead>
                  <TableHead className="text-right">Total Payment MUR</TableHead>
                  <TableHead>Last import</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {interest.map((item) => {
                  const cost = expectedCost(item.reference, item.qty, fxRate)
                  const dash = <span className="text-muted-foreground">—</span>
                  const money = (value: number | null) => (value != null ? cny(value) : dash)
                  return (
                    <TableRow key={item.product.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductThumb src={item.product.imageUrl} className="size-10 shrink-0 rounded-lg" />
                          <span className="max-w-56 whitespace-normal font-medium">{item.product.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          value={item.qty ?? ''}
                          disabled={disabled}
                          onChange={(e) => {
                            const n = Math.floor(Number(e.target.value))
                            setInterestQty(item.product.id, Number.isFinite(n) && n > 0 ? n : null)
                          }}
                          placeholder="Set qty"
                          aria-label={`Expected quantity for ${item.product.name}`}
                          className="h-8 w-24"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(cost.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(cost.discountedUnitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(cost.shipment)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(cost.discountedShipment)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cost.discountPercent != null ? formatDiscountPercent(cost.discountPercent) : dash}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {cost.totalYuan != null ? (
                          cny(cost.totalYuan)
                        ) : item.reference?.referenceWarning ? (
                          <span className="text-sm text-muted-foreground">Suspect price</span>
                        ) : !item.reference ? (
                          <span className="text-sm text-muted-foreground">No history</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Needs qty</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cost.totalMur != null ? mur(cost.totalMur) : dash}
                      </TableCell>
                      <TableCell>
                        {item.reference ? (
                          <div className="flex flex-col text-sm">
                            <span className="max-w-44 truncate">{item.reference.supplier_name || 'Unknown supplier'}</span>
                            <span className="text-muted-foreground">
                              {item.reference.qty?.toLocaleString() ?? '?'} u ·{' '}
                              {(item.reference.order_date || item.reference.created_at).slice(0, 10)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">First time buying</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-3 text-sm">
            <span>
              <span className="text-muted-foreground">Units </span>
              <span className="font-medium tabular-nums">{totals.units.toLocaleString()}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Total Payment CNY </span>
              <span className="font-medium tabular-nums">{cny(totals.yuan)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Total Payment MUR </span>
              <span className="font-medium tabular-nums">{totals.murCovered ? mur(totals.mur) : '—'}</span>
              {totals.murCovered > 0 && totals.murCovered < totals.priced && (
                <span className="text-muted-foreground"> · {totals.priced - totals.murCovered} without a rate</span>
              )}
            </span>
            {totals.unpriced > 0 && (
              <span className="text-muted-foreground">
                {totals.unpriced} product{totals.unpriced === 1 ? '' : 's'} without a price or qty are not in these totals
              </span>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
