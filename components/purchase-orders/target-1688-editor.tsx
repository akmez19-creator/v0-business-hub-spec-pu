'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import type { SavedCheck1688, TargetConfirmation1688 } from '@/lib/purchase-orders/1688-types'
import { ProductThumb } from '@/components/ui/product-thumb'
import { SupplierSkuTable } from './supplier-sku-table'

export function Target1688Editor({ check, disabled, onConfirm }: { check: SavedCheck1688; disabled: boolean; onConfirm: (input: TargetConfirmation1688) => Promise<void> }) {
  const target = check.evidence.target
  const offers = useMemo(() => [...(check.evidence.current ? [check.evidence.current] : []), ...Object.values(check.evidence.offers)], [check.evidence])
  const [choice, setChoice] = useState(target.sourceSku ? `${target.sourceSku.offerId}|${target.sourceSku.skuId}` : 'manual')
  const [specification, setSpecification] = useState(target.specification)
  const [unit, setUnit] = useState(target.unit ?? 'piece')
  const [pack, setPack] = useState(target.packSize == null ? '' : String(target.packSize))
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = offers.flatMap(offer => offer.skus.map(sku => ({ value: `${offer.offerId}|${sku.id}`, label: `${sku.name || 'Unlabelled variant'} · ${offer.offerId}`, sku })))
  const selected = options.find(option => option.value === choice)
  const filtered = options.filter(option => option.label.toLowerCase().includes(filter.toLowerCase()))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (disabled || busy || !pack || Number(pack) < 1 || !Number.isSafeInteger(Number(pack))) return
    setBusy(true)
    setError(null)
    try {
      const [offerId, skuId] = choice.split('|')
      await onConfirm({ sourceSku: choice === 'manual' ? null : { offerId, skuId }, specification, unit, packSize: Number(pack) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Target confirmation could not be saved') }
    finally { setBusy(false) }
  }
  return <details open={target.status === 'needs_confirmation'} className="rounded-lg border border-border bg-background text-foreground">
    <summary className="cursor-pointer p-4 font-medium">{target.status === 'needs_confirmation' ? 'Needs variant confirmation' : 'Comparison target'} · findings only</summary>
    <div className="px-4 pb-4">
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">{target.reason} Equal prices do not identify a SKU. This confirmation never changes the reorder&apos;s supplier, quantity or money columns.</p>
        {!!target.facts.length && <div className="flex flex-wrap gap-2">{target.facts.map(fact => <Badge key={fact.field} variant="secondary">{fact.field}: {fact.value}</Badge>)}</div>}
        {selected && <div className="flex items-center gap-3"><ProductThumb src={selected.sku.imageUrl} alt={selected.label} className="size-16 shrink-0" /><p className="text-sm">Selected comparison target: {selected.label}</p></div>}
        <details><summary className="cursor-pointer text-primary">Browse all target SKU photographs</summary><div className="pt-3"><div className="flex flex-col gap-4">{offers.map(offer => <SupplierSkuTable key={offer.offerId} offer={offer} disabled={disabled || busy} chosenId={choice.startsWith(`${offer.offerId}|`) ? choice.slice(offer.offerId.length + 1) : undefined} onChoose={skuId => { const sku = offer.skus.find(value => value.id === skuId)!; setChoice(`${offer.offerId}|${skuId}`); if (sku.unit) setUnit(sku.unit); setPack(sku.packSize == null ? '' : String(sku.packSize)) }} />)}</div></div></details>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field><FieldLabel htmlFor={`sku-filter-${check.item_id}`}>Find the actual variant</FieldLabel><Input id={`sku-filter-${check.item_id}`} value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search every fetched SKU by specification…" disabled={disabled || busy} /><FieldDescription>{filtered.length} of {options.length} variants. All returned SKUs are searchable, including those beyond the first 40.</FieldDescription></Field>
            <Field><FieldLabel htmlFor={`target-sku-${check.item_id}`}>Target SKU (comparison only)</FieldLabel><Select value={choice} onValueChange={value => { setChoice(value); const option = options.find(candidate => candidate.value === value); if (option?.sku.unit) setUnit(option.sku.unit); setPack(option?.sku.packSize == null ? '' : String(option.sku.packSize)) }} disabled={disabled || busy}><SelectTrigger id={`target-sku-${check.item_id}`} className="w-full"><SelectValue>{choice === 'manual' ? 'Confirm specifications without an original SKU' : selected?.label ?? 'Choose a saved SKU'}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="manual">Confirm specifications without an original SKU</SelectItem>{filtered.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor={`target-spec-${check.item_id}`}>Required specifications</FieldLabel><Textarea id={`target-spec-${check.item_id}`} value={specification} onChange={event => setSpecification(event.target.value)} maxLength={2000} rows={3} disabled={disabled || busy} placeholder="model: X31; voltage: 220V; plug: UK; contents: complete product with charger" /><FieldDescription>Use model, size, capacity, voltage, plug, material or contents followed by a colon. Missing candidate specifications remain unverified.</FieldDescription></Field>
            <Field><FieldLabel htmlFor={`target-unit-${check.item_id}`}>Your quantity is in</FieldLabel><Select value={unit} onValueChange={setUnit} disabled={disabled || busy}><SelectTrigger id={`target-unit-${check.item_id}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{['piece', 'set', 'pair', 'box', 'pack', 'meter'].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor={`target-pack-${check.item_id}`}>Pieces / items in each purchasing unit</FieldLabel><Input id={`target-pack-${check.item_id}`} type="number" inputMode="numeric" min={1} step={1} max={100000} value={pack} onChange={event => setPack(event.target.value)} required disabled={disabled || busy} placeholder="Confirm the pack contents" /><FieldDescription>For a single piece enter 1; for a set, confirm what is actually included. Quantities are not increased to meet supplier terms.</FieldDescription></Field>
            {error && <p role="alert" className="text-destructive">{error}</p>}
            <Button type="submit" disabled={disabled || busy || !pack || (choice === 'manual' && !specification.trim())}>{busy ? 'Saving target…' : 'Confirm target & recompute saved evidence'}</Button>
          </FieldGroup>
        </form>
        <p className="text-muted-foreground">No paid request is made by this confirmation. Use an explicit check / resume for any additional evidence.</p>
      </div>
    </div>
  </details>
}
