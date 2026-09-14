'use client'

import { useMemo, useState, useTransition, type SetStateAction } from 'react'
import useSWR from 'swr'
import { Plus, Trash2, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ReceiptCheckSummary, ReceiptIssues } from './receipt-check'
import { ReceiptEvidenceEditor, ReceiptLineEvidenceEditor } from './receipt-evidence-editor'
import { SupplierUnitCost } from './supplier-unit-cost'
import { PurchaseAcknowledgement } from './purchase-acknowledgement'
import { ExistingVariantPicker, ProductPicker, type PickableProduct } from './product-picker'
import { evidenceRevision, nullableNumber, type ReceiptLine } from '@/lib/local-purchasing/evidence'
import { comparableEvidence } from '@/lib/local-purchasing/receipt-input'
import { compareOrderDocument, orderReviewRevision, type OrderReviewInput } from '@/lib/local-purchasing/order-reconcile'
import { conflictingSupplierSelections, supplierIdentityKey, supplierIdentityMatch, supplierSelectionConflict } from '@/lib/local-purchasing/supplier-identity'
import { clearedVariant, recordedVariantId, variantDescription, variantSelectionError } from '@/lib/products/pricing'
import { getPurchasingCatalogueAction } from '@/app/dashboard/purchasing/local/actions'
import type { LocalOrder } from '@/lib/local-purchasing/order-types'
import type { OrderDocumentView, ReviewRequest } from '@/lib/local-purchasing/order-service'
import type { SupplierCatalogueProduct } from '@/lib/local-purchasing/supplier-catalogue'
import { saveOrderReviewAction, recordOrderPurchaseAction } from '@/app/dashboard/purchasing/local/orders/actions'

