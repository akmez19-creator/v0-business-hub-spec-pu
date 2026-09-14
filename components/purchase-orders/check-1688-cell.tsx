'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clock3, ExternalLink, Loader2, RefreshCw, Square, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ProductThumb } from '@/components/ui/product-thumb'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { currentRangeLabel, matchingQuality, rankFindings, stageLabel } from '@/lib/purchase-orders/1688-comparison'
import { CHECK_LIMITS, type CheckCommand1688, type CheckResponse1688, type Finding1688, type Listing1688, type SavedCheck1688, type SupplierQualitySummary, type TargetConfirmation1688 } from '@/lib/purchase-orders/1688-types'
import { Target1688Editor } from './target-1688-editor'
import { SupplierSkuTable } from './supplier-sku-table'

export { has1688Link } from '@/lib/purchase-orders/1688-comparison'
export type Check1688State = {
  status: 'idle' | 'queued' | 'loading' | 'skipped' | 'stale' | 'done' | 'error'
  check?: SavedCheck1688
  message?: string
  reason?: string
  stopReason?: string
  httpStatus?: number
  checkedButNotSaved?: boolean
  quality?: SupplierQualitySummary[]
  busy?: boolean
}
export type Check1688Result = Check1688State
export type Check1688Progress = {
  rowIds: string[]; total: number; processed: number; checked: number; unavailable: number; failed: number
  discarded: number; skipped: number; queued: number; running: boolean; stopping: boolean; message: string | null
}

