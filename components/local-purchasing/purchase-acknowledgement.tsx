'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'

export function PurchaseAcknowledgement({ actual, onActual, requiresReason, reason, onReason, confirmationOnly = false }: {
  actual: boolean; onActual: (value: boolean) => void; requiresReason: boolean; reason: string;
  onReason: (value: string) => void; confirmationOnly?: boolean
}) {
  // These fixed-orientation fields need no query container; containment can collapse them inside a resizing fieldset.
  return <FieldGroup className="[container-type:normal]">
    {!confirmationOnly && <Field orientation="horizontal">
      <Checkbox id="actual-purchase" checked={actual} onCheckedChange={(value)=>onActual(value===true)} />
      <FieldLabel htmlFor="actual-purchase">This records an actual purchase, not just a supplier quotation or order.</FieldLabel>
    </Field>}
    {requiresReason && <Field>
      <FieldLabel htmlFor="purchase-exception-reason">Why are you accepting these differences or corrections?</FieldLabel>
      <Textarea id="purchase-exception-reason" value={reason} onChange={(e)=>onReason(e.target.value)} placeholder="Describe what you checked with the supplier and why these figures are accepted." maxLength={4000} rows={3} />
      <FieldDescription>This explanation is tied to the current figures, product decisions and order revision. Any change requires a fresh acknowledgement. Arithmetic exceptions remain labelled as exceptions.</FieldDescription>
    </Field>}
  </FieldGroup>
}
