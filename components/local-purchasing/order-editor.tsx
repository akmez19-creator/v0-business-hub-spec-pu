'use client'

import { useMemo, useState, useTransition } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { ProductThumb } from '@/components/ui/product-thumb'
import { ExistingVariantPicker, ProductPicker, type PickableProduct } from './product-picker'
import { calculateOrder, orderItemIdentityKey, type LocalOrder, type LocalOrderLine, type OrderTerms } from '@/lib/local-purchasing/order-types'
import { moneyText, nullableNumber } from '@/lib/local-purchasing/evidence'
import { clearedVariant, recordedVariantId, variantDescription, variantSelectionError } from '@/lib/products/pricing'
import { getPurchasingCatalogueAction } from '@/app/dashboard/purchasing/local/actions'
import type { SupplierCatalogueProduct } from '@/lib/local-purchasing/supplier-catalogue'
import type { SupplierOption } from './purchase-entry'
import { getSupplierCatalogueAction, saveLocalOrderAction } from '@/app/dashboard/purchasing/local/orders/actions'

const newLine = (): LocalOrderLine => ({ id: crypto.randomUUID(), supplierProductId: null, productId: null, supplierLabel: '', supplierCode: null,
  unit: null, qty: 1, expectedUnitPrice: null, vatPercent: 15, pricesIncludeVat: true, discountPercent: 0, sourcePurchaseLineId: null, priceReferenceDate: null })