export async function fetch1688(command: CheckCommand1688, signal?: AbortSignal): Promise<Check1688Result> {
  try {
    const timeout = AbortSignal.timeout(65_000)
    const response = await fetch('/api/purchase-orders/1688-check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    const json = await response.json().catch(() => null) as (CheckResponse1688 & { busy?: boolean }) | null
    const stopReason = response.status === 401 || response.status === 403 ? 'Your session needs attention. Remaining checks were stopped.' : json?.stopReason
    if (!response.ok || !json?.success) return { status: 'error', check: json?.check, quality: json?.quality, message: json?.error ?? `Check request returned HTTP ${response.status}`, reason: json?.reason, checkedButNotSaved: json?.checkedButNotSaved, httpStatus: response.status, stopReason }
    if (!json.check?.evidence) return { status: 'error', message: 'Saved research response was incomplete. Reload before retrying.', reason: 'storage', stopReason: 'Research could not be restored; remaining paid work was stopped.' }
    return { status: 'done', check: json.check, quality: json.quality, stopReason, busy: json.busy }
  } catch {
    return { status: 'error', message: 'The request was interrupted. Reload to see the last saved stage, then resume explicitly.', reason: 'network', stopReason: 'A request was interrupted. Remaining paid work was not dispatched.' }
  }
}
const cny = (value: number) => `¥${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const stamp = (value: string) => new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const qualityHref = (profile: SupplierQualitySummary) => `/dashboard/purchasing/suppliers?supplier=${encodeURIComponent(profile.aliases[0] ?? profile.name)}`

export function SupplierQualityWarning({ profile }: { profile: SupplierQualitySummary | null | undefined }) {
  if (!profile) return <p className="text-muted-foreground">Internal rating: not rated / identity not linked</p>
  return <div className="flex flex-col gap-1 text-sm leading-relaxed">
    <Link className="text-primary underline-offset-4 hover:underline" href={qualityHref(profile)}>Internal: {profile.internalRating == null ? 'Not rated' : `${profile.internalRating} / 5`} · Quality & notes</Link>
    {!!profile.defectCount && <span className="inline-flex items-center gap-1.5 text-destructive"><CircleAlert className="size-4 shrink-0" aria-hidden="true" />{profile.defectCount} defect report{profile.defectCount === 1 ? '' : 's'} on file</span>}
    {profile.latestNote && <p className="line-clamp-2 break-words text-muted-foreground">{profile.latestNote}</p>}
    {profile.latestNoteAt && <time dateTime={profile.latestNoteAt} className="text-muted-foreground">{stamp(profile.latestNoteAt)} · {profile.latestNoteAuthor}</time>}
  </div>
}

export function Check1688Toolbar({ selecting, selectedCount, eligibleCount, missingCount, allSelected, pending, progress, processIssue, failedCount, onSelectAll, onClear, onProcess, onRetryFailed, onStop, onDone }: {
  selecting: boolean; selectedCount: number; eligibleCount: number; missingCount: number; allSelected: boolean; pending: boolean
  progress: Check1688Progress | null; processIssue: string | null; failedCount: number
  onSelectAll: () => void; onClear: () => void; onProcess: () => void; onRetryFailed: () => void; onStop: () => void; onDone: () => void
}) {
  const running = progress?.running ?? false
  return <section id="reorder-1688-controls" aria-label="1688 check controls" className="rounded-xl border border-border bg-background text-foreground">
    <div className="p-3 sm:p-4"><div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">1688 supplier research</h2><Badge variant="secondary">Findings only</Badge></div><p className="text-sm text-muted-foreground">{selecting ? `${selectedCount} selected of ${eligibleCount} eligible` : 'Saved listing and variant comparisons'}{missingCount > 0 && ` · ${missingCount} without usable product evidence`}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {selecting && <><Button variant="outline" size="sm" onClick={onSelectAll} disabled={running || allSelected || !eligibleCount}>Select all ({eligibleCount})</Button><Button variant="ghost" size="sm" onClick={onClear} disabled={running || !selectedCount}>Clear selection</Button></>}
          {running ? <Button variant="outline" size="sm" onClick={onStop} disabled={progress!.stopping}>{progress!.stopping ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Square data-icon="inline-start" />}{progress!.stopping ? 'Finishing started lookups…' : 'Stop remaining'}</Button> : selecting && <Button size="sm" onClick={onProcess} disabled={pending || !selectedCount || !!processIssue}><RefreshCw data-icon="inline-start" />Process selected ({selectedCount})</Button>}
          <Button variant="ghost" size="sm" disabled={running} onClick={onDone}><Check data-icon="inline-start" />Done</Button>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{processIssue && !running ? processIssue : `Each fresh check: up to ${CHECK_LIMITS.searches} first-page searches of ${CHECK_LIMITS.hitsPerSearch} hits, ${CHECK_LIMITS.candidates} alternative listing verifications, ${CHECK_LIMITS.tmapiCalls} paid TMAPI requests and ${CHECK_LIMITS.aiCalls} AI interpretations in total. Resume reuses saved successes. Nothing is ordered or repriced.`}</p>
    </div></div>
    {progress && <div className="border-t border-border p-3 sm:p-4"><div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" aria-live="polite" aria-atomic="true" className="text-sm font-medium tabular-nums">{running ? progress.stopping ? 'Stopping' : 'Checking' : progress.stopping ? 'Stopped' : 'Research finished'} · {progress.processed} of {progress.total} processed</p>{!running && failedCount > 0 && <Button variant="outline" size="sm" disabled={pending} onClick={onRetryFailed}><RefreshCw data-icon="inline-start" />Resume / retry ({failedCount})</Button>}</div>
      <Progress value={progress.total ? progress.processed / progress.total * 100 : 0} aria-label="1688 research progress" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-muted-foreground"><span>{progress.checked} saved</span><span>{progress.unavailable} unavailable</span><span>{progress.failed} partial / failed</span>{progress.skipped > 0 && <span>{progress.skipped} not processed</span>}{progress.discarded > 0 && <span>{progress.discarded} discarded after changes</span>}{running && <span>{progress.queued} rows queued</span>}</div>
      {progress.message && <p className="text-sm leading-relaxed text-muted-foreground">{progress.message}</p>}
    </div></div>}
  </section>
}

export function Check1688Cell({ state, onCheck, onFreshCheck, disabled, selecting, selected, productName, expanded, detailsId, onToggleDetails, checkable = true }: {
  link: string | null; qty: number | null; listUnitPrice: number | null; state: Check1688State; onCheck: () => void; onFreshCheck?: () => void
  disabled?: boolean; selecting: boolean; selected: boolean; productName: string; expanded: boolean; detailsId: string; onToggleDetails: () => void; checkable?: boolean
}) {
  const check = state.check
  const isStale = state.status === 'stale' || check?.isCurrent === false
  const active = state.status === 'loading' || state.status === 'queued'
  const resumable = check && check.status !== 'complete' && !isStale
  return <div className="flex flex-col gap-2 text-sm leading-relaxed">
    {active && <span role="status" className="inline-flex items-center gap-2 text-muted-foreground">{state.status === 'queued' ? <Clock3 className="size-4" /> : <Loader2 className="size-4 animate-spin" />}{state.status === 'queued' ? 'Queued' : stageLabel(check?.evidence.stages[check.cursor] ?? 'listing')}</span>}
    {!active && check && <>
      <span className={cn('inline-flex items-center gap-1.5 font-medium', (isStale || state.checkedButNotSaved) && 'text-destructive')}>{isStale || state.checkedButNotSaved || check.status !== 'complete' ? <CircleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}{state.checkedButNotSaved ? 'Checked but not saved' : isStale ? 'Previous / stale findings' : check.status === 'complete' ? 'Saved' : check.status === 'running' ? 'Interrupted · resume explicitly' : 'Partial findings saved'}</span>
      {!isStale && <p className="text-pretty">{currentRangeLabel(check.evidence.current, check.evidence.target, check.context.qty, check.evidence.current ? check.evidence.interpretations[check.evidence.current.offerId] : undefined)}</p>}
      <time className="text-muted-foreground" dateTime={check.updated_at}>{stamp(check.updated_at)}</time>
    </>}
    {!active && !check && <span className="text-muted-foreground">{!checkable ? 'No usable product evidence' : state.status === 'stale' ? 'Details changed · fresh check needed' : state.status === 'error' ? 'Check failed' : state.status === 'skipped' ? 'Not processed' : selecting ? selected ? 'Ready to check' : 'Select to check' : 'Not checked'}</span>}
    {state.message && <p className="break-words text-destructive">{state.message}</p>}
    <div className="flex flex-wrap items-center gap-1">
      {check && <Button variant="ghost" size="sm" onClick={onToggleDetails} aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? 'Hide' : 'Show'} 1688 details for ${productName}`}>{expanded ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}Details</Button>}
      {!selecting && !active && checkable && <Button variant={check ? 'ghost' : 'outline'} size="sm" disabled={disabled} onClick={onCheck}><RefreshCw data-icon="inline-start" />{resumable ? 'Resume / retry' : check ? 'Fresh check' : 'Check on 1688'}</Button>}
      {!selecting && !active && resumable && onFreshCheck && <Button variant="ghost" size="sm" disabled={disabled} onClick={onFreshCheck}>Start fresh</Button>}
    </div>
  </div>
}

