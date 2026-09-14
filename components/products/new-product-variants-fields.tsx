'use client'

import { useId, type Dispatch, type SetStateAction } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MAX_PRODUCT_VARIANTS, VARIANT_ATTRIBUTES, formatSellingPrice, newVariantRow, validateNewProductPricing, type NewVariantRow, type NewVariantsDraft, type PricingDraft } from '@/lib/products/pricing'

export function NewProductVariantsFields({ value, onChange, pricing, disabled = false, showErrors = false, requirePricing = false, showStock = false }: {
  value: NewVariantsDraft
  onChange: Dispatch<SetStateAction<NewVariantsDraft>>
  pricing: PricingDraft
  disabled?: boolean
  showErrors?: boolean
  requirePricing?: boolean
  showStock?: boolean
}) {
  const id = useId()
  const checked = validateNewProductPricing(pricing, value, { requirePricing })
  const issues = showErrors && !checked.ok ? checked.issues : []
  const issue = (path: string) => issues.find((item) => item.path === path)?.message
  const defaultPrice = !pricing.soldInSets && Number(pricing.unitPrice) > 0 ? Number(pricing.unitPrice) : null
  const patch = (key: string, changes: Partial<NewVariantRow>) => onChange((current) => ({
    ...current, rows: current.rows.map((row) => row.key === key ? { ...row, ...changes } : row),
  }))

  return (
    <FieldSet disabled={disabled} className="min-w-0 gap-4">
      <FieldLegend>Variants</FieldLegend>
      <Field orientation="horizontal" data-disabled={disabled}>
        <Checkbox
          id={`${id}-enabled`}
          checked={value.enabled}
          disabled={disabled}
          onCheckedChange={(checked) => {
            const enabled = checked === true
            onChange((current) => ({ enabled, rows: enabled && current.rows.length === 0 ? [newVariantRow()] : current.rows }))
          }}
        />
        <FieldContent>
          <FieldLabel htmlFor={`${id}-enabled`}>Has variants</FieldLabel>
          <FieldDescription>Different sizes, capacities, colours or models of this product.</FieldDescription>
        </FieldContent>
      </Field>
      {value.enabled && (
        <FieldGroup className="gap-4">
          <FieldDescription>
            Set each variant&apos;s customer selling price, or leave it blank to use the product&apos;s default price.
            {!showStock && ' Supplier costs and receipt quantities stay separate; every new variant starts with zero recorded stock.'}
          </FieldDescription>
          {value.rows.map((row, index) => {
            const prefix = `variants.rows.${index}`
            const field = (key: keyof NewVariantRow) => `${id}-${row.key}-${key}`
            return (
              <div key={row.key} className="rounded-lg border border-border bg-background p-3 text-foreground">
                <FieldSet className="min-w-0 gap-3">
                  <FieldLegend variant="label">Variant {index + 1}</FieldLegend>
                  <FieldGroup className="gap-3">
                    <FieldGroup className="gap-3 sm:flex-row">
                      <Field className="min-w-0 flex-1 gap-2" data-invalid={!!issue(`${prefix}.attributeName`)}>
                        <FieldLabel htmlFor={field('attributeName')}>Type</FieldLabel>
                        <Select value={row.attributeName} onValueChange={(attributeName) => patch(row.key, { attributeName })} disabled={disabled}>
                          <SelectTrigger id={field('attributeName')} aria-label={`Variant ${index + 1} type`} aria-invalid={!!issue(`${prefix}.attributeName`)} aria-describedby={issue(`${prefix}.attributeName`) ? `${field('attributeName')}-error` : undefined} className="w-full">
                            <SelectValue placeholder="Choose a type" />
                          </SelectTrigger>
                          <SelectContent><SelectGroup>{VARIANT_ATTRIBUTES.map((attribute) => <SelectItem key={attribute} value={attribute}>{attribute}</SelectItem>)}</SelectGroup></SelectContent>
                        </Select>
                        {issue(`${prefix}.attributeName`) && <FieldError id={`${field('attributeName')}-error`}>{issue(`${prefix}.attributeName`)}</FieldError>}
                      </Field>
                      <Field className="min-w-0 flex-1 gap-2" data-invalid={!!issue(`${prefix}.attributeValue`)}>
                        <FieldLabel htmlFor={field('attributeValue')}>Value</FieldLabel>
                        <Input id={field('attributeValue')} aria-label={`Variant ${index + 1} value`} value={row.attributeValue} onChange={(event) => patch(row.key, { attributeValue: event.target.value })} disabled={disabled} placeholder={row.attributeName === 'Model' ? 'e.g. W-001' : row.attributeName === 'Capacity' || row.attributeName === 'Weight' ? 'e.g. 2Kg' : 'e.g. Large'} maxLength={120} aria-invalid={!!issue(`${prefix}.attributeValue`)} aria-describedby={issue(`${prefix}.attributeValue`) ? `${field('attributeValue')}-error` : undefined} />
                        {issue(`${prefix}.attributeValue`) && <FieldError id={`${field('attributeValue')}-error`}>{issue(`${prefix}.attributeValue`)}</FieldError>}
                      </Field>
                    </FieldGroup>
                    <Field data-invalid={!!issue(`${prefix}.priceOverride`)} className="gap-2">
                      <FieldLabel htmlFor={field('priceOverride')}>Selling price (Rs)</FieldLabel>
                      <Input id={field('priceOverride')} aria-label={`Variant ${index + 1} selling price (Rs)`} inputMode="decimal" value={row.priceOverride} onChange={(event) => patch(row.key, { priceOverride: event.target.value })} disabled={disabled} placeholder={defaultPrice == null ? 'Enter variant selling price' : `Default: ${formatSellingPrice(defaultPrice)}`} aria-invalid={!!issue(`${prefix}.priceOverride`)} aria-describedby={`${field('priceOverride')}-hint`} />
                      <FieldDescription id={`${field('priceOverride')}-hint`}>{row.priceOverride.trim() ? 'Customer price per unit of this variant, not supplier cost.' : defaultPrice != null ? `Uses ${formatSellingPrice(defaultPrice)} / unit when left blank.` : pricing.soldInSets ? 'Whole-set prices still apply; leave blank if this variant is not sold singly.' : 'No default unit price is set.'}</FieldDescription>
                      {issue(`${prefix}.priceOverride`) && <FieldError>{issue(`${prefix}.priceOverride`)}</FieldError>}
                    </Field>
                    {showStock && <FieldGroup className="gap-3 sm:flex-row">
                      <Field className="min-w-0 flex-1 gap-2" data-invalid={!!issue(`${prefix}.quantity`)}>
                        <FieldLabel htmlFor={field('quantity')}>Recorded stock</FieldLabel>
                        <Input id={field('quantity')} aria-label={`Variant ${index + 1} recorded stock`} inputMode="numeric" value={row.quantity} onChange={(event) => patch(row.key, { quantity: event.target.value })} disabled={disabled} aria-invalid={!!issue(`${prefix}.quantity`)} />
                        {issue(`${prefix}.quantity`) && <FieldError>{issue(`${prefix}.quantity`)}</FieldError>}
                      </Field>
                      <Field className="min-w-0 flex-1 gap-2" data-invalid={!!issue(`${prefix}.sku`)}>
                        <FieldLabel htmlFor={field('sku')}>Variant SKU (optional)</FieldLabel>
                        <Input id={field('sku')} aria-label={`Variant ${index + 1} SKU`} value={row.sku} onChange={(event) => patch(row.key, { sku: event.target.value })} disabled={disabled} maxLength={200} aria-invalid={!!issue(`${prefix}.sku`)} />
                        {issue(`${prefix}.sku`) && <FieldError>{issue(`${prefix}.sku`)}</FieldError>}
                      </Field>
                    </FieldGroup>}
                    <Button type="button" variant="ghost" size="sm" className="self-end" aria-label={`Remove variant ${index + 1}`} disabled={disabled} onClick={() => onChange((current) => ({ ...current, rows: current.rows.filter((item) => item.key !== row.key) }))}>
                      <X data-icon="inline-start" />Remove variant
                    </Button>
                  </FieldGroup>
                </FieldSet>
              </div>
            )
          })}
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={disabled || value.rows.length >= MAX_PRODUCT_VARIANTS} onClick={() => onChange((current) => ({ ...current, rows: [...current.rows, newVariantRow()] }))}>
            <Plus data-icon="inline-start" />Add variant
          </Button>
          <FieldDescription>The product and all variants are saved together. A value such as 2Kg identifies the variant; it does not multiply a purchase quantity.</FieldDescription>
          {issue('variants') && <FieldError>{issue('variants')}</FieldError>}
        </FieldGroup>
      )}
    </FieldSet>
  )
}
