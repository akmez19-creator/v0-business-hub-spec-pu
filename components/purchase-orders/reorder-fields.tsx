'use client'

import { useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { numericInput, purchaseMoney, type ReorderSnapshot, type ReorderTerms } from '@/lib/purchase-orders/workflow'
import { calculateReorder } from '@/lib/purchase-orders/reorder-calculations'

export function usePurchaseRequestKey() {
  const request = useRef<{ payload: string; key: string } | null>(null)
  return (input: unknown) => {
    const payload = JSON.stringify(input)
    if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() }
    return request.current.key
  }
}
export function PurchaseNumberField({
  id,
  label,
  value,
  onChange,
  disabled,
  whole = false,
  hint,
}: {
  id: string
  label: string
  value: number | null
  onChange: (value: number | null) => void
  disabled?: boolean
  whole?: boolean
  hint?: string
}) {
  const invalid = value != null && (!Number.isFinite(value) || value < 0 || (whole && !Number.isInteger(value)))
  return (
    <Field data-invalid={invalid} data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode={whole ? 'numeric' : 'decimal'}
        min={0}
        step={whole ? 1 : 'any'}
        value={value ?? ''}
        onChange={(event) => onChange(numericInput(event.target.value))}
        disabled={disabled}
        aria-invalid={invalid}
        placeholder="Not set"
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  )
}
export function PurchaseSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
export function PurchaseError({ error }: { error: string | null | undefined }) {
  if (!error) return null
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Could not complete this step</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )
}
export function ReorderTermsFields({
  terms,
  onChange,
  disabled = false,
  response = false,
}: {
  terms: ReorderTerms
  onChange: (terms: ReorderTerms) => void
  disabled?: boolean
  response?: boolean
}) {
  const set = <K extends keyof ReorderTerms>(key: K, value: ReorderTerms[K]) =>
    onChange({ ...terms, [key]: value, landedReviewed: key === 'landedReviewed' ? (value as boolean) : false })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Shared freight & conversion</CardTitle>
        <CardDescription>
          These charges apply once to this supplier request. Leave unknown amounts blank; enter 0 only when no charge
          applies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="grid sm:grid-cols-2 xl:grid-cols-3">
          <PurchaseNumberField
            id="reorder-fx"
            label="MUR per CNY"
            value={terms.fxRate}
            onChange={(v) => set('fxRate', v)}
            disabled={disabled}
          />
          <PurchaseNumberField
            id="shared-china"
            label="Shared China freight · CNY"
            value={terms.sharedChinaFreight}
            onChange={(v) => set('sharedChinaFreight', v)}
            disabled={disabled}
            hint="In addition to each line’s China freight."
          />
          <PurchaseSelect
            id="allocation-basis"
            label="Allocate shared charges by"
            value={terms.allocationBasis}
            onChange={(v) => set('allocationBasis', v as ReorderTerms['allocationBasis'])}
            disabled={disabled}
            options={[
              { value: 'qty', label: 'Physical units' },
              { value: 'value', label: 'Goods value' },
              { value: 'cbm', label: 'Volume (CBM)' },
            ]}
          />
          <PurchaseSelect
            id="import-freight-mode"
            label="Import freight basis"
            value={terms.importFreightMode}
            onChange={(v) => set('importFreightMode', v as ReorderTerms['importFreightMode'])}
            disabled={disabled}
            options={[
              { value: 'fixed', label: 'Fixed shipment charge' },
              { value: 'cbm', label: 'Rate per CBM' },
            ]}
          />
          {terms.importFreightMode === 'fixed' ? (
            <PurchaseNumberField
              id="import-freight"
              label="Import freight · MUR"
              value={terms.importFreightMur}
              onChange={(v) => set('importFreightMur', v)}
              disabled={disabled}
            />
          ) : (
            <PurchaseNumberField
              id="cbm-rate"
              label="MUR per CBM"
              value={terms.cbmRateMur}
              onChange={(v) => set('cbmRateMur', v)}
              disabled={disabled}
            />
          )}
          <PurchaseNumberField
            id="other-charges"
            label="Other import charges · MUR"
            value={terms.otherChargesMur}
            onChange={(v) => set('otherChargesMur', v)}
            disabled={disabled}
            hint="No tax or customs percentage is assumed."
          />
          {response && (
            <Field orientation="horizontal" className="sm:col-span-2 xl:col-span-3">
              <Checkbox
                id="landed-reviewed"
                checked={terms.landedReviewed}
                onCheckedChange={(v) => set('landedReviewed', v === true)}
                disabled={disabled}
              />
              <div>
                <FieldLabel htmlFor="landed-reviewed">Final landed costs are verified</FieldLabel>
                <FieldDescription>
                  Only check after all freight, exchange rate and charges are final. Otherwise estimates stay outside
                  Inventory cost references.
                </FieldDescription>
              </div>
            </Field>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
export function ReorderTotals({ snapshot }: { snapshot: ReorderSnapshot }) {
  const totals = calculateReorder(snapshot)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request totals</CardTitle>
        <CardDescription>
          {snapshot.terms.landedReviewed && totals.complete
            ? 'Final costs marked verified'
            : 'Planning estimate — not a payment or stock receipt'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">Physical units</dt>
              <dd className="text-xl font-semibold tabular-nums">{totals.units.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Supplier · CNY</dt>
              <dd className="text-xl font-semibold tabular-nums">{purchaseMoney(totals.supplierCny, 'CNY')}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Supplier · MUR</dt>
              <dd className="text-xl font-semibold tabular-nums">{purchaseMoney(totals.supplierMur)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Landed estimate · MUR</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {totals.complete ? purchaseMoney(totals.landed) : 'Incomplete'}
              </dd>
            </div>
          </dl>
          {!totals.complete && (
            <Alert>
              <AlertCircle />
              <AlertTitle>Some costs are still unknown</AlertTitle>
              <AlertDescription>
                <p>
                  Known goods subtotal: {purchaseMoney(totals.knownGoodsCny, 'CNY')}. This is not the final payable or
                  landed amount.
                </p>
                <p>Missing: {totals.missing.join('; ')}.</p>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