export function Check1688Remarks({ state, quality, fallbackSupplier }: { state: Check1688State; quality: SupplierQualitySummary[]; fallbackSupplier: string | null }) {
  const evidence = state.check?.evidence
  const profile = fallbackSupplier ? quality.find(value => value.aliases.includes(fallbackSupplier)) : evidence?.current ? matchingQuality(evidence.current, quality) : null
  return <div className="flex flex-col gap-3 text-sm leading-relaxed">
    {state.status === 'stale' && <p className="text-destructive">Inputs changed. These saved remarks are previous findings.</p>}
    {evidence?.remarks.length ? <ul className="flex flex-col gap-2">{evidence.remarks.map((remark, index) => <li key={index} className="break-words text-pretty">{remark}</li>)}</ul> : <p className="text-muted-foreground">No saved research remarks</p>}
    {profile && <SupplierQualityWarning profile={profile} />}
  </div>
}

function SupplierFacts({ offer, check, quality }: { offer: Listing1688; check: SavedCheck1688; quality: SupplierQualitySummary[] }) {
  const shop = offer.supplier.memberId ? check.evidence.shops[offer.supplier.memberId] : null
  const profile = matchingQuality(offer, quality, shop?.names)
  return <div className="flex flex-col gap-2">
    <p className="break-words font-medium">{shop?.names[0] ?? offer.supplier.name ?? 'Supplier not identified'}</p>
    <p className="inline-flex items-center gap-1.5"><Star className="size-4" aria-hidden="true" />1688: {shop?.rating == null ? 'Unavailable / not checked' : `${shop.rating.toFixed(1)} / 5`}</p>
    {shop && <time className="text-muted-foreground" dateTime={shop.observedAt}>{stamp(shop.observedAt)}</time>}
    {shop?.error && <p className="text-muted-foreground">{shop.error}</p>}
    <SupplierQualityWarning profile={profile} />
  </div>
}

