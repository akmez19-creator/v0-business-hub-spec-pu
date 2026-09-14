'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Check, ImagePlus, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { cancelSourcingSelectionAction, confirmSourcingSelectionAction, getSourcingWorkspaceAction, prepareSourcingPhotosAction, saveSourcingSelectionAction } from '@/app/dashboard/purchasing/reorders/actions'
import { catalogueMembership, initialSkuReviews, reviewSourcing, skuDescription, sourcingPurchasePreview, supplierPhoto } from '@/lib/purchase-orders/1688-sourcing-review'
import { stableEvidence } from '@/lib/purchase-orders/1688-comparison'
import { calculateReorder } from '@/lib/purchase-orders/reorder-calculations'
import { purchaseMoney } from '@/lib/purchase-orders/workflow'
import type { SavedCheck1688 } from '@/lib/purchase-orders/1688-types'
import type { SkuReview, SourcingInput, SourcingSelection, SourcingTerms, SourcingWorkspace } from '@/lib/purchase-orders/1688-sourcing-types'
import { SupplierSkuTable } from './supplier-sku-table'

export function SourcingSummary({ selection, onReview }: { selection: SourcingSelection; onReview: () => void }) {
  const difference = selection.snapshot.rows.filter(row => row.review.include && row.review.qty).map(row => row.difference.goods)
  const known = difference.filter((value): value is number => value != null)
  const total = known.reduce((sum, value) => sum + value, 0)
  return <div className="flex flex-col gap-2 text-sm">
    <Badge variant="outline">{selection.status === 'confirmed' ? 'New import recorded' : 'Replacement saved · not ordered'}</Badge>
    <p className="break-words">{selection.snapshot.source.supplier.name} · {selection.snapshot.orderedQty} {selection.status === 'confirmed' ? 'recorded' : 'proposed'} units</p>
    <p className="tabular-nums text-muted-foreground">At saved review: {known.length ? `${total > 0 ? '+' : total < 0 ? '−' : ''}¥${Math.abs(total).toFixed(2)} goods · ${known.length}/${difference.length} comparable lines` : 'no verified price difference'}</p>
    {selection.status === 'confirmed' ? selection.result?.imports.map(value => <Link key={value.id} href={`/dashboard/purchasing/imports/${value.id}`} className="text-primary underline-offset-4 hover:underline">Open new import {value.index}</Link>) : <Button size="sm" variant="outline" onClick={onReview}>Review new purchase</Button>}
  </div>
}
function SourcingEditor({ check, offerId, workspace, disabled, onSaved }: { check: SavedCheck1688; offerId: string; workspace: SourcingWorkspace; disabled: boolean; onSaved: (selection: SourcingSelection) => Promise<void> }) {
  const existing = workspace.selection?.status === 'pending' ? workspace.selection : null
  const savedInput = existing?.snapshot.source.offerId === offerId ? existing.snapshot.input : null
  const offer = check.evidence.current?.offerId === offerId ? check.evidence.current : check.evidence.offers[offerId]
  const changedGuard = existing && stableEvidence(existing.guard) !== stableEvidence(workspace.guard)
  const [input, setInput] = useState<SourcingInput>(() => ({ itemId: workspace.guard.item.id, itemRevision: workspace.guard.item.revision, generation: check.generation, checkVersion: check.version, offerId, guardHash: workspace.guardHash,
    selectionId: existing?.id ?? crypto.randomUUID(), selectionRevision: existing?.revision ?? 0, preferenceRevision: workspace.preference?.revision ?? 0,
    convertToVariants: savedInput?.convertToVariants ?? false, quantityDifferenceAccepted: !changedGuard && !!savedInput?.quantityDifferenceAccepted, unverifiedTermsAccepted: !changedGuard && !!savedInput?.unverifiedTermsAccepted,
    reviews: savedInput ? savedInput.reviews.map(row => changedGuard ? { ...row, reviewed: false, samePreviousUnit: false } : row) : offer ? initialSkuReviews(check, offer, workspace.guard) : [], requestKey: crypto.randomUUID() }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const reviewed = useMemo(() => offer ? reviewSourcing(input, check, workspace.guard, existing?.photos) : null, [input, check, workspace.guard, existing?.photos, offer])
  if (!offer || !reviewed) return <p role="alert">This saved offer is unavailable.</p>
  const included = reviewed.rows.filter(row => row.review.include)
  const blockers = [...new Set(included.flatMap(row => row.blockers))]
  const patch = (change: Partial<SourcingInput>) => { setError(''); setInput(value => ({ ...value, ...change, requestKey: crypto.randomUUID() })) }
  const changeRow = (skuId: string, change: Partial<SkuReview>) => patch({ reviews: input.reviews.map(row => row.skuId === skuId ? { ...row, ...change } : row), quantityDifferenceAccepted: false, unverifiedTermsAccepted: false })
  const save = async () => {
    if (lock.current || disabled) return
    lock.current = true; setBusy(true); setError('')
    try { const selection = await saveSourcingSelectionAction(input); await onSaved(selection); toast.success('Replacement saved. No purchase or Inventory change yet.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Replacement could not be saved') }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="flex min-w-0 flex-col gap-4">
    <Alert><AlertTitle>Review the catalogue separately from today&apos;s purchase</AlertTitle><AlertDescription>Included, reviewed SKUs will be linked to Inventory only at final confirmation. Enter quantities only for the SKUs you are buying. No stock, retail price or original purchase is changed by saving.</AlertDescription></Alert>
    {!workspace.guard.product.has_variants && <label className="flex items-start gap-2 text-sm"><Checkbox checked={input.convertToVariants} disabled={disabled || busy} onCheckedChange={checked => patch({ convertToVariants: checked === true, reviews: input.reviews.map(row => ({ ...row, reviewed: false })) })} /><span>Explicitly convert this simple product to variant management. Existing parent stock must be exactly zero. Buying only one supplier SKU does not require conversion.</span></label>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm tabular-nums">{included.length} Inventory SKUs included · {reviewed.orderedQty} allocated / {reviewed.intendedQty ?? 'unset'} intended units</p><Button size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal py-2" disabled={disabled || busy || !included.length} onClick={() => patch({ reviews: input.reviews.map(row => row.include && catalogueMembership(check, offer, offer.skus.find(sku => sku.id === row.skuId)!).verified && row.destination !== 'review' ? { ...row, reviewed: true } : row) })}>Confirm included verified product variants</Button></div>
    <SupplierSkuTable offer={offer} rows={reviewed.rows} guard={workspace.guard} disabled={disabled || busy} onChange={changeRow} />
    {reviewed.orderedQty !== reviewed.intendedQty && <label className="flex items-start gap-2 text-sm"><Checkbox checked={input.quantityDifferenceAccepted} disabled={disabled || busy} onCheckedChange={checked => patch({ quantityDifferenceAccepted: checked === true })} /><span>I reviewed the difference: {reviewed.orderedQty} allocated units versus {reviewed.intendedQty ?? 'an unset'} intended quantity.</span></label>}
    {included.some(row => row.review.qty && row.warnings.length) && <label className="flex items-start gap-2 text-sm"><Checkbox checked={input.unverifiedTermsAccepted} disabled={disabled || busy} onCheckedChange={checked => patch({ unverifiedTermsAccepted: checked === true })} /><span>I understand that the displayed supplier terms remain unverified. This acknowledgement does not turn them into verified savings.</span></label>}
    {!!blockers.length && <p role="status" className="text-sm text-muted-foreground">Before saving: {blockers.slice(0, 3).join(' · ')}{blockers.length > 3 ? ` · ${blockers.length - 3} other review issues` : ''}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={disabled || busy || !included.length || !!blockers.length} onClick={save}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}Save replacement</Button>
    <p className="text-sm text-muted-foreground">Remembers the chosen source for this product. Photos and Inventory links are applied only when you explicitly record the new import.</p>
  </div>
}
export function Sourcing1688Panel({ check, chosenOfferId, disabled, onChoose, focusRequest = 0 }: { check: SavedCheck1688; chosenOfferId: string | null; disabled: boolean; onChoose: (offerId: string) => void; focusRequest?: number }) {
  const router = useRouter()
  const { data: workspace, error: loadError, mutate } = useSWR(['1688-sourcing', check.item_id], () => getSourcingWorkspaceAction(check.item_id), { revalidateOnFocus: true, shouldRetryOnError: false })
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [acceptedVersion, setAcceptedVersion] = useState<string | null>(null)
  const [newProposal, setNewProposal] = useState(false)
  const setAccepted = () => setAcceptedVersion(null)
  const [terms, setTerms] = useState<SourcingTerms>({ orderDate: null, chinaFreight: null, fxRate: null })
  const lock = useRef(false)
  const confirmationKey = useRef(crypto.randomUUID())
  const panelRef = useRef<HTMLElement>(null)
  const lastFocus = useRef(0)
  useEffect(() => {
    if (!workspace || !focusRequest || lastFocus.current === focusRequest) return
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      lastFocus.current = focusRequest
      panel.focus({ preventScroll: true })
      panel.scrollIntoView({ block: 'start', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, workspace])
  if (loadError) return <Alert variant="destructive"><AlertTitle>Saved replacement could not be loaded</AlertTitle><AlertDescription>{loadError.message}<Button variant="outline" onClick={() => void mutate()}>Reload saved review</Button></AlertDescription></Alert>
  if (!workspace) return <p role="status" className="text-sm text-muted-foreground">Loading saved sourcing preferences…</p>
  const selection = workspace.selection
  const acceptanceVersion = stableEvidence({ id: selection?.id, revision: selection?.revision, guard: workspace.guardHash, terms })
  const accepted = acceptedVersion === acceptanceVersion
  const research = selection?.status === 'pending' ? selection.snapshot.check : check
  const offers = [...(research.evidence.current ? [research.evidence.current] : []), ...Object.values(research.evidence.offers)]
  const offerId = chosenOfferId || selection?.snapshot.source.offerId || ''
  const showSaved = selection?.status === 'pending' && selection.snapshot.source.offerId === offerId && !editing
  const stale = selection?.status === 'pending' && stableEvidence(workspace.guard) !== stableEvidence(selection.guard)
  const preview = showSaved ? sourcingPurchasePreview(selection!, terms) : null
  const totals = preview ? calculateReorder(preview.snapshot) : null
  const changed = (next: SourcingTerms) => { setTerms(next); setAccepted(); confirmationKey.current = crypto.randomUUID() }
  const saved = async () => { await mutate(); setEditing(false); setAccepted(); confirmationKey.current = crypto.randomUUID(); router.refresh() }
  const perform = async (operation: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await operation(); await saved() } catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation could not be completed') }
    finally { lock.current = false; setBusy(false) }
  }
  return <section ref={panelRef} tabIndex={-1} aria-label="Replacement and new purchase" className="flex min-w-0 scroll-mt-24 flex-col gap-4 rounded-xl border border-border bg-background p-4 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div><h3 className="text-lg font-semibold text-balance">{showSaved ? 'Review new purchase' : 'Choose a replacement source'}</h3><p className="text-sm text-muted-foreground">Separate new import. Original purchasing history stays unchanged.</p></div>
    {selection?.status === 'confirmed' && <Alert><AlertTitle>New import recorded</AlertTitle><AlertDescription><div className="flex flex-wrap gap-3">{selection.result?.imports.map(value => <Link key={value.id} href={`/dashboard/purchasing/imports/${value.id}`} className="text-primary underline">Open import {value.index}</Link>)}</div>No payment, stock receipt or 1688 order was made by this action.</AlertDescription></Alert>}
    {selection?.status === 'confirmed' && !newProposal && <Button variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={disabled || busy || check.isCurrent === false} onClick={() => { setNewProposal(true); setEditing(true); setAccepted(); changed({ orderDate: null, chinaFreight: null, fxRate: null }) }}>Start another purchase from current saved evidence</Button>}
    <Field><FieldLabel htmlFor={`source-${check.item_id}`}>Chosen supplier listing</FieldLabel><Select value={offerId || undefined} disabled={disabled || busy} onValueChange={value => { onChoose(value); setEditing(value !== selection?.snapshot.source.offerId); setAccepted() }}><SelectTrigger id={`source-${check.item_id}`}><SelectValue placeholder="Choose a saved supplier listing" /></SelectTrigger><SelectContent><SelectGroup>{offers.map(offer => <SelectItem key={offer.offerId} value={offer.offerId}>{offer.supplier.name || 'Unidentified supplier'} · {offer.offerId}</SelectItem>)}</SelectGroup></SelectContent></Select><FieldDescription>Choosing or reviewing saved evidence makes no TMAPI or AI request.</FieldDescription></Field>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {showSaved && preview && selection ? <>
      {stale && <Alert variant="destructive"><AlertTitle>Review needs updating</AlertTitle><AlertDescription>Inventory, quantity, the previous import or preferred source changed. Adjust and re-save the review before confirming.</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Saved revision {selection.revision} · {preview.units} units · {selection.snapshot.rows.filter(row => row.review.include).length} Inventory links</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || disabled} onClick={() => setEditing(true)}>Adjust saved selection</Button><Button variant="ghost" size="sm" disabled={busy || disabled} onClick={() => void perform(() => cancelSourcingSelectionAction({ id: selection.id, revision: selection.revision, requestKey: crypto.randomUUID() }))}>Discard proposal</Button></div></div>
      <SupplierSkuTable offer={selection.snapshot.source} rows={preview.rows.filter(row => row.review.include)} guard={selection.guard} disabled />
      <details open><summary className="cursor-pointer font-medium">Final Inventory photos · review every replacement</summary><div className="pt-3"><div className="flex max-h-80 flex-col gap-3 overflow-auto">{preview.rows.filter(row => row.review.include).map(row => {
        const oldPhoto = row.review.destination === 'parent' ? selection.guard.product.image_url : row.inventory?.image_url ?? null
        const proposed = row.review.keepPhoto ? oldPhoto : row.photo?.url ?? supplierPhoto(selection.snapshot.source, row.sku)
        return <div key={row.sku.id} className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2"><ImageLightbox src={oldPhoto} alt={`Current ${skuDescription(row.sku)}`} className="size-16" /><span className="text-sm text-muted-foreground">→</span><ImageLightbox src={proposed} alt={`Proposed ${skuDescription(row.sku)}`} className="size-16" /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{skuDescription(row.sku)}</p><p className="text-sm text-muted-foreground">{row.review.keepPhoto ? 'Keep existing / missing photo' : row.photo?.status === 'ready' ? 'Immutable copy prepared · applied at confirmation' : row.photo?.error || 'Not copied yet · Inventory unchanged'}</p></div></div>
      })}</div></div></details>
      {(() => { const pending = preview.rows.filter(row => row.review.include && !row.review.keepPhoto && row.photo?.status !== 'ready'); return pending.length > 0 ? <Button variant="outline" className="h-auto min-h-9 whitespace-normal" disabled={busy || disabled || stale} onClick={() => void perform(() => prepareSourcingPhotosAction({ id: selection.id, revision: selection.revision, requestKey: crypto.randomUUID(), skuIds: pending.slice(0, 4).map(row => row.sku.id) }))}><ImagePlus data-icon="inline-start" />Prepare next {Math.min(4, pending.length)} final photos ({pending.length} remaining)</Button> : null })()}
      <FieldGroup><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Field><FieldLabel htmlFor={`order-date-${check.item_id}`}>Actual order date</FieldLabel><Input id={`order-date-${check.item_id}`} type="date" value={terms.orderDate ?? ''} disabled={busy || disabled} onChange={event => changed({ ...terms, orderDate: event.target.value || null })} /></Field><Field><FieldLabel htmlFor={`freight-${check.item_id}`}>Whole-order China freight (CNY)</FieldLabel><Input id={`freight-${check.item_id}`} type="number" min={0} step="0.01" value={terms.chinaFreight ?? ''} placeholder="Unknown, not free" disabled={busy || disabled} onChange={event => changed({ ...terms, chinaFreight: event.target.value === '' ? null : Number(event.target.value) })} /><FieldDescription>Enter 0 only if explicitly confirmed free. No inherited discount or first-parcel fee.</FieldDescription></Field><Field><FieldLabel htmlFor={`fx-${check.item_id}`}>Reviewed MUR per CNY rate</FieldLabel><Input id={`fx-${check.item_id}`} type="number" min="0.000001" step="0.000001" value={terms.fxRate ?? ''} placeholder="Leave unknown if not agreed" disabled={busy || disabled} onChange={event => changed({ ...terms, fxRate: event.target.value === '' ? null : Number(event.target.value) })} /></Field></div></FieldGroup>
      <dl className="flex flex-col gap-2 text-sm tabular-nums"><div className="flex justify-between gap-3"><dt>Proposed goods</dt><dd>{purchaseMoney(preview.goods, 'CNY')}</dd></div><div className="flex justify-between gap-3"><dt>Supplier total including entered China freight</dt><dd>{purchaseMoney(totals?.supplierCny, 'CNY')}</dd></div><div className="flex justify-between gap-3"><dt>Supplier total at entered FX</dt><dd>{purchaseMoney(totals?.supplierMur)}</dd></div><div className="flex justify-between gap-3"><dt>Goods difference · {preview.covered}/{preview.ordered} comparable lines</dt><dd>{preview.difference == null ? 'Unverified / no comparable previous price' : `${preview.difference > 0 ? '+' : preview.difference < 0 ? '−' : ''}¥${Math.abs(preview.difference).toFixed(2)}`}</dd></div></dl>
      <p className="text-sm text-muted-foreground">Only the verified comparable subtotal is shown as a difference. Unknown freight and exchange rates stay unknown. Actual landed costs remain unverified. Discarding the proposal keeps the separately remembered product source.</p>
      {!!preview.blockers.length && <Alert><AlertTitle>Before confirmation</AlertTitle><AlertDescription>{preview.blockers.slice(0, 4).join(' · ')}{preview.blockers.length > 4 ? ` · ${preview.blockers.length - 4} more photo / review items` : ''}</AlertDescription></Alert>}
      <label className="flex items-start gap-2 text-sm"><Checkbox checked={accepted} disabled={busy || disabled || stale || !!preview.blockers.length} onCheckedChange={checked => setAcceptedVersion(checked === true ? acceptanceVersion : null)} /><span>I reviewed this exact new purchase and the Inventory links / photos above. Record new Ordered imports; do not place an order on 1688, pay, receive stock or edit the original import.</span></label>
      <Button className="h-auto min-h-9 whitespace-normal" disabled={busy || disabled || stale || !accepted || !!preview.blockers.length} onClick={() => void perform(async () => { await confirmSourcingSelectionAction({ id: selection.id, revision: selection.revision, requestKey: confirmationKey.current, terms, accepted: true }); toast.success('Separate new import recorded. Original purchase and physical stock unchanged.') })}>{busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}Record new Ordered import & apply reviewed links / photos</Button>
    </> : offerId && (selection?.status !== 'confirmed' || newProposal) ? <SourcingEditor key={`${offerId}:${selection?.revision ?? 0}:${workspace.guardHash}`} check={research} offerId={offerId} workspace={workspace} disabled={disabled || busy} onSaved={saved} /> : <p className="text-sm text-muted-foreground">Choose a saved listing above to review its photographed variants.</p>}
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate()}><RefreshCw data-icon="inline-start" />Reload saved review</Button>
  </section>
}
