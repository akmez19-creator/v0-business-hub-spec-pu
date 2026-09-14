'use client'

import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { ProductThumb } from '@/components/ui/product-thumb'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FieldLabel } from '@/components/ui/field'
import { skuDescription, skuKey, supplierPhoto } from '@/lib/purchase-orders/1688-sourcing-review'
import type { Finding1688, Listing1688 } from '@/lib/purchase-orders/1688-types'
import type { ReviewedSku, SkuReview, SourcingGuard } from '@/lib/purchase-orders/1688-sourcing-types'
import { purchaseMoney } from '@/lib/purchase-orders/workflow'

export function SupplierSkuTable({ offer, rows, guard, findings, disabled = false, onChange, onChoose, chosenId }: {
  offer: Listing1688; rows?: ReviewedSku[]; guard?: SourcingGuard; findings?: Finding1688[]; disabled?: boolean
  onChange?: (skuId: string, change: Partial<SkuReview>) => void; onChoose?: (skuId: string) => void; chosenId?: string
}) {
  const [filter, setFilter] = useState('')
  const id = useId()
  const rowById = new Map(rows?.map(row => [row.sku.id, row]))
  const findingById = new Map(findings?.map(finding => [finding.skuId, finding]))
  const available = rows ? offer.skus.filter(sku => rowById.has(sku.id)) : offer.skus
  const filtered = available.filter(sku => `${sku.id} ${sku.specId} ${sku.name} ${skuDescription(sku)}`.toLowerCase().includes(filter.toLowerCase()))
  return <div className="flex min-w-0 flex-col gap-3">
    <Field><FieldLabel htmlFor={id}>Search all supplier SKUs</FieldLabel><Input id={id} value={filter} onChange={event => setFilter(event.target.value)} placeholder="SKU, colour, size, model or full specification…" /><p className="text-sm text-muted-foreground">Showing {filtered.length} of {available.length} {rows && available.length !== offer.skus.length ? `included SKUs (${offer.skus.length} in the saved listing)` : 'saved SKUs'}. No variant is hidden by its price or position.</p></Field>
    <div className="max-h-96 overflow-auto rounded-lg border border-border">
      <Table aria-label={`Supplier SKUs for ${offer.offerId}`}><TableHeader><TableRow>
        {onChange && <TableHead>Include</TableHead>}<TableHead>Photo & complete specification</TableHead><TableHead>Published purchase terms</TableHead>
        {rows && <><TableHead>Inventory destination</TableHead><TableHead>Purchase quantity</TableHead><TableHead>Previous → proposed</TableHead></>}
        {onChoose && <TableHead>Comparison target</TableHead>}{findings && <TableHead>Match outcome</TableHead>}
      </TableRow></TableHeader><TableBody>{filtered.map(sku => {
        const row = rowById.get(sku.id)
        const finding = findingById.get(sku.id)
        const review = row?.review
        const photo = supplierPhoto(offer, sku)
        const destination = review?.destination === 'existing' ? `existing:${review.variantId}` : review?.destination ?? 'review'
        return <TableRow key={sku.id} data-sku-id={sku.id}>
          {onChange && <TableCell><Checkbox aria-label={`Include ${sku.name || sku.id} in Inventory review`} checked={review?.include ?? false} disabled={disabled || !skuKey(sku)} onCheckedChange={checked => onChange(sku.id, { include: checked === true, reviewed: false })} /></TableCell>}
          <TableCell className="min-w-64 whitespace-normal"><div className="flex items-start gap-3"><div className="flex shrink-0 flex-col gap-1">{photo ? <ImageLightbox src={photo} alt={skuDescription(sku)} className="size-16" /> : <><ProductThumb src={null} className="size-16" /><span className="text-sm text-muted-foreground">No photo</span></>}</div><div className="flex min-w-0 flex-col gap-1"><p className="font-medium">{skuDescription(sku)}</p><p className="break-all text-sm text-muted-foreground">{skuKey(sku) ?? 'No stable SKU ID'}</p>{sku.specId && <p className="break-all text-sm text-muted-foreground">Spec: {sku.specId}</p>}</div></div></TableCell>
          <TableCell className="min-w-44 whitespace-normal"><div className="flex flex-col gap-1"><p className="font-medium tabular-nums">{purchaseMoney(row ? row.price : sku.price, 'CNY')}</p><p className="text-muted-foreground">{sku.unit ?? 'Unit unknown'} · pack {sku.packSize ?? 'unknown'}</p><p className="text-muted-foreground">Stock {sku.stock ?? 'unknown'} · listing MOQ {offer.moq ?? 'unknown'}</p><p className="text-muted-foreground">Multiple {sku.quantityMultiple ?? offer.quantityMultiple ?? 'unknown'}</p>{row?.warnings.map(warning => <p className="text-muted-foreground" key={warning}>{warning}</p>)}</div></TableCell>
          {row && review && <>
            <TableCell className="min-w-72 whitespace-normal"><div className="flex flex-col gap-2">
              <Badge variant="outline">{review.destination === 'parent' ? 'Simple product · no conversion' : review.destination === 'existing' ? 'Linked Inventory variant' : review.destination === 'new' ? 'New Inventory variant' : 'Needs review'}</Badge>
              {onChange ? <Select value={destination} disabled={disabled || !review.include} onValueChange={value => {
                const selected = guard?.variants.find(variant => value === `existing:${variant.id}`)
                onChange(sku.id, selected ? { destination: 'existing', variantId: selected.id, attributeName: selected.attribute_name, attributeValue: selected.attribute_value, reviewed: false, samePreviousUnit: false } : { destination: value as SkuReview['destination'], variantId: null, reviewed: false, samePreviousUnit: false })
              }}><SelectTrigger aria-label={`Inventory destination for ${sku.name || sku.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
                <SelectItem value="review">Choose destination</SelectItem>{!guard?.product.has_variants && <SelectItem value="parent">Keep as simple product</SelectItem>}<SelectItem value="new">New complete Inventory variant</SelectItem>
                {guard?.variants.map(variant => <SelectItem key={variant.id} value={`existing:${variant.id}`}>{variant.attribute_name}: {variant.attribute_value}{variant.is_active !== true ? ' · inactive' : ''}</SelectItem>)}
              </SelectGroup></SelectContent></Select> : <p>{review.destination === 'parent' ? guard?.product.name : `${review.attributeName}: ${review.attributeValue}`}</p>}
              {row.inventory && <div className="flex items-center gap-2"><ProductThumb src={row.inventory.image_url} alt={`Existing ${row.inventory.attribute_value}`} className="size-10 shrink-0" /><span>{row.inventory.attribute_name}: {row.inventory.attribute_value}</span></div>}
              {review.destination === 'new' && onChange && <><Input aria-label={`Attribute names for ${sku.id}`} value={review.attributeName} disabled={disabled || !review.include} onChange={event => onChange(sku.id, { attributeName: event.target.value, reviewed: false })} placeholder="Colour / Size / Model" /><Input aria-label={`Complete attribute values for ${sku.id}`} value={review.attributeValue} disabled={disabled || !review.include} onChange={event => onChange(sku.id, { attributeValue: event.target.value, reviewed: false })} placeholder="One complete combination" /></>}
              {onChange && <label className="flex items-start gap-2 text-sm"><Checkbox checked={review.reviewed} disabled={disabled || !review.include} onCheckedChange={checked => onChange(sku.id, { reviewed: checked === true })} /><span>Reviewed: same complete product, correct destination</span></label>}
              {onChange && <label className="flex items-start gap-2 text-sm"><Checkbox checked={review.keepPhoto} disabled={disabled || !review.include} onCheckedChange={checked => onChange(sku.id, { keepPhoto: checked === true })} /><span>Keep existing / missing photo instead</span></label>}
              {row.blockers.map(blocker => <p className="text-sm text-destructive" key={blocker}>{blocker}</p>)}
            </div></TableCell>
            <TableCell className="min-w-32 whitespace-normal">{onChange ? <Input type="number" min={0} max={10_000_000} step={1} inputMode="numeric" aria-label={`Purchase quantity for ${sku.name || sku.id}`} value={review.qty ?? ''} disabled={disabled || !review.include} onChange={event => onChange(sku.id, { qty: event.target.value === '' ? null : Number(event.target.value) })} placeholder="Not ordering" /> : <p className="tabular-nums">{review.qty || 'Catalogue only'}</p>}<p className="text-sm text-muted-foreground">Blank / 0 adds no purchase line.</p></TableCell>
            <TableCell className="min-w-56 whitespace-normal"><div className="flex flex-col gap-2"><p>List: {purchaseMoney(row.difference.previousList, 'CNY')}</p><p>Negotiated: {purchaseMoney(row.difference.previousNet, 'CNY')}</p><p>Proposed: {purchaseMoney(row.price, 'CNY')}</p>{row.difference.perUnit != null ? <p className="font-medium tabular-nums">{row.difference.perUnit > 0 ? '+' : row.difference.perUnit < 0 ? '−' : ''}¥{Math.abs(row.difference.perUnit).toFixed(2)} / unit · {Math.abs(row.difference.percent!).toFixed(1)}% {row.difference.perUnit > 0 ? 'more' : row.difference.perUnit < 0 ? 'less' : 'change'}<br />Goods: {row.difference.goods! > 0 ? '+' : row.difference.goods! < 0 ? '−' : ''}¥{Math.abs(row.difference.goods!).toFixed(2)}{row.difference.baselineKind === 'list' && <span className="block text-sm text-muted-foreground">Against list price; negotiated price not recorded.</span>}</p> : <p className="text-muted-foreground">{row.difference.reason}</p>}{row.difference.reference && <p className="text-muted-foreground">Import {row.difference.reference.index_no} · {row.difference.reference.order_date || 'Date unrecorded'}</p>}
              {onChange && row.difference.reference && <label className="flex items-start gap-2 text-sm"><Checkbox checked={review.samePreviousUnit} disabled={disabled || !review.include} onCheckedChange={checked => onChange(sku.id, { samePreviousUnit: checked === true })} /><span>I confirm the same previously purchased variant and unit / pack.</span></label>}
            </div></TableCell>
          </>}
          {onChoose && <TableCell><Button type="button" size="sm" variant={chosenId === sku.id ? 'secondary' : 'outline'} disabled={disabled || !skuKey(sku)} onClick={() => onChoose(sku.id)}>{chosenId === sku.id ? 'Selected target' : 'Use as target'}</Button></TableCell>}
          {findings && <TableCell className="min-w-64 whitespace-normal"><p className="font-medium">{finding?.status ?? 'Unverified'}</p><p className="text-sm text-muted-foreground">{finding?.reason ?? 'No interpretation saved for this SKU.'}</p></TableCell>}
        </TableRow>
      })}</TableBody></Table>
    </div>
  </div>
}