export function LocalOrderEditor({ order, suppliers, products: initialProducts, initialSupplierId = '', onSaved, onCancel }: {
  order?: LocalOrder; suppliers: SupplierOption[]; products: PickableProduct[]; initialSupplierId?: string;
  onSaved?: () => Promise<void>; onCancel?: () => void;
}) {
  const router = useRouter()
  const { data: products = initialProducts, mutate: refreshProducts, error: productsError, isValidating: refreshingProducts } = useSWR(
    'local-purchasing-catalogue', getPurchasingCatalogueAction,
    { fallbackData: initialProducts, revalidateOnMount: true, shouldRetryOnError: false },
  )
  const [id] = useState(() => order?.id ?? crypto.randomUUID())
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? initialSupplierId)
  const [lines, setLines] = useState<LocalOrderLine[]>(() => order?.lines.map((line) => ({ ...line, variantId: recordedVariantId(line) })) ?? [])
  const [terms, setTerms] = useState<OrderTerms>(order?.terms ?? { charges: [], roundingAmount: null })
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '')
  const [query, setQuery] = useState('')
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { data: catalogue = [], error: catalogueError, isLoading, mutate: retryCatalogue } = useSWR(supplierId ? ['supplier-products', supplierId] : null,
    ([, supplier]) => getSupplierCatalogueAction(supplier), { revalidateOnFocus: false, shouldRetryOnError: false })
  const filtered = useMemo(() => catalogue.filter((item) => `${item.supplierLabel} ${item.supplierCode ?? ''} ${item.productName}`.toLowerCase().includes(query.trim().toLowerCase())), [catalogue, query])
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const calculation = useMemo(() => calculateOrder(lines, terms), [lines, terms])
  const changed = () => { setRequestKey(crypto.randomUUID()); setError(null) }
  const patchLine = (id: string, patch: Partial<LocalOrderLine>) => {
    changed()
    setLines((current) => current.map((line) => {
      if (line.id !== id) return line
      const identityChanged = (['supplierLabel', 'supplierCode', 'unit', 'productId'] as const).some((field) => field in patch && patch[field] !== line[field])
      const variantChanged = 'variantId' in patch && (patch.variantId || null) !== recordedVariantId(line)
      if (!identityChanged && !variantChanged) return { ...line, ...patch }
      return { ...line, ...patch, ...(identityChanged ? clearedVariant : {}), variantSnapshot: null,
        supplierProductId: null, sourcePurchaseLineId: null, priceReferenceDate: null, expectedUnitPrice: null }
    }))
  }
  const addItem = (item: SupplierCatalogueProduct) => {
    changed()
    setLines((current) => {
      const found = current.find((line) => orderItemIdentityKey(line) === orderItemIdentityKey(item))
      if (found) return current.map((line) => line.id === found.id ? { ...line, qty: line.qty + 1 } : line)
      return [...current, { ...newLine(), supplierProductId: item.id, productId: item.productId, supplierLabel: item.supplierLabel,
        supplierCode: item.supplierCode, unit: item.unit, expectedUnitPrice: item.lastUnitPayable,
        vatPercent: item.vatPercent ?? 15, pricesIncludeVat: true, discountPercent: 0,
        sourcePurchaseLineId: item.sourcePurchaseLineId, priceReferenceDate: item.lastPurchaseDate,
        variantId: recordedVariantId(item), variantSnapshot: item.variantSnapshot, variantSource: recordedVariantId(item) ? 'supplier' : null }]
    })
  }
  const save = () => startTransition(async () => {
    setError(null)
    try {
      const result = await saveLocalOrderAction({ id, revision: order?.revision ?? 0, updatedAt: order?.updatedAt ?? null, requestKey, supplierId,
        lines, terms, notes: notes.trim() || null, expectedDate: expectedDate || null })
      if (onSaved) await onSaved()
      else router.push(`/dashboard/purchasing/local/orders/${result.id}`)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the draft. Your edits are still here.') }
  })
  return <section className="flex min-w-0 flex-col gap-6 font-sans">
    <header className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Local supplier order</p><h1 className="text-balance text-2xl font-semibold">{order ? `Edit ${order.orderNumber}` : 'Build a supplier reorder'}</h1><p className="text-sm leading-relaxed text-muted-foreground">Use the supplier&apos;s wording on the order. Inventory names are only for your reference. Saving does not send the order or record a purchase.</p></header>
    {error && <Alert variant="destructive"><AlertTitle>Draft not saved</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
      <FieldGroup className="sm:grid sm:grid-cols-2">
        <Field><FieldLabel htmlFor="reorder-supplier">Supplier</FieldLabel><Select value={supplierId} disabled={Boolean(order) || lines.length > 0} onValueChange={(value) => { changed(); setSupplierId(value); setQuery('') }}><SelectTrigger id="reorder-supplier"><SelectValue placeholder="Choose the supplier" /></SelectTrigger><SelectContent><SelectGroup>{suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{lines.length ? 'Remove unsaved items to change supplier; an existing order stays with its supplier.' : 'Only this supplier’s saved products and prices will be offered.'}</FieldDescription></Field>
        <Field><FieldLabel htmlFor="reorder-date">Requested delivery date</FieldLabel><Input id="reorder-date" type="date" value={expectedDate} onChange={(event) => { changed(); setExpectedDate(event.target.value) }} /></Field>
      </FieldGroup>
      {supplierId && <section className="flex min-w-0 flex-col gap-4" aria-label="Supplier product catalogue">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-col gap-1"><h2 className="text-lg font-semibold">Previously bought from this supplier</h2><p className="text-sm text-muted-foreground">Last paid prices are dated estimates, with VAT included and no old discount applied again.</p></div><Badge variant="outline">{catalogue.length} supplier identities</Badge></div>
        <Field><FieldLabel htmlFor="supplier-product-search">Find by supplier name, code or Inventory name</FieldLabel><Input id="supplier-product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this supplier’s catalogue" /></Field>
        {isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading supplier catalogue…</p> : catalogueError ? <Alert variant="destructive"><AlertTitle>Catalogue unavailable</AlertTitle><AlertDescription><p>No cached or invented prices are being used.</p><Button type="button" variant="outline" onClick={() => void retryCatalogue()}>Retry catalogue</Button></AlertDescription></Alert> : filtered.length ? <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-card text-card-foreground"><ul className="divide-y divide-border">{filtered.map((item) => <li key={item.id} className="px-4 py-3"><div className="flex flex-wrap items-center gap-3"><ProductThumb src={item.imageUrl} alt="" className="size-12 shrink-0 rounded-md" /><div className="flex min-w-0 flex-1 flex-col gap-1"><p className="break-words text-sm font-medium">{item.supplierLabel}</p><p className="text-sm text-muted-foreground">{item.supplierCode || 'No supplier code'} · {item.unit || 'Unit not specified'}</p><p className="text-sm text-muted-foreground">Inventory: {item.productName}</p>{item.variantSnapshot && <p className="text-sm text-muted-foreground">{variantDescription(item.variantSnapshot)}</p>}</div><div className="flex flex-col gap-1 text-right"><p className="font-mono text-sm">{item.lastUnitPayable == null ? 'Price to enter' : moneyText(item.lastUnitPayable)}</p><p className="text-sm text-muted-foreground">{item.lastPurchaseDate || 'No dated price'}</p></div><Button type="button" size="sm" variant="outline" onClick={() => addItem(item)} aria-label={`Add ${item.supplierLabel}`}><Plus data-icon="inline-start" />Add</Button></div></li>)}</ul></div> : <Empty><EmptyHeader><EmptyTitle>{catalogue.length ? 'No matching supplier product' : 'No saved products for this supplier yet'}</EmptyTitle><EmptyDescription>Record a receipt to remember this supplier&apos;s names automatically, or add an item below using the wording they know.</EmptyDescription></EmptyHeader></Empty>}
      </section>}
      <section className="flex min-w-0 flex-col gap-4" aria-label="Ordered items">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Order items <span className="text-muted-foreground">({lines.length})</span></h2><Button type="button" disabled={!supplierId} variant="outline" onClick={() => { changed(); setLines((current) => [...current, newLine()]) }}><Plus data-icon="inline-start" />Add an item</Button></div>
        {lines.map((line, index) => {
          const received = order?.received[line.id] ?? 0
          const amount = calculation.lines.find((item) => item.key === line.id)
          return <article key={line.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Item {index + 1}{received > 0 ? ` · ${received} already recorded` : ''}</p><Button type="button" variant="ghost" size="sm" disabled={received > 0} onClick={() => { changed(); setLines((current) => current.filter((item) => item.id !== line.id)) }} aria-label={`Remove item ${index + 1}`}><Trash2 data-icon="inline-start" />Remove</Button></div>
              <FieldGroup className="sm:grid sm:grid-cols-6">
                <Field className="sm:col-span-3"><FieldLabel htmlFor={`${line.id}-label`}>Supplier description</FieldLabel><Input id={`${line.id}-label`} disabled={received > 0} value={line.supplierLabel} onChange={(event) => patchLine(line.id, { supplierLabel: event.target.value, supplierProductId: null })} /></Field>
                <Field className="sm:col-span-2"><FieldLabel htmlFor={`${line.id}-code`}>Supplier code</FieldLabel><Input id={`${line.id}-code`} disabled={received > 0} value={line.supplierCode ?? ''} onChange={(event) => patchLine(line.id, { supplierCode: event.target.value || null, supplierProductId: null })} /></Field>
                <Field><FieldLabel htmlFor={`${line.id}-unit`}>Purchasing unit</FieldLabel><Input id={`${line.id}-unit`} disabled={received > 0} placeholder="e.g. piece" value={line.unit ?? ''} onChange={(event) => patchLine(line.id, { unit: event.target.value || null, supplierProductId: null, sourcePurchaseLineId: null, priceReferenceDate: null })} /></Field>
                <Field><FieldLabel htmlFor={`${line.id}-qty`}>Quantity</FieldLabel><Input id={`${line.id}-qty`} type="number" min={Math.max(received, 0.001)} step="any" value={line.qty || ''} onChange={(event) => patchLine(line.id, { qty: Number(event.target.value) })} /></Field>
                <Field className="sm:col-span-2"><FieldLabel htmlFor={`${line.id}-price`}>Expected supplier unit price</FieldLabel><Input id={`${line.id}-price`} type="number" min="0" step="any" value={line.expectedUnitPrice ?? ''} onChange={(event) => patchLine(line.id, { expectedUnitPrice: nullableNumber(event.target.value) })} /><FieldDescription>{line.priceReferenceDate ? `Last paid on ${line.priceReferenceDate}; confirm the current price.` : 'An estimate, not a confirmed supplier price.'}</FieldDescription></Field>
                <Field><FieldLabel htmlFor={`${line.id}-basis`}>Unit price VAT</FieldLabel><Select value={line.pricesIncludeVat ? 'included' : 'added'} onValueChange={(value) => patchLine(line.id, { pricesIncludeVat: value === 'included' })}><SelectTrigger id={`${line.id}-basis`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="included">Included</SelectItem><SelectItem value="added">Still to add</SelectItem></SelectGroup></SelectContent></Select></Field>
                <Field><FieldLabel htmlFor={`${line.id}-vat`}>VAT %</FieldLabel><Input id={`${line.id}-vat`} type="number" min="0" max="100" step="any" value={line.vatPercent} onChange={(event) => patchLine(line.id, { vatPercent: Number(event.target.value) })} /></Field>
                <Field><FieldLabel htmlFor={`${line.id}-discount`}>Discount still to apply %</FieldLabel><Input id={`${line.id}-discount`} type="number" min="0" max="100" step="any" value={line.discountPercent} onChange={(event) => patchLine(line.id, { discountPercent: Number(event.target.value) })} /></Field>
              </FieldGroup>
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">Inventory: {line.productId ? productsById.get(line.productId)?.name ?? 'Linked product' : 'Not linked (optional)'}</p>{!received && <ProductPicker products={products} onPick={(product) => patchLine(line.id, { productId: product.id, supplierProductId: null, sourcePurchaseLineId: null, priceReferenceDate: null })} />}</div><p className="font-mono text-sm">Payable: {amount ? moneyText(amount.payable) : 'Complete price and terms'}</p></div>
              {line.productId && <ExistingVariantPicker id={`${line.id}-variant`} product={productsById.get(line.productId)} value={line.variantId} source={line.variantSource}
                disabled={received > 0} onChange={(variantId) => patchLine(line.id, { variantId, variantSource: 'manual', variantCleared: !variantId })}
                loadError={Boolean(productsError)} loading={refreshingProducts} onRefresh={() => { changed(); void refreshProducts().catch(() => {}) }} />}
              {line.productId && (productsById.get(line.productId)?.variants?.length || line.variantId) ? <p className="text-sm text-muted-foreground">Changing the variant clears the previous supplier price estimate and dated reference. Enter the expected supplier price for the new choice.</p> : null}
            </div>
          </article>
        })}
      </section>
      <details className="rounded-lg border border-border bg-card text-card-foreground"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Delivery, other charges and rounding</summary><div className="px-4 pb-4"><FieldGroup>{terms.charges.map((charge, index) => <FieldGroup key={index} className="sm:grid sm:grid-cols-5"><Field><FieldLabel htmlFor={`order-charge-${index}`}>Description</FieldLabel><Input id={`order-charge-${index}`} value={charge.label} onChange={(event) => { changed(); setTerms({ ...terms, charges: terms.charges.map((item, i) => i === index ? { ...item, label: event.target.value } : item) }) }} /></Field><Field><FieldLabel htmlFor={`order-charge-amount-${index}`}>Amount</FieldLabel><Input id={`order-charge-amount-${index}`} type="number" min="0" step="any" value={charge.amount ?? ''} onChange={(event) => { changed(); setTerms({ ...terms, charges: terms.charges.map((item, i) => i === index ? { ...item, amount: nullableNumber(event.target.value) } : item) }) }} /></Field><Field><FieldLabel htmlFor={`order-charge-vat-${index}`}>VAT %</FieldLabel><Input id={`order-charge-vat-${index}`} type="number" min="0" max="100" value={charge.vatPercent ?? 15} onChange={(event) => { changed(); setTerms({ ...terms, charges: terms.charges.map((item, i) => i === index ? { ...item, vatPercent: Number(event.target.value) } : item) }) }} /></Field><Field><FieldLabel htmlFor={`order-charge-basis-${index}`}>VAT basis</FieldLabel><Select value={charge.pricesIncludeVat === false ? 'added' : 'included'} onValueChange={(value) => { changed(); setTerms({ ...terms, charges: terms.charges.map((item, i) => i === index ? { ...item, pricesIncludeVat: value === 'included' } : item) }) }}><SelectTrigger id={`order-charge-basis-${index}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="included">Included</SelectItem><SelectItem value="added">Added</SelectItem></SelectGroup></SelectContent></Select></Field><Button type="button" variant="outline" onClick={() => { changed(); setTerms({ ...terms, charges: terms.charges.filter((_, i) => i !== index) }) }}>Remove charge</Button></FieldGroup>)}<div><Button type="button" variant="outline" onClick={() => { changed(); setTerms({ ...terms, charges: [...terms.charges, { label: 'Delivery', amount: null, vatPercent: 15, pricesIncludeVat: true }] }) }}><Plus data-icon="inline-start" />Add charge</Button></div><Field><FieldLabel htmlFor="order-rounding">Explicit rounding adjustment</FieldLabel><Input id="order-rounding" type="number" step="any" value={terms.roundingAmount ?? ''} onChange={(event) => { changed(); setTerms({ ...terms, roundingAmount: nullableNumber(event.target.value) }) }} /></Field></FieldGroup></div></details>
      <Field><FieldLabel htmlFor="order-notes">Instructions shown to the supplier</FieldLabel><Textarea id="order-notes" value={notes} onChange={(event) => { changed(); setNotes(event.target.value) }} rows={3} maxLength={10000} placeholder="Delivery instructions or details to confirm" /></Field>
      <div className="flex flex-wrap items-end justify-between gap-4"><div className="flex flex-col gap-1"><p className="text-sm text-muted-foreground">Estimated total payable</p><p className="font-mono text-2xl font-semibold">{calculation.totals ? moneyText(calculation.totals.payable) : 'Incomplete prices'}</p><p className="text-sm text-muted-foreground">{calculation.totals ? `${moneyText(calculation.totals.net)} net + ${moneyText(calculation.totals.vat)} VAT` : 'You can save an incomplete-price draft, but complete it before issuing.'}</p></div><div className="flex flex-wrap gap-2">{onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Discard edits</Button> : <Button asChild variant="outline"><Link href="/dashboard/purchasing/local/orders">Back to orders</Link></Button>}<Button type="button" disabled={!supplierId || !lines.length || pending || lines.some((line) => variantSelectionError(line.productId ? productsById.get(line.productId) : undefined, line.variantId))} onClick={save}>{pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}Save draft{order && order.status !== 'draft' ? ' as new revision' : ''}</Button></div></div>
    </fieldset>
  </section>
}
