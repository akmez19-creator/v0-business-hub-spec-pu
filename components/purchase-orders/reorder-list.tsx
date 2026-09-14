'use client'

import { Fragment, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { loadSupplierQualitySummariesAction, confirmSupplierIdentityAction } from '@/app/dashboard/purchasing/suppliers/actions'
import { saveReorderItemAction } from '@/app/dashboard/purchasing/reorders/actions'
import { latestReorderReference, sameBaseContext } from '@/lib/purchase-orders/1688-comparison'
import type { ComparisonContext1688, SavedCheck1688, SupplierQualitySummary, TargetConfirmation1688 } from '@/lib/purchase-orders/1688-types'
import type { ResearchQueueStatus, SourcingSelection } from '@/lib/purchase-orders/1688-sourcing-types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProductPicker } from '@/components/local-purchasing/product-picker'
import { ProductThumb } from '@/components/ui/product-thumb'
import { cn } from '@/lib/utils'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import type { SavedReorderItem } from '@/lib/purchase-orders/workflow'
import { newReorderLine } from '@/lib/purchase-orders/workflow'
import { copyImportReference } from '@/lib/purchase-orders/reorder-reference'
import { PurchaseError } from './reorder-fields'
import { ReorderFlow, expectedCost, formatDiscountPercent, type InterestItem } from './reorder-flow'
import { Check1688Cell, Check1688Details, Check1688Remarks, Check1688Toolbar, fetch1688, has1688Link, type Check1688State } from './check-1688-cell'
import { useResearchQueue } from './use-research-queue'
import { Sourcing1688Panel, SourcingSummary } from './sourcing-1688-panel'

const cny = (value: number) => `¥${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const mur = (value: number) => `Rs ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
function readQuantity(raw: string) {
  const value = raw.trim() === '' ? null : Number(raw)
  const valid = value === null || Number.isSafeInteger(value) && value > 0
  return { qty: valid ? value : null, valid }
}
export { ReorderList }

function ReorderList({ catalogue, items, contexts = {}, initialChecks = [], initialQuality = [], initialQueue, initialSelections = [], researchError = null }: {
  catalogue: ReorderCatalogue; items: SavedReorderItem[]; contexts?: Record<string, ComparisonContext1688>; initialChecks?: SavedCheck1688[]
  initialQuality?: SupplierQualitySummary[]; initialQueue?: ResearchQueueStatus; initialSelections?: SourcingSelection[]; researchError?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(items.length === 0)
  const [qtyDraft, setQtyDraft] = useState<Record<string, { raw: string; revision: number }>>({})
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [chosenOffers, setChosenOffers] = useState<Record<string, string>>({})
  const [reviewFocus, setReviewFocus] = useState<{ itemId: string; version: number } | null>(null)
  const [targetOverrides, setTargetOverrides] = useState<Record<string, SavedCheck1688>>({})
  const [showProgress, setShowProgress] = useState(false)
  const mutationsRef = useRef(0)
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const queue = useResearchQueue(initialQueue)
  const running = queue.progress?.running ?? false
  const { data: quality = initialQuality, mutate: mutateQuality, error: qualityError } = useSWR('supplier-quality-summaries', loadSupplierQualitySummariesAction, { fallbackData: initialQuality, revalidateOnFocus: true, shouldRetryOnError: false })
  const checks = useMemo(() => {
    const map = new Map<string, SavedCheck1688>()
    for (const check of [...initialChecks, ...(queue.data?.checks ?? []), ...Object.values(targetOverrides)]) {
      const prior = map.get(check.item_id)
      if (!prior || check.generation > prior.generation || check.generation === prior.generation && check.version >= prior.version) map.set(check.item_id, check)
    }
    return map
  }, [initialChecks, queue.data?.checks, targetOverrides])
  // The interest list is the active saved items; excluded ones are removed.
  const active = useMemo(() => items.filter(item => item.status !== 'excluded'), [items])
  const products = useMemo(() => new Map(catalogue.products.map(product => [product.id, product])), [catalogue.products])
  const existingProductIds = useMemo(() => new Set(active.flatMap(item => item.item.productId ? [item.item.productId] : [])), [active])
  const rows = useMemo(() => active.map(saved => {
    const product = products.get(saved.item.productId ?? '')
    const reference = saved.item.productId ? latestReorderReference(saved.item.productId, catalogue.references, saved.item.variantId) : null
    const hasOtherHistory = !reference && catalogue.references.some(imported => imported.product_id === saved.item.productId)
    const draft = qtyDraft[saved.id]
    const rawQty = draft?.revision === saved.revision ? draft.raw : String(saved.item.qty ?? '')
    const { qty, valid } = readQuantity(rawQty)
    const base = contexts[saved.id]
    const context = base ? { ...base, itemRevision: saved.revision, qty, savedItem: { ...base.savedItem, qty } } : null
    const link = context?.sourceLink ?? reference?.link ?? null
    return { saved, product, reference, hasOtherHistory, rawQty, qty, validQty: valid, unsettledQty: !valid || qty !== saved.item.qty, context, link, name: product?.name ?? saved.item.productName, cost: expectedCost(reference, qty, null), checkable: !researchError && !!saved.item.productId && (has1688Link(link) || (product?.name ?? saved.item.productName).trim().length > 1) }
  }), [active, products, catalogue.references, qtyDraft, contexts, researchError])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const stateFor = (row: (typeof rows)[number]): Check1688State => {
    const check = checks.get(row.saved.id)
    const job = queue.jobs.get(row.saved.id)
    const stale = check && (!row.validQty || row.unsettledQty || !row.context || !sameBaseContext(check.context, row.context))
    const currentJob = job && job.item_revision === row.saved.revision
    const status: Check1688State['status'] = stale ? 'stale' : currentJob && job.status === 'queued' ? 'queued' : currentJob && job.status === 'running' ? 'loading' : currentJob && ['interrupted', 'failed'].includes(job.status) ? 'error' : check ? 'done' : currentJob && job.status === 'stopped' ? 'skipped' : 'idle'
    return { status, check: check ? { ...check, isCurrent: !stale } : undefined, message: currentJob ? job.reason ?? undefined : undefined }
  }
  const isLocked = (id: string) => { const job = queue.jobs.get(id); return !!job && ['queued', 'running'].includes(job.status) && queue.data?.runs.find(run => run.id === job.run_id)?.status !== 'dispatch_unknown' }
  const runChecks = async (ids: string[], mode?: 'fresh' | 'resume') => {
    if (pending || mutationsRef.current || queue.submitting) return
    const chosen = rowsRef.current.filter(row => ids.includes(row.saved.id) && row.checkable)
    if (!chosen.length || chosen.some(row => row.unsettledQty)) return
    setError(null); setShowProgress(true)
    try {
      await queue.submit(chosen.map(row => { const state = stateFor(row); return { itemId: row.saved.id, revision: row.saved.revision, generation: state.check?.generation ?? 0, version: state.check?.version ?? 0, mode: mode ?? (state.check && state.check.status !== 'complete' && state.status !== 'stale' ? 'resume' : 'fresh') } }))
      requestAnimationFrame(() => { const container = tableAreaRef.current?.querySelector<HTMLElement>('[data-slot=table-container]'); const heading = container?.querySelector<HTMLElement>('[data-1688-heading]'); if (container && heading) container.scrollBy({ left: heading.getBoundingClientRect().right - container.getBoundingClientRect().right, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Submission was not acknowledged. Reload status before retrying.'); router.refresh() }
  }
  const confirmResearchTarget = async (id: string, target: TargetConfirmation1688) => {
    const row = rowsRef.current.find(row => row.saved.id === id)
    const check = checks.get(id)
    if (!row || !check || isLocked(id) || row.unsettledQty || stateFor(row).status === 'stale') throw new Error('Finish the background check and review current saved evidence first.')
    const response = await fetch1688({ operation: 'confirm-target', itemId: id, revision: row.saved.revision, generation: check.generation, version: check.version, requestKey: crypto.randomUUID(), runKey: check.run_key, target })
    if (!response.check || response.status === 'error') throw new Error(response.message || 'Target could not be saved')
    setTargetOverrides(value => ({ ...value, [id]: response.check! })); await queue.mutate(); router.refresh()
  }
  const confirmIdentity = async (id: string, offerId: string, supplierName: string) => {
    const check = checks.get(id)
    if (!check) throw new Error('Save research before linking a supplier identity.')
    await mutateQuality(await confirmSupplierIdentityAction({ itemId: id, generation: check.generation, offerId, supplierName, confirmed: true }), { revalidate: false })
    router.refresh()
  }
  const persist = (saved: SavedReorderItem) => saveReorderItemAction({ id: saved.id, item: saved.item, supplierName: saved.supplierName, status: saved.status, priority: saved.priority, reviewDate: saved.reviewDate, revision: saved.revision, requestKey: crypto.randomUUID() })
  const mutateRow = (operation: () => Promise<void>) => {
    setError(null); mutationsRef.current++
    startTransition(async () => { try { await operation(); router.refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the list.') } finally { mutationsRef.current-- } })
  }
  const addMany = (interest: InterestItem[]) => mutateRow(async () => {
    for (const entry of interest) { const line = { ...newReorderLine(entry.product), qty: entry.qty }; await persist({ id: crypto.randomUUID(), item: entry.reference ? copyImportReference(line, entry.reference) : line, supplierName: '', status: 'active', priority: 2, reviewDate: null, revision: 0, updatedAt: '' }) }
    setShowAdd(false)
  })
  const updateQty = (saved: SavedReorderItem, raw: string) => {
    if (isLocked(saved.id)) return
    const { qty, valid } = readQuantity(raw)
    if (!valid) { setError('Enter a positive whole-number quantity, or leave it empty.'); return }
    if (qty !== saved.item.qty) mutateRow(async () => { await persist({ ...saved, item: { ...saved.item, qty } }) })
  }
  const remove = (saved: SavedReorderItem) => { if (!isLocked(saved.id)) mutateRow(async () => { await persist({ ...saved, status: 'excluded' }); setSelected(current => { const next = new Set(current); next.delete(saved.id); return next }) }) }
  const totals = useMemo(() => rows.reduce((total, row) => ({ units: total.units + (row.qty ?? 0), yuan: total.yuan + (row.cost.totalYuan ?? 0), mur: total.mur + (row.cost.totalMur ?? 0), murCovered: total.murCovered + (row.cost.totalMur != null ? 1 : 0), unpriced: total.unpriced + (row.cost.totalYuan == null ? 1 : 0) }), { units: 0, yuan: 0, mur: 0, murCovered: 0, unpriced: 0 }), [rows])
  const eligible = rows.filter(row => row.checkable)
  const selectedRows = eligible.filter(row => selected.has(row.saved.id))
  const allSelected = eligible.length > 0 && selectedRows.length === eligible.length
  const failedIds = eligible.filter(row => { const state = stateFor(row); return !isLocked(row.saved.id) && !row.unsettledQty && (state.status === 'error' || state.check && state.check.status !== 'complete' && state.status !== 'stale') }).map(row => row.saved.id)
  const processIssue = pending ? 'Wait for quantity changes to finish saving.' : selectedRows.some(row => row.unsettledQty) ? 'Finish saving a valid quantity, or leave it empty.' : queue.error ? 'Reload background status before submitting more paid work.' : null
  const toggleExpanded = (id: string, force = false) => setExpanded(value => { const next = new Set(value); if (next.has(id) && !force) next.delete(id); else next.add(id); return next })
  const openSourcingReview = (itemId: string, offerId?: string) => {
    toggleExpanded(itemId, true)
    if (offerId) setChosenOffers(value => ({ ...value, [itemId]: offerId }))
    setReviewFocus(value => ({ itemId, version: (value?.version ?? 0) + 1 }))
  }
  return <div className="flex min-w-0 flex-col gap-6 font-sans">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-balance text-2xl font-semibold tracking-tight">Reorders</h1><p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Your China reorder interest list. Research and saved replacements are proposals only; a separate final confirmation records a new import.</p></div><Button onClick={() => setShowAdd(value => !value)} disabled={pending}><Plus data-icon="inline-start" />{showAdd ? 'Hide' : 'Add products'}</Button></div>
    <PurchaseError error={error || researchError || queue.error?.message || (qualityError ? 'Supplier quality warnings could not be refreshed. Do not assume an absence of warnings means no issues.' : null)} />
    {showAdd && <Card><CardHeader><CardTitle>Add to the list</CardTitle><CardDescription>Paste your product list and quantities, or pick one catalogue product. Historical figures are reference estimates only.</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-4"><ReorderFlow products={catalogue.products} references={catalogue.references} fxRate={null} disabled={pending} existingProductIds={existingProductIds} onAddMany={addMany} /><ProductPicker products={catalogue.products} disabled={pending} onPick={product => addMany([{ product, qty: null, reference: latestReorderReference(product.id, catalogue.references) }])} /></div></CardContent></Card>}
    <Card className="min-w-0"><CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle>{active.length} product{active.length === 1 ? '' : 's'} on the list</CardTitle><CardDescription>{totals.units.toLocaleString()} units{totals.yuan > 0 ? ` · Total Payment ${cny(totals.yuan)}` : ''}{totals.murCovered ? ` · ${mur(totals.mur)}` : ''}{totals.unpriced ? ` · ${totals.unpriced} without a price or quantity` : ''}<span className="block">Started checks continue in the background. No paid calls on opening, selecting or restoring this page.</span></CardDescription></div>{!selecting && eligible.length > 0 && <Button variant="outline" onClick={() => { setSelecting(true); setSelected(new Set()) }} disabled={pending || queue.submitting} aria-controls="reorder-1688-controls"><RefreshCw data-icon="inline-start" />Check on 1688</Button>}</div></CardHeader>
      <CardContent ref={tableAreaRef} className="@container/reorders min-w-0 px-3 sm:px-6 [&>[data-slot=table-container]]:max-h-[70vh] [&>[data-slot=table-container]]:rounded-lg [&>[data-slot=table-container]]:border [&>[data-slot=table-container]]:border-border">
        {(selecting || running || showProgress) && <div className="pb-4"><Check1688Toolbar selecting={selecting} selectedCount={selectedRows.length} eligibleCount={eligible.length} missingCount={rows.length - eligible.length} allSelected={allSelected} pending={pending || queue.submitting} progress={queue.progress} processIssue={processIssue} failedCount={failedIds.length}
          onSelectAll={() => setSelected(new Set(eligible.map(row => row.saved.id)))} onClear={() => setSelected(new Set())} onProcess={() => void runChecks(selectedRows.map(row => row.saved.id))} onRetryFailed={() => void runChecks(failedIds)} onStop={() => void queue.stop().catch(cause => setError(cause.message))} onDone={() => { setSelecting(false); setSelected(new Set()); setShowProgress(false) }} /></div>}
        {queue.data?.runs.filter(run => run.status === 'dispatch_unknown').map(run => <div key={run.id} className="pb-4"><div className="flex flex-wrap items-center gap-3 text-sm"><span>{run.reason}</span><Button variant="outline" size="sm" onClick={() => void queue.redispatch(run.id).catch(cause => setError(cause.message))}>Retry background dispatch</Button><Button variant="ghost" size="sm" onClick={() => void queue.stop().catch(cause => setError(cause.message))}>Stop remaining</Button></div></div>)}
        {!active.length ? <p className="text-sm text-muted-foreground">Nothing on the list yet. Use Add products to paste your list or pick from the catalogue.</p> : <Table className="table-fixed" style={{ minWidth: selecting ? 1948 : 1904 }} aria-label="Reorder interest list"><TableHeader><TableRow className="hover:bg-transparent">
          {selecting && <TableHead className="sticky top-0 z-20 w-11 bg-card text-card-foreground sm:left-0"><Checkbox aria-label="Select all products eligible for 1688 research" checked={allSelected ? true : selectedRows.length ? 'indeterminate' : false} disabled={running || !eligible.length} onCheckedChange={checked => setSelected(checked ? new Set(eligible.map(row => row.saved.id)) : new Set())} /></TableHead>}
          <TableHead className={cn('sticky top-0 z-20 w-56 bg-card text-card-foreground', selecting ? 'sm:left-11' : 'sm:left-0')}>Product</TableHead><TableHead className="sticky top-0 z-10 w-24 bg-card text-card-foreground">Qty</TableHead>
          {[['Unit Price', 'w-24'], ['Discounted Unit Price', 'w-28'], ['Shipment to Warehouse', 'w-28'], ['Discounted Shipment', 'w-28'], ['Discount %', 'w-20'], ['Total Payment CNY', 'w-32'], ['Total Payment MUR', 'w-32']].map(([label, width]) => <TableHead key={label} className={cn('sticky top-0 z-10 whitespace-normal bg-card py-3 text-right leading-snug text-card-foreground', width)}>{label}</TableHead>)}
          <TableHead className="sticky top-0 z-10 w-40 bg-card text-card-foreground">Last import</TableHead><TableHead data-1688-heading className="sticky top-0 z-10 w-64 bg-card text-card-foreground">1688 now</TableHead><TableHead className="sticky top-0 z-10 w-72 bg-card text-card-foreground">1688 remarks</TableHead><TableHead className="sticky top-0 z-10 w-11 bg-card text-card-foreground"><span className="sr-only">Remove</span></TableHead>
        </TableRow></TableHeader><TableBody>{rows.map(row => {
          const { saved, product, reference, qty, cost } = row
          const state = stateFor(row); const isSelected = selecting && selected.has(saved.id) && row.checkable; const isExpanded = expanded.has(saved.id)
          const locked = pending || isLocked(saved.id); const detailsId = `1688-details-${saved.id}`
          const selection = initialSelections.find(value => value.item_id === saved.id && value.status === 'pending') ?? initialSelections.find(value => value.item_id === saved.id && value.status === 'confirmed')
          const job = queue.jobs.get(saved.id)
          const dash = <span className="text-muted-foreground">—</span>; const money = (value: number | null) => value != null ? cny(value) : dash
          return <Fragment key={saved.id}><TableRow data-state={isSelected ? 'selected' : undefined} data-reorder-id={saved.id}>
            {selecting && <TableCell className={cn('sm:sticky sm:left-0 sm:z-10', isSelected ? 'bg-muted text-foreground' : 'bg-card text-card-foreground')}><Checkbox aria-label={`Select ${row.name} for 1688 check`} checked={isSelected} disabled={running || !row.checkable} onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked) next.add(saved.id); else next.delete(saved.id); return next })} /></TableCell>}
            <TableCell className={cn('border-r border-border sm:sticky sm:z-10', selecting ? 'sm:left-11' : 'sm:left-0', isSelected ? 'bg-muted text-foreground' : 'bg-card text-card-foreground')}><div className="flex items-center gap-3"><ProductThumb src={product?.imageUrl ?? saved.item.imageUrl} alt={row.name} className="size-10 shrink-0 rounded-lg" /><span className="whitespace-normal break-words font-medium leading-snug">{row.name}{saved.item.variantLabel && <span className="block text-sm text-muted-foreground">{saved.item.variantLabel}</span>}</span></div></TableCell>
            <TableCell><Input type="number" inputMode="numeric" min={1} step={1} aria-label={`Quantity for ${row.name}`} aria-invalid={!row.validQty} placeholder="Not set" disabled={locked} value={row.rawQty} onChange={event => setQtyDraft(value => ({ ...value, [saved.id]: { raw: event.target.value, revision: saved.revision } }))} onBlur={event => updateQty(saved, event.target.value)} className="h-8 w-20" /></TableCell>
            <TableCell className="text-right tabular-nums">{money(cost.unitPrice)}</TableCell><TableCell className="text-right tabular-nums">{money(cost.discountedUnitPrice)}</TableCell><TableCell className="text-right tabular-nums">{money(cost.shipment)}</TableCell><TableCell className="text-right tabular-nums">{money(cost.discountedShipment)}</TableCell><TableCell className="text-right tabular-nums">{cost.discountPercent != null ? formatDiscountPercent(cost.discountPercent) : dash}</TableCell><TableCell className="text-right font-medium tabular-nums">{cost.totalYuan != null ? cny(cost.totalYuan) : <span className="whitespace-normal text-sm text-muted-foreground">{reference?.referenceWarning ? 'Suspect price' : !reference ? row.hasOtherHistory ? 'No matching price' : 'No history' : 'Needs qty'}</span>}</TableCell><TableCell className="text-right tabular-nums">{cost.totalMur != null ? mur(cost.totalMur) : dash}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{reference ? <div className="flex flex-col"><span className="truncate text-foreground" title={reference.supplier_name ?? undefined}>{reference.supplier_name || 'Supplier unknown'}</span><span>{reference.qty?.toLocaleString() ?? '?'} u{reference.order_date ? ` · ${reference.order_date.slice(0, 10)}` : ''}</span></div> : row.hasOtherHistory ? <div className="flex flex-col whitespace-normal"><span className="text-foreground">Other imports on file</span><span>No same-variant reference</span></div> : 'Never imported'}</TableCell>
            <TableCell className="whitespace-normal"><div className="flex flex-col gap-3"><Check1688Cell link={row.link} qty={qty} listUnitPrice={cost.unitPrice} state={state} disabled={pending || isLocked(saved.id) || queue.submitting || !!queue.error || row.unsettledQty} selecting={selecting} selected={isSelected} productName={row.name} expanded={isExpanded} detailsId={detailsId} checkable={row.checkable} onCheck={() => void runChecks([saved.id])} onFreshCheck={() => void runChecks([saved.id], 'fresh')} onToggleDetails={() => toggleExpanded(saved.id)} />{job && <p className="text-sm tabular-nums text-muted-foreground">Attempts: {job.tmapi_actual} TMAPI / {job.ai_actual} AI saved · {job.tmapi_reserved} / {job.ai_reserved} reserved of 15 / 7. Remaining: {15 - job.tmapi_reserved} / {7 - job.ai_reserved}.</p>}{selection && <SourcingSummary selection={selection} onReview={() => openSourcingReview(saved.id)} />}</div></TableCell>
            <TableCell className="whitespace-normal"><Check1688Remarks state={state} quality={quality} fallbackSupplier={reference?.supplier_name ?? saved.supplierName} /></TableCell><TableCell><Button size="icon-sm" variant="ghost" aria-label={`Remove ${row.name}`} disabled={locked} onClick={() => remove(saved)}><Trash2 data-icon="inline-start" /></Button></TableCell>
          </TableRow>{isExpanded && (state.check || selection) && <TableRow className="bg-muted/20 text-foreground hover:bg-muted/20"><TableCell colSpan={selecting ? 14 : 13} className="whitespace-normal p-0"><div className="sticky left-0 w-[calc(100cqw-2px)] max-w-full p-4 @3xl/reorders:p-6"><div className="flex min-w-0 flex-col gap-6">
            {state.check && <Check1688Details id={detailsId} productName={row.name} state={state} qty={qty} listUnitPrice={cost.unitPrice} discountedUnitPrice={cost.discountedUnitPrice} ourShipmentPerOrder={cost.discountedShipment ?? cost.shipment} quality={quality} suppliers={catalogue.suppliers} disabled={locked || row.unsettledQty} onConfirmTarget={target => confirmResearchTarget(saved.id, target)} onConfirmIdentity={(offerId, name) => confirmIdentity(saved.id, offerId, name)} onChooseOffer={offerId => openSourcingReview(saved.id, offerId)} />}
            <Sourcing1688Panel check={state.check ?? selection!.snapshot.check} chosenOfferId={chosenOffers[saved.id] ?? null} focusRequest={reviewFocus?.itemId === saved.id ? reviewFocus.version : 0} disabled={locked || row.unsettledQty} onChoose={offerId => setChosenOffers(value => ({ ...value, [saved.id]: offerId }))} />
          </div></div></TableCell></TableRow>}</Fragment>
        })}</TableBody></Table>}
        {(pending || queue.submitting) && <div className="pt-3"><p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{queue.submitting ? 'Saving accepted background jobs…' : 'Saving…'}</p></div>}
      </CardContent></Card>
  </div>
}