function IdentityConfirmation({ offer, check, suppliers, onConfirm }: { offer: Listing1688; check: SavedCheck1688; suppliers: string[]; onConfirm: (offerId: string, supplierName: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!offer.supplier.memberId) return null
  return <details><summary className="cursor-pointer text-primary">Link an existing supplier quality record</summary><div className="pt-3"><div className="flex flex-col gap-3">
    <p className="text-muted-foreground">Similar names are suggestions, not proof. Confirm only if this shop is the same company as the import supplier. Conflicting records will not be merged.</p>
    <Select value={name} onValueChange={setName} disabled={busy}><SelectTrigger aria-label="Existing import supplier"><SelectValue placeholder="Choose the known supplier" /></SelectTrigger><SelectContent><SelectGroup>{suppliers.map(supplier => <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>)}</SelectGroup></SelectContent></Select>
    <Button variant="outline" size="sm" disabled={busy || !name || check.isCurrent === false} onClick={async () => { setBusy(true); setError(''); try { await onConfirm(offer.offerId, name) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Identity could not be linked') } finally { setBusy(false) } }}>Confirm this is the same supplier</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div></div></details>
}

function AlternativeOffer({ offer, check, findings, quality, suppliers, onConfirmIdentity, onChooseOffer, disabled }: { offer: Listing1688; check: SavedCheck1688; findings: Finding1688[]; quality: SupplierQualitySummary[]; suppliers: string[]; onConfirmIdentity: (offerId: string, name: string) => Promise<void>; onChooseOffer?: (offerId: string) => void; disabled?: boolean }) {
  const sorted = rankFindings(findings)
  const best = sorted[0]
  const sku = offer.skus.find(value => value.id === best?.skuId)
  const profile = matchingQuality(offer, quality, offer.supplier.memberId ? check.evidence.shops[offer.supplier.memberId]?.names : [])
  return <article className="rounded-lg border border-border bg-background text-foreground"><div className="p-4"><div className="flex flex-col gap-4">
    <div className="flex items-start gap-3"><ProductThumb src={sku?.imageUrl ?? offer.imageUrl} className="size-16 shrink-0 rounded-lg" /><div className="flex min-w-0 flex-1 flex-col gap-2"><a className="text-pretty font-medium hover:underline" href={offer.pageUrl} target="_blank" rel="noopener noreferrer">{offer.title || `Offer ${offer.offerId}`}<span className="sr-only"> (opens 1688 in a new tab)</span></a><div className="flex flex-wrap gap-2"><Badge variant={best?.status === 'matching' ? 'default' : 'secondary'}>{best?.status === 'matching' ? 'Matching published specifications' : best?.status === 'excluded' ? 'Excluded from comparison' : best?.status === 'unavailable' ? 'Unavailable' : 'Possible match · unverified'}</Badge>{best?.sameSeller === true && <Badge variant="outline">Same seller · different offer</Badge>}{best?.sameSeller === false && <Badge variant="outline">Different supplier</Badge>}</div></div></div>
    <div className="flex flex-col gap-4 @3xl/reorders:flex-row"><div className="flex min-w-0 flex-1 flex-col gap-2"><p className="font-medium">{sku?.name || 'SKU not established'}</p><p>{best?.applicablePrice != null ? `${cny(best.applicablePrice)} / ${check.evidence.target.unit} at your quantity` : best?.publishedPrice != null ? `${cny(best.publishedPrice)} published; applicability unverified` : 'No applicable SKU price'}</p><p className="text-muted-foreground">{best?.reason}</p><p className="text-muted-foreground">MOQ {offer.moq ?? 'unknown'} · SKU stock {sku?.stock ?? 'unknown'} · unit {sku?.unit ?? 'unknown'} · pack {sku?.packSize ?? 'unverified'}</p><p className="text-muted-foreground">{best?.priceSource ?? 'No confirmed price provenance'} · {stamp(offer.observedAt)}</p></div><div className="min-w-0 flex-1"><SupplierFacts offer={offer} check={check} quality={quality} /></div></div>
    {!profile && <IdentityConfirmation offer={offer} check={check} suppliers={suppliers} onConfirm={onConfirmIdentity} />}
    <details><summary className="cursor-pointer text-primary">All {offer.skus.length} saved variants and match reasons</summary><div className="pt-3"><SupplierSkuTable offer={offer} findings={findings} /></div></details>
    {onChooseOffer && <Button variant="outline" disabled={disabled} onClick={() => onChooseOffer(offer.offerId)}>Review this supplier as replacement</Button>}
  </div></div></article>
}

/**
 * Freight is deliberately NOT given a signed difference. 1688 publishes the
 * template's base parcel fee while our column estimates the entire shipment.
 */
export function Check1688Details({ id, productName, state, qty, listUnitPrice, discountedUnitPrice, ourShipmentPerOrder, quality, suppliers, disabled, onConfirmTarget, onConfirmIdentity, onChooseOffer }: {
  id: string; productName: string; state: Check1688State; qty: number | null; listUnitPrice: number | null
  discountedUnitPrice: number | null; ourShipmentPerOrder: number | null; quality: SupplierQualitySummary[]; suppliers: string[]
  disabled: boolean; onConfirmTarget: (input: TargetConfirmation1688) => Promise<void>; onConfirmIdentity: (offerId: string, name: string) => Promise<void>; onChooseOffer?: (offerId: string) => void
}) {
  const check = state.check
  if (!check) return null
  const { evidence } = check
  const current = evidence.current
  const winner = evidence.findings.find(finding => finding.status === 'matching')
  const orderedOffers = [...Object.values(evidence.offers)].sort((a, b) => {
    const ai = evidence.findings.findIndex(finding => finding.offerId === a.offerId)
    const bi = evidence.findings.findIndex(finding => finding.offerId === b.offerId)
    return ai - bi
  })
  const stale = state.status === 'stale' || check.isCurrent === false
  return <section id={id} aria-label={`1688 details for ${productName}`} className="flex min-w-0 flex-col gap-5 text-sm leading-relaxed">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-col gap-1"><h3 className="text-pretty font-semibold">{productName} · saved 1688 research</h3><p className="text-muted-foreground">{stamp(check.updated_at)} · {evidence.searchHits.length} search hits · {Object.keys(evidence.offers).length} alternative listings checked · {evidence.paid.tmapi} TMAPI / {evidence.paid.ai} AI attempts</p></div><Badge variant="secondary">Findings only</Badge></div>
    {(stale || state.checkedButNotSaved) && <p role="status" className="font-medium text-destructive">{state.checkedButNotSaved ? 'Checked but not saved. Reload will restore only the last saved stage.' : 'Previous findings: the product, variant, reference or quantity changed. Do not treat these as a current comparison.'}</p>}
    <Target1688Editor key={`${check.item_id}-${check.generation}`} check={check} disabled={disabled || stale || !!state.checkedButNotSaved} onConfirm={onConfirmTarget} />
    <div className="flex flex-col gap-6 @3xl/reorders:flex-row">
      <section aria-label="Current listing facts" className="flex min-w-0 flex-1 flex-col gap-3"><h4 className="font-semibold">Current listing</h4>
        {current ? <><a href={current.pageUrl} target="_blank" rel="noopener noreferrer" className="text-pretty text-primary hover:underline">{current.title || current.offerId} <ExternalLink className="inline size-4" aria-hidden="true" /></a><p>{currentRangeLabel(current, evidence.target, qty, evidence.interpretations[current.offerId])}</p><SupplierFacts offer={current} check={check} quality={quality} />{!matchingQuality(current, quality, current.supplier.memberId ? evidence.shops[current.supplier.memberId]?.names : []) && <IdentityConfirmation offer={current} check={check} suppliers={suppliers} onConfirm={onConfirmIdentity} />}</> : <p className="text-muted-foreground">{evidence.currentStatus === 'missing-link' ? 'No original listing link. Searching saved product evidence does not require one.' : evidence.currentStatus === 'gone' ? 'Listing unavailable. This does not mean the supplier stopped trading.' : 'Current listing has not been retrieved successfully.'}</p>}
      </section>
      <section aria-label="Separate historical and current prices" className="flex min-w-0 flex-1 flex-col gap-3"><h4 className="font-semibold">Price reference, not a reprice</h4><dl className="flex flex-col gap-2"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Previous list unit price</dt><dd>{listUnitPrice == null ? 'Unknown' : cny(listUnitPrice)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Previous negotiated price</dt><dd>{discountedUnitPrice == null ? 'Unknown' : cny(discountedUnitPrice)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Published promotion</dt><dd>{current?.price.promotion == null ? 'Not published' : cny(current.price.promotion)}</dd></div></dl><p className="text-muted-foreground">The previous price is never used to identify a variant. A published promotion is not an extra negotiated discount. No delivered or landed-cost saving is calculated.</p></section>
      <section aria-label="Freight facts and estimates" className="flex min-w-0 flex-1 flex-col gap-3"><h4 className="font-semibold">Freight to warehouse</h4><dl className="flex flex-col gap-2"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Intended destination</dt><dd>Guangzhou, Guangdong</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Published base fee</dt><dd>{current?.freight.fee == null ? 'Unknown' : cny(current.freight.fee)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Estimated whole-order shipment</dt><dd>{ourShipmentPerOrder == null ? 'Unknown' : cny(ourShipmentPerOrder)}</dd></div></dl><p className="text-muted-foreground">The published fee is a first-parcel/default-destination fee, not a full quote for your quantity to Guangzhou. These figures are not comparable freight savings.</p></section>
    </div>
    {current && <details><summary className="cursor-pointer text-primary">All {current.skus.length} photographed current-listing SKUs</summary><div className="pt-3"><div className="flex flex-col gap-3"><SupplierSkuTable offer={current} />{onChooseOffer && <Button variant="outline" disabled={disabled || stale} onClick={() => onChooseOffer(current.offerId)}>Review current supplier for a new purchase</Button>}</div></div></details>}
    <section aria-label="Alternative offer comparison" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1"><h4 className="font-semibold">{winner && !stale ? `Lowest matching price found · ${cny(winner.applicablePrice!)}` : 'Alternative offers · verified and possible matches'}</h4><p className="text-muted-foreground">Scope: at most two first-page searches and five detailed candidate listings, checked on the dates shown. This is not the cheapest offer on all of 1688. Supplier ratings warn; they never approve or exclude an offer automatically.</p></div>
      {!orderedOffers.length && <p className="text-muted-foreground">No alternative listing evidence saved yet. A partial or unavailable original listing does not prevent an explicit alternative search.</p>}
      {orderedOffers.map(offer => <AlternativeOffer key={offer.offerId} offer={offer} check={check} findings={evidence.findings.filter(finding => finding.offerId === offer.offerId)} quality={quality} suppliers={suppliers} onConfirmIdentity={onConfirmIdentity} onChooseOffer={onChooseOffer} disabled={disabled || stale} />)}
      {Object.values(evidence.outcomes).some(outcome => outcome?.status === 'error') && <ul className="flex flex-col gap-2">{Object.entries(evidence.outcomes).flatMap(([stage, outcome]) => outcome?.status === 'error' ? [<li className="text-destructive" key={stage}>{stageLabel(stage)} · {outcome.message}</li>] : [])}</ul>}
    </section>
    {check.previous_success && check.previous_success.checkedAt !== check.finished_at && check.status !== 'complete' && <details><summary className="cursor-pointer text-primary">Previous successful findings · {stamp(check.previous_success.checkedAt)}</summary><div className="pt-3"><div className="flex flex-col gap-2"><p className="text-muted-foreground">Previous / stale evidence retained after this incomplete refresh. It is not a current quote.</p>{check.previous_success.evidence.remarks.map((remark, index) => <p key={index}>{remark}</p>)}</div></div></details>}
  </section>
}
