'use client'

import { useId, type Dispatch, type SetStateAction } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field, FieldContent, FieldDescription, FieldError, FieldGroup,
  FieldLabel, FieldLegend, FieldSet,
} from '@/components/ui/field'
import { MAX_BUNDLE_ROWS, newBundlePriceRow, validateProductPricing, type PricingDraft } from '@/lib/products/pricing'

export function ProductPricingFields({
  value,
  onChange,
  disabled = false,
  requirePricing = false,
  showErrors = false,
  variantDefaults = false,
}: {
  value: PricingDraft
  onChange: Dispatch<SetStateAction<PricingDraft>>
  disabled?: boolean
  requirePricing?: boolean
  showErrors?: boolean
  variantDefaults?: boolean
}) {
  const id = useId()
  const result = validateProductPricing(value, { requirePricing })
  const issues = showErrors && !result.ok ? result.issues : []
  const issue = (path: string) => issues.find((item) => item.path === path)?.message
  const unitError = issue('unitPrice')
  const setError = issue('bundleRows')

  const editRow = (rowId: string, patch: Partial<Pick<PricingDraft['bundleRows'][number], 'qty' | 'price'>>) => {
    onChange((current) => ({
      ...current,
      bundleRows: current.bundleRows.map((row) => row.id === rowId ? { ...row, ...patch } : row),
    }))
  }

  return (
    <FieldSet disabled={disabled} className="min-w-0 gap-4">
      <FieldLegend>{variantDefaults ? 'Default selling prices' : 'Selling prices'}{requirePricing ? ' (required)' : ''}</FieldLegend>
      {variantDefaults && <FieldDescription>A default unit price is optional when each variant has its own selling price.</FieldDescription>}
      <FieldGroup className="gap-4">
        <Field data-invalid={!!unitError} data-disabled={disabled || value.soldInSets} className="gap-2">
          <FieldLabel htmlFor={`${id}-unit`}>
            {value.soldInSets ? 'Unit Price (not sold singly)' : variantDefaults ? 'Default unit price (Rs)' : 'Unit Price (Rs)'}
          </FieldLabel>
          <Input
            id={`${id}-unit`}
            inputMode="decimal"
            value={value.soldInSets ? '' : value.unitPrice}
            onChange={(event) => {
              const unitPrice = event.target.value
              onChange((current) => ({ ...current, unitPrice }))
            }}
            placeholder={value.soldInSets ? 'Whole sets only' : 'Enter selling price'}
            disabled={disabled || value.soldInSets}
            aria-required={requirePricing && !value.soldInSets}
            aria-invalid={!!unitError}
            aria-describedby={unitError ? `${id}-unit-error` : undefined}
          />
          {unitError && <FieldError id={`${id}-unit-error`}>{unitError}</FieldError>}
        </Field>

        <Field orientation="horizontal" data-disabled={disabled}>
          <Checkbox
            id={`${id}-sets`}
            checked={value.soldInSets}
            onCheckedChange={(checked) => onChange((current) => ({ ...current, soldInSets: checked === true }))}
            disabled={disabled}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${id}-sets`}>Sold only in sets</FieldLabel>
            <FieldDescription>No single price — the customer buys a whole pack.</FieldDescription>
          </FieldContent>
        </Field>

        <FieldSet className="min-w-0 gap-3">
          <FieldLegend variant="label">{value.soldInSets ? 'Set Prices (Rs)' : 'Sets & Bundle Prices'}</FieldLegend>
          <FieldGroup className="gap-3">
            {value.bundleRows.map((row, index) => {
              const qtyError = issue(`bundleRows.${index}.qty`)
              const priceError = issue(`bundleRows.${index}.price`)
              return (
                <FieldGroup key={row.id} className="flex-row items-start gap-2">
                  <Field className="w-20 shrink-0 gap-2 sm:w-24" data-invalid={!!qtyError}>
                    <FieldLabel htmlFor={`${id}-${row.id}-qty`} className="sr-only">Pack size for bundle {index + 1}</FieldLabel>
                    <Input
                      id={`${id}-${row.id}-qty`}
                      inputMode="numeric"
                      value={row.qty}
                      onChange={(event) => editRow(row.id, { qty: event.target.value })}
                      placeholder="5"
                      disabled={disabled}
                      aria-invalid={!!qtyError}
                      aria-describedby={qtyError ? `${id}-${row.id}-qty-error` : undefined}
                    />
                    {qtyError && <FieldError id={`${id}-${row.id}-qty-error`}>{qtyError}</FieldError>}
                  </Field>
                  <span className="flex h-9 shrink-0 items-center text-sm text-muted-foreground">pcs for Rs</span>
                  <Field className="min-w-0 flex-1 gap-2" data-invalid={!!priceError}>
                    <FieldLabel htmlFor={`${id}-${row.id}-price`} className="sr-only">Total price for bundle {index + 1}</FieldLabel>
                    <Input
                      id={`${id}-${row.id}-price`}
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) => editRow(row.id, { price: event.target.value })}
                      placeholder="375"
                      disabled={disabled}
                      aria-invalid={!!priceError}
                      aria-describedby={priceError ? `${id}-${row.id}-price-error` : undefined}
                    />
                    {priceError && <FieldError id={`${id}-${row.id}-price-error`}>{priceError}</FieldError>}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0"
                    disabled={disabled}
                    aria-label={`Remove bundle ${index + 1}`}
                    onClick={() => onChange((current) => ({ ...current, bundleRows: current.bundleRows.filter((item) => item.id !== row.id) }))}
                  >
                    <X />
                  </Button>
                </FieldGroup>
              )
            })}
            {value.bundleRows.length === 0 && <FieldDescription>No sets added. Use any pack size, e.g. 5 pcs for Rs 375.</FieldDescription>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={disabled || value.bundleRows.length >= MAX_BUNDLE_ROWS}
              onClick={() => {
                const row = newBundlePriceRow()
                onChange((current) => ({ ...current, bundleRows: [...current.bundleRows, row] }))
              }}
            >
              <Plus data-icon="inline-start" />
              Add Set
            </Button>
            <FieldDescription>The price is the total for the whole pack, not per piece.</FieldDescription>
            {setError && <FieldError>{setError}</FieldError>}
          </FieldGroup>
        </FieldSet>

        <Field orientation="horizontal" data-disabled={disabled}>
          <Checkbox
            id={`${id}-b1g1`}
            checked={value.isB1g1}
            onCheckedChange={(checked) => onChange((current) => ({ ...current, isB1g1: checked === true }))}
            disabled={disabled}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${id}-b1g1`}>B1G1 Offer (Buy 1 Get 1)</FieldLabel>
            <FieldDescription>The paid price stays the same; the extra item is free.</FieldDescription>
          </FieldContent>
        </Field>
        {issue('draft') && <FieldError>{issue('draft')}</FieldError>}
      </FieldGroup>
    </FieldSet>
  )
}