export function OrderDocumentReview({ order, document: source, products: initialProducts, catalogue, onSaved, onRecorded, onBusyChange }: {
  order: LocalOrder; document: OrderDocumentView; products: PickableProduct[]; catalogue: SupplierCatalogueProduct[];
  onSaved: () => Promise<void>; onRecorded: (id: string) => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const { data: products = initialProducts, mutate: refreshProducts, error: productsError, isValidating: refreshingProducts } = useSWR(
    'local-purchasing-catalogue', getPurchasingCatalogueAction,
    { fallbackData: initialProducts, revalidateOnMount: true, shouldRetryOnError: false },
  )
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const [input, setInputState] = useState<OrderReviewInput>(source.input)
  const [acknowledgement, setAcknowledgement] = useState<{ revision: string; reason: string } | null>(null)
  const [actualRevision, setActualRevision] = useState<string | null>(null)
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const setInput = (update: SetStateAction<OrderReviewInput>) => {
    setAcknowledgement(null)
    setActualRevision(null)
    setError(null)
    setInputState(update)
  }
  const snapshot = order.issuedSnapshot!
  const comparison = useMemo(() => compareOrderDocument(snapshot, input, order.received, order.allocationRevision, Boolean(order.supplier.vatNumber)), [snapshot, input, order.received, order.allocationRevision, order.supplier.vatNumber])
  const revision = orderReviewRevision(comparison.revision, { documentId: source.id, documentRevision: source.documentRevision, reviewRevision: source.reviewRevision, reviewEpoch: order.reviewEpoch })
  const reason = acknowledgement?.revision === revision ? acknowledgement.reason : ''
  const actual = actualRevision === revision
  const amended = evidenceRevision(comparableEvidence(source.original)) !== evidenceRevision(comparableEvidence(input.document))
  const mappingConflicts = input.document.lines.flatMap((line) => {
    const match = supplierIdentityMatch({ supplierLabel: line.label, supplierCode: line.code, unit: line.unit }, catalogue).match
    const selected = input.products[line.key!]
    const conflict = match && selected ? supplierSelectionConflict(selected, match) : null
    return conflict ? [conflict] : []
  })
  if (conflictingSupplierSelections(input.document.lines.map((line) => ({ supplierLabel: line.label, supplierCode: line.code, unit: line.unit, ...input.products[line.key!] }))).size) {
    mappingConflicts.push('Identical supplier wording has different product or variant choices. Every row is retained, but no supplier mapping will be learned for these rows.')
  }
  const requiresReason = comparison.differences.length > 0 || amended || mappingConflicts.length > 0 || Object.values(input.overrides).some((value) => value != null)
  const typeException = !['invoice','receipt'].includes(input.document.docKind)
  const hasInvalidVariant = Object.values(input.products).some((line) => variantSelectionError(line.productId ? productsById.get(line.productId) : undefined, line.variantId))
  const canAccept = comparison.canAccept && !hasInvalidVariant && (!requiresReason || reason.trim().length >= 8)
  const canRecord = canAccept && actual && (!typeException || reason.trim().length >= 8)
  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products])
  const lineAmounts = new Map(comparison.receipt.lines.map((line) => [line.key, line]))
  const changeLine = (key: string, patch: Partial<ReceiptLine>) => {
    setError(null)
    setInput((current) => {
      const line = current.document.lines.find((item) => item.key === key)!
      const changedIdentity = ['label','code','unit'].some((field) => field in patch && patch[field as keyof ReceiptLine] !== line[field as keyof ReceiptLine])
      const products = { ...current.products }, decisions = { ...current.decisions }
      if (changedIdentity) { delete products[key]; delete decisions[key] }
      return { ...current, products, decisions, document: { ...current.document, lines: current.document.lines.map((item) => item.key === key ? { ...item, ...patch } : item) } }
    })
  }
  const identityKeys = (key: string) => {
    const line = input.document.lines.find((item) => item.key === key)!
    const identity = supplierIdentityKey({ supplierLabel: line.label, supplierCode: line.code, unit: line.unit })
    return input.document.lines.filter((item) => supplierIdentityKey({ supplierLabel: item.label, supplierCode: item.code, unit: item.unit }) === identity).map((item) => item.key!)
  }
  const allocate = (key: string, value: string) => {
    const keys = [key]
    setInput((current) => {
      const decisions = { ...current.decisions }, products = { ...current.products }
      for (const row of keys) {
        if (value === 'auto') delete decisions[row]
        else decisions[row] = value === 'extra' ? null : value
        const item = snapshot.lines.find((line) => line.id === value)
        if (item?.productId) {
          const previous = products[row]
          const keepManual = previous?.productId === item.productId && previous.variantSource === 'manual'
          products[row] = { ...(keepManual ? previous : clearedVariant), productId: item.productId, matchMethod: 'confirmed',
            ...(!keepManual ? { variantId: recordedVariantId(item), variantSource: recordedVariantId(item) ? 'order' as const : null } : {}) }
        }
      }
      return { ...current, decisions, products }
    })
  }
  const pickProduct = (key: string, productId: string | null) => {
    const keys = identityKeys(key)
    setInput((current) => ({ ...current, products: { ...current.products, ...Object.fromEntries(keys.map((row) => [row, {
      ...(current.products[row]?.productId === productId ? current.products[row] : clearedVariant), productId, matchMethod: productId ? 'manual' : 'unmatched',
    }])) } }))
  }
  const run = (mode: 'save' | 'accept' | 'record') => {
    setError(null)
    onBusyChange(true)
    const request: ReviewRequest = { orderId: order.id, documentId: source.id, orderRevision: order.revision, allocationRevision: order.allocationRevision,
      reviewEpoch: order.reviewEpoch, documentRevision: source.documentRevision, reviewRevision: source.reviewRevision, input,
      acknowledgement: reason.trim() ? { revision, reason } : null }
    startTransition(async () => {
      try {
        if (mode === 'record') {
          const result = await recordOrderPurchaseAction({ ...request, idempotencyKey, actualPurchase: actual })
          await onRecorded(result.id)
        } else { await saveOrderReviewAction(request, mode === 'accept'); await onSaved() }
      } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this review. Your edits are retained.') }
      finally { onBusyChange(false) }
    })
  }
  return <section className="flex min-w-0 flex-col gap-6" aria-label="Returned document review">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><h2 className="break-words text-xl font-semibold">Review {source.fileName}</h2><p className="text-sm text-muted-foreground">Against issued revision {snapshot.revision}. Original evidence is retained; checks update as you edit.</p></div>{source.sourceUrl && <Button asChild variant="outline"><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink data-icon="inline-start" />View original</a></Button>}</header>
    {source.accepted && evidenceRevision(input) === evidenceRevision(source.input) && <Alert><AlertTitle>Supplier confirmation accepted</AlertTitle><AlertDescription>No purchase, stock movement or payment was created by accepting the confirmation.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertTitle>Review not saved</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
      <FieldGroup className="sm:grid sm:grid-cols-4">
        <Field><FieldLabel htmlFor="returned-supplier">Supplier as printed</FieldLabel><Input id="returned-supplier" value={input.document.supplierName ?? ''} onChange={(event) => setInput({ ...input, document: { ...input.document, supplierName: event.target.value || null } })} /></Field>
        <Field><FieldLabel htmlFor="returned-vat">Printed supplier VAT number</FieldLabel><Input id="returned-vat" value={input.document.vatNumber ?? ''} onChange={(event) => setInput({ ...input, document: { ...input.document, vatNumber: event.target.value || null } })} /></Field>
        <Field><FieldLabel htmlFor="returned-reference">Document reference</FieldLabel><Input id="returned-reference" value={input.document.docRef ?? ''} onChange={(event) => setInput({ ...input, document: { ...input.document, docRef: event.target.value || null } })} /></Field>
        <Field><FieldLabel htmlFor="returned-date">Document date</FieldLabel><Input id="returned-date" type="date" value={input.document.docDate ?? ''} onChange={(event) => setInput({ ...input, document: { ...input.document, docDate: event.target.value || null } })} /></Field>
      </FieldGroup>
      <ReceiptCheckSummary check={comparison.receipt} />
      <ReceiptEvidenceEditor document={input.document} overrides={input.overrides} onDocument={(patch) => setInput({ ...input, document: { ...input.document, ...patch } })} onOverrides={(overrides) => setInput({ ...input, overrides })} />
      <section className="flex min-w-0 flex-col gap-3" aria-label="Ordered versus returned quantities"><h3 className="text-lg font-semibold">What changed from the order?</h3><Table><TableHeader><TableRow><TableHead>Supplier item</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Already recorded</TableHead><TableHead className="text-right">This document</TableHead><TableHead className="text-right">Still outstanding</TableHead></TableRow></TableHeader><TableBody>{comparison.rows.map((row) => <TableRow key={row.orderLineId}><TableCell>{row.label}<p className="text-sm text-muted-foreground">{row.unit || 'No unit stated'}</p>{row.variantSnapshot && <p className="text-sm text-muted-foreground">{variantDescription(row.variantSnapshot)}</p>}</TableCell><TableCell className="text-right font-mono">{row.ordered}</TableCell><TableCell className="text-right font-mono">{row.previouslyRecorded}</TableCell><TableCell className="text-right font-mono">{row.thisDocument}</TableCell><TableCell className="text-right font-mono">{row.remainingAfter}</TableCell></TableRow>)}</TableBody></Table>
        {comparison.differences.length ? <ul className="flex flex-col gap-3 text-sm leading-relaxed">{comparison.differences.map((difference, index) => <li key={index} className="flex flex-wrap items-start gap-2"><Badge variant={difference.blocking ? 'destructive' : 'outline'}>{difference.kind}</Badge><span className="min-w-0 flex-1">{difference.message}{difference.expected != null && <> Expected: {difference.expected}. Actual: {difference.actual ?? 'not stated'}.</>}</span>{difference.lineKey && <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(`receipt-line-${difference.lineKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Go to item</Button>}</li>)}</ul> : <p className="text-sm text-muted-foreground">Quantities, payable and accounting prices, VAT, discount terms and charges match the issued order.</p>}
      </section>
      {mappingConflicts.length > 0 && <Alert><AlertTitle>Supplier product mapping conflict</AlertTitle><AlertDescription>{mappingConflicts.map((conflict) => <p key={conflict}>{conflict}</p>)}</AlertDescription></Alert>}
      <section className="flex min-w-0 flex-col gap-4" aria-label="Returned document rows"><h3 className="text-lg font-semibold">Supplier document rows</h3><p className="text-sm text-muted-foreground">Repeated rows stay separate. Parent-product decisions apply to identical descriptions, codes and units; variant and allocation choices affect only the selected row.</p>
        {input.document.lines.map((line, index) => {
          const key = line.key!
          const allocation = comparison.allocations.find((item) => item.lineKey === key)
          const selected = input.products[key]?.productId
          const orderedItem = snapshot.lines.find((item) => item.id === allocation?.orderLineId)
          return <article id={`receipt-line-${key}`} key={key} className="rounded-lg border border-border bg-card p-4 text-card-foreground"><div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Source row {line.sourceRow || index + 1}</p><Button type="button" variant="ghost" size="sm" onClick={() => setInput((current) => { const decisions = { ...current.decisions }, products = { ...current.products }; delete decisions[key]; delete products[key]; return { ...current, decisions, products, document: { ...current.document, lines: current.document.lines.filter((item) => item.key !== key) } } })}><Trash2 data-icon="inline-start" />Remove row</Button></div>
            <FieldGroup className="sm:grid sm:grid-cols-6"><Field className="sm:col-span-2"><FieldLabel htmlFor={`${key}-label`}>Supplier description</FieldLabel><Input id={`${key}-label`} value={line.label} onChange={(event) => changeLine(key, { label: event.target.value })} /></Field><Field><FieldLabel htmlFor={`${key}-code`}>Code</FieldLabel><Input id={`${key}-code`} value={line.code ?? ''} onChange={(event) => changeLine(key, { code: event.target.value || null })} /></Field><Field><FieldLabel htmlFor={`${key}-unit`}>Purchasing unit</FieldLabel><Input id={`${key}-unit`} value={line.unit ?? ''} onChange={(event) => changeLine(key, { unit: event.target.value || null })} /></Field><Field><FieldLabel htmlFor={`${key}-qty`}>Quantity</FieldLabel><Input id={`${key}-qty`} type="number" min="0" step="any" value={line.qty ?? ''} onChange={(event) => changeLine(key, { qty: nullableNumber(event.target.value) })} /></Field><Field><FieldLabel htmlFor={`${key}-price`}>Unit price — as printed</FieldLabel><Input id={`${key}-price`} type="number" min="0" step="any" value={line.unitPrice ?? ''} onChange={(event) => changeLine(key, { unitPrice: nullableNumber(event.target.value) })} /></Field></FieldGroup>
            <SupplierUnitCost amounts={lineAmounts.get(key)?.unitAmounts ?? null} />
            <Field><FieldLabel htmlFor={`${key}-allocation`}>Allocate to an ordered item</FieldLabel><Select value={Object.prototype.hasOwnProperty.call(input.decisions, key) ? input.decisions[key] ?? 'extra' : 'auto'} onValueChange={(value) => allocate(key, value)}><SelectTrigger id={`${key}-allocation`}><SelectValue placeholder="Choose an order item" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="auto">Automatic match</SelectItem><SelectItem value="extra">Extra item — not ordered</SelectItem>{snapshot.lines.map((item) => <SelectItem key={item.id} value={item.id}>{item.supplierLabel} · {item.supplierCode || 'no code'} · {item.unit || 'no unit'}{item.variantSnapshot ? ` · ${variantDescription(item.variantSnapshot)}` : ' · Variant not specified'}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>{orderedItem ? allocation?.method === 'unresolved' ? `Selected order item: ${orderedItem.supplierLabel}. Resolve the product, variant or unit difference before quantities can be allocated.` : `Allocated to ${orderedItem.supplierLabel}; split rows are added together for quantities.` : allocation?.method === 'extra' ? 'This is explicitly outside the order and will require acceptance.' : 'No safe allocation yet. Choose the intended item or mark this as an extra.'}</FieldDescription></Field>
            <div className="flex flex-wrap items-center gap-3"><p className="text-sm">Inventory: {selected ? productNames.get(selected) ?? 'Linked product' : 'Not linked'}</p><ProductPicker products={products} onPick={(product) => pickProduct(key, product.id)} />{selected && <Button type="button" variant="ghost" size="sm" onClick={() => pickProduct(key, null)}>Clear product</Button>}{orderedItem?.productId && selected !== orderedItem.productId && <Button type="button" variant="outline" size="sm" onClick={() => pickProduct(key, orderedItem.productId)}>Use the order&apos;s Inventory product</Button>}</div>
            {selected && <ExistingVariantPicker id={`${key}-variant`} product={productsById.get(selected)} value={input.products[key]?.variantId} source={input.products[key]?.variantSource}
              onChange={(variantId) => setInput((current) => ({ ...current, products: { ...current.products, [key]: { ...current.products[key], variantId, variantSource: 'manual', variantCleared: !variantId } } }))}
              loadError={Boolean(productsError)} loading={refreshingProducts} onRefresh={() => { setAcknowledgement(null); setActualRevision(null); void refreshProducts().catch(() => {}) }} />}
            <ReceiptLineEvidenceEditor line={line} onChange={(patch) => changeLine(key, patch)} /><ReceiptIssues issues={comparison.receipt.issues.filter((issue) => issue.lineKey === key)} />
          </div></article>
        })}
        <div><Button type="button" variant="outline" onClick={() => setInput({ ...input, document: { ...input.document, lines: [...input.document.lines, { key: crypto.randomUUID(), label: '', code: null, unit: null, qty: null, unitPrice: null, lineTotal: null, sourceRow: 'Buyer-added row' }] } })}><Plus data-icon="inline-start" />Add a missed row</Button></div>
      </section>
      {hasInvalidVariant && <Alert variant="destructive"><AlertDescription>Choose an active variant or clear the unavailable selection before accepting or recording this document.</AlertDescription></Alert>}
      <section aria-label="Record purchase confirmation" className="rounded-lg border border-border bg-card p-4 text-card-foreground">
        <PurchaseAcknowledgement actual={actual} onActual={(value) => setActualRevision(value ? revision : null)} requiresReason={requiresReason || (actual && typeException)} reason={reason} onReason={(value) => setAcknowledgement({ revision, reason: value })} />
      </section>
      <p className="text-sm leading-relaxed text-muted-foreground">Accept confirmation only keeps the order open and records no purchase. Confirm and record purchase records this document&apos;s quantities once; any remaining quantity stays open. Neither action posts stock or payment.</p>
      <div className="flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" disabled={pending} onClick={() => run('save')}>Save review for later</Button><Button type="button" variant="outline" disabled={pending || !canAccept} onClick={() => run('accept')}>Accept confirmation only</Button><Button type="button" disabled={pending || !canRecord} onClick={() => run('record')}>{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}Confirm and record purchase</Button></div>
    </fieldset>
  </section>
}
