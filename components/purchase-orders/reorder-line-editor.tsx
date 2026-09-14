'use client'

import { ExternalLink, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ProductThumb } from '@/components/ui/product-thumb'
import { ExistingVariantPicker } from '@/components/local-purchasing/product-picker'
import { ImportReferencePicker } from './import-reference-picker'
import type { PricingProduct } from '@/lib/products/pricing'
import { copyImportReference, clearSupplierReference, safeImportLink } from '@/lib/purchase-orders/reorder-reference'
import { purchaseMoney, type ImportReference, type ReorderLine } from '@/lib/purchase-orders/workflow'
import { calculateImportLine } from '@/lib/purchase-orders/reorder-calculations'
import { PurchaseNumberField, PurchaseSelect } from './reorder-fields'

export function ReorderLineEditor({
  line,
  product,
  references,
  supplierName,
  onChange,
  onRemove,
  disabled = false,
  response = false,
}: {
  line: ReorderLine
  product?: PricingProduct
  references: ImportReference[]
  supplierName: string
  onChange: (line: ReorderLine) => void
  onRemove?: () => void
  disabled?: boolean
  response?: boolean
}) {
  const set = <K extends keyof ReorderLine>(key: K, value: ReorderLine[K]) => onChange({ ...line, [key]: value })
  const costs = calculateImportLine(line)
  const source = line.sourceSnapshot
  const prefix = `reorder-${line.id}`
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumb src={line.imageUrl} className="size-14 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <h3 className="font-semibold text-pretty">{line.productName || 'Product unavailable'}</h3>
              <p className="text-sm text-muted-foreground">
                {line.variantLabel || 'Physical units, not client orders'}
              </p>
            </div>
          </div>
          {onRemove && !response && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${line.productName}`}
              onClick={onRemove}
              disabled={disabled}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          {response && (
            <Field orientation="horizontal">
              <Checkbox
                id={`${prefix}-unavailable`}
                checked={line.unavailable}
                onCheckedChange={(value) => set('unavailable', value === true)}
                disabled={disabled}
              />
              <FieldLabel htmlFor={`${prefix}-unavailable`}>Supplier cannot supply this product</FieldLabel>
            </Field>
          )}
          {!response && product && (
            <ExistingVariantPicker
              id={`${prefix}-variant`}
              product={product}
              value={line.variantId}
              disabled={disabled}
              onChange={(id) => {
                const variant = product.variants?.find((item) => item.id === id)
                onChange({
                  ...clearSupplierReference(line),
                  variantId: id,
                  variantLabel: variant ? `${variant.attributeName}: ${variant.attributeValue}` : null,
                  imageUrl: variant?.imageUrl || product.imageUrl,
                })
              }}
            />
          )}
          <FieldGroup className="grid sm:grid-cols-2 xl:grid-cols-4">
            <PurchaseNumberField
              id={`${prefix}-qty`}
              label={response ? 'Supplier quantity · units' : 'Your quantity · units'}
              value={line.qty}
              whole
              onChange={(v) => set('qty', v)}
              disabled={disabled || line.unavailable}
            />
            <PurchaseNumberField
              id={`${prefix}-price`}
              label="Unit price · CNY"
              value={line.priceCny}
              onChange={(v) => set('priceCny', v)}
              disabled={disabled || line.unavailable}
            />
            <PurchaseSelect
              id={`${prefix}-price-mode`}
              label="Price basis"
              value={line.priceMode}
              onChange={(v) => set('priceMode', v as ReorderLine['priceMode'])}
              disabled={disabled || line.unavailable}
              options={[
                { value: 'net', label: 'Net price — already discounted' },
                { value: 'discount', label: 'List price — apply discount' },
              ]}
            />
            {line.priceMode === 'discount' ? (
              <PurchaseNumberField
                id={`${prefix}-discount`}
                label="Discount still applicable · %"
                value={line.discountPercent}
                onChange={(v) => set('discountPercent', v ?? 0)}
                disabled={disabled || line.unavailable}
              />
            ) : (
              <div className="flex flex-col justify-center gap-1">
                <p className="text-sm text-muted-foreground">Goods subtotal · CNY</p>
                <p className="font-semibold tabular-nums">{purchaseMoney(costs.goods, 'CNY')}</p>
              </div>
            )}
          </FieldGroup>
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Supplier reference, freight & packaging
            </summary>
            <div className="px-4 pb-4">
              <FieldGroup>
                {!response && (
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-source`}>Copy figures from a past China import</FieldLabel>
                    <ImportReferencePicker
                      id={`${prefix}-source`}
                      references={references}
                      productId={line.productId}
                      value={line.sourceImportId}
                      disabled={disabled}
                      onSelect={(reference) =>
                        onChange(reference ? copyImportReference(line, reference) : clearSupplierReference(line))
                      }
                    />
                    <FieldDescription>
                      This product’s own imports are listed first. You can also borrow the cost figures from any other
                      import as an estimate — it never changes your quantity or the original import.
                    </FieldDescription>
                  </Field>
                )}
                {source && (
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Reference {source.index_no || 'import'}</Badge>
                      <span className="text-muted-foreground">Previously bought {source.qty ?? 'unknown'} units</span>
                      {safeImportLink(source.link) && (
                        <a
                          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                          href={safeImportLink(source.link)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Listing
                          <ExternalLink className="size-4" />
                        </a>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      Copied prices and weight/volume ratios are reference estimates, not a new supplier quote. Old
                      tracking and payment links are not copied.
                    </p>
                    {source.product_id !== line.productId && (
                      <p className="text-destructive">
                        These figures come from a different product ({source.product_name || 'another import'}). Treat
                        them as an estimate and verify the price, freight and packaging before ordering.
                      </p>
                    )}
                    {source.product_id === line.productId && line.variantId !== (source.variant_id || null) && (
                      <p>Product-level history does not establish this variant’s price or packaging.</p>
                    )}
                    {source.referenceWarning && <p className="text-destructive">{source.referenceWarning}</p>}
                  </div>
                )}
                <FieldGroup className="grid sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-supplier-label`}>Supplier product wording</FieldLabel>
                    <Input
                      id={`${prefix}-supplier-label`}
                      value={line.supplierLabel}
                      onChange={(e) => set('supplierLabel', e.target.value)}
                      disabled={disabled}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-listing`}>Supplier listing URL</FieldLabel>
                    <Input
                      id={`${prefix}-listing`}
                      type="url"
                      value={line.listingUrl}
                      onChange={(e) => set('listingUrl', e.target.value)}
                      disabled={disabled}
                      placeholder="https://detail.1688.com/..."
                    />
                  </Field>
                  <PurchaseNumberField
                    id={`${prefix}-china-freight`}
                    label="Line freight within China · CNY"
                    value={line.chinaFreight}
                    onChange={(v) => set('chinaFreight', v)}
                    disabled={disabled || line.unavailable}
                    hint="Enter 0 only if none. Do not repeat shared freight here."
                  />
                  <PurchaseSelect
                    id={`${prefix}-china-basis`}
                    label="China freight basis"
                    value={line.chinaFreightBasis}
                    onChange={(v) => set('chinaFreightBasis', v as ReorderLine['chinaFreightBasis'])}
                    disabled={disabled || line.unavailable}
                    options={[
                      { value: 'fixed', label: 'Fixed total for this product' },
                      { value: 'unit', label: 'Per physical unit' },
                    ]}
                  />
                  <PurchaseNumberField
                    id={`${prefix}-carton`}
                    label="Confirmed units per carton"
                    value={line.unitsPerCarton}
                    whole
                    onChange={(v) => set('unitsPerCarton', v)}
                    disabled={disabled || line.unavailable}
                    hint={
                      costs.cartons != null
                        ? `${costs.cartons} cartons at your current quantity.`
                        : 'Previous order quantity is not a carton size or MOQ.'
                    }
                  />
                  <PurchaseNumberField
                    id={`${prefix}-kg`}
                    label="Weight per unit · kg"
                    value={line.kgPerUnit}
                    onChange={(v) => set('kgPerUnit', v)}
                    disabled={disabled || line.unavailable}
                  />
                  <PurchaseNumberField
                    id={`${prefix}-cbm`}
                    label="Volume per unit · CBM"
                    value={line.cbmPerUnit}
                    onChange={(v) => set('cbmPerUnit', v)}
                    disabled={disabled || line.unavailable}
                    hint={costs.cbm != null ? `Total volume: ${costs.cbm.toLocaleString()} CBM.` : undefined}
                  />
                </FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${prefix}-notes`}>Notes for this product</FieldLabel>
                  <Textarea
                    id={`${prefix}-notes`}
                    value={line.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    disabled={disabled}
                  />
                  <FieldDescription>Included in the supplier request.</FieldDescription>
                </Field>
              </FieldGroup>
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  )
}
