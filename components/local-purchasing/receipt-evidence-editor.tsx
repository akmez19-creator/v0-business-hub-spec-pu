'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { nullableNumber, type ReceiptEvidence, type ReceiptLine } from '@/lib/local-purchasing/evidence'
import type { ReceiptOverrides } from '@/lib/local-purchasing/reconcile'

const selectClass = 'h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground'

export function ReceiptEvidenceEditor({ document, overrides, onDocument, onOverrides }: {
  document: ReceiptEvidence; overrides: ReceiptOverrides;
  onDocument: (patch: Partial<ReceiptEvidence>) => void; onOverrides: (patch: ReceiptOverrides) => void
}) {
  return <details className="rounded-lg border border-border bg-card text-card-foreground">
    <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Review printed figures or adjust an exception</summary>
    <div className="px-4 pb-4">
      <FieldGroup>
        <FieldDescription>The default is automatic. Corrections and manual price treatments require a reason when saved; the original file and transcription are retained.</FieldDescription>
        <FieldGroup className="sm:grid sm:grid-cols-3">
          {([['declaredSubtotal','Printed subtotal (excl. VAT)'], ['declaredVat','Printed VAT'], ['declaredTotal','Printed total payable'], ['discountPercent','Printed discount %'], ['discountAmount','Printed discount amount'], ['vatPercent','Printed VAT rate %'], ['roundingAmount','Printed rounding adjustment']] as const).map(([key,label]) => <Field key={key}>
            <FieldLabel htmlFor={`evidence-${key}`}>{label}</FieldLabel>
            <Input id={`evidence-${key}`} type="number" step="any" inputMode="decimal" value={document[key] ?? ''} placeholder="Not printed" onChange={(e) => onDocument({ [key]: nullableNumber(e.target.value) })} />
          </Field>)}
          <Field><FieldLabel htmlFor="evidence-kind">Document type</FieldLabel>
            <select id="evidence-kind" className={selectClass} value={document.docKind} onChange={(e) => onDocument({docKind:e.target.value as ReceiptEvidence['docKind']})}>
              <option value="unknown">Not determined</option><option value="invoice">Invoice</option><option value="receipt">Receipt</option><option value="quote">Supplier quotation / confirmation</option><option value="pricelist">Price list</option>
            </select>
          </Field>
          <Field><FieldLabel htmlFor="evidence-subtotal-stage">Subtotal label</FieldLabel>
            <select id="evidence-subtotal-stage" className={selectClass} value={document.subtotalStage ?? ''} onChange={(e) => onDocument({ subtotalStage: e.target.value as ReceiptEvidence['subtotalStage'] || null })}>
              <option value="">Not stated (net subtotal)</option><option value="before_discount">Before discount</option><option value="after_discount">After discount</option>
            </select>
          </Field>
        </FieldGroup>
        <Field>
          <FieldLabel>VAT interpretation</FieldLabel>
          <ToggleGroup type="single" variant="outline" value={overrides.pricesIncludeVat == null ? 'auto' : overrides.pricesIncludeVat ? 'inclusive' : 'exclusive'} onValueChange={(value) => value && onOverrides({ ...overrides, pricesIncludeVat: value === 'auto' ? null : value === 'inclusive' })} className="flex-wrap justify-start" aria-label="VAT interpretation">
            <ToggleGroupItem value="auto">Automatic</ToggleGroupItem><ToggleGroupItem value="inclusive">Already included</ToggleGroupItem><ToggleGroupItem value="exclusive">Add VAT</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Printed discount interpretation</FieldLabel>
          <ToggleGroup type="single" variant="outline" value={overrides.discountTreatment ?? 'auto'} onValueChange={(value) => value && onOverrides({ ...overrides, discountTreatment: value === 'auto' ? null : value as 'included' | 'apply' })} className="flex-wrap justify-start" aria-label="Discount interpretation">
            <ToggleGroupItem value="auto">Automatic</ToggleGroupItem><ToggleGroupItem value="included">Already reflected</ToggleGroupItem><ToggleGroupItem value="apply">Still to deduct</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        {(document.charges ?? []).map((charge,index) => <FieldGroup key={index} className="sm:grid sm:grid-cols-5">
          <Field><FieldLabel htmlFor={`charge-label-${index}`}>Charge description</FieldLabel><Input id={`charge-label-${index}`} value={charge.label} onChange={(e) => onDocument({ charges: document.charges!.map((c,i)=>i===index?{...c,label:e.target.value}:c) })} /></Field>
          <Field><FieldLabel htmlFor={`charge-amount-${index}`}>Printed amount</FieldLabel><Input id={`charge-amount-${index}`} type="number" step="any" value={charge.amount ?? ''} onChange={(e) => onDocument({ charges: document.charges!.map((c,i)=>i===index?{...c,amount:nullableNumber(e.target.value)}:c) })} /></Field>
          <Field><FieldLabel htmlFor={`charge-vat-${index}`}>Charge VAT %</FieldLabel><Input id={`charge-vat-${index}`} type="number" step="any" placeholder="Document rate" value={charge.vatPercent ?? ''} onChange={(e) => onDocument({ charges: document.charges!.map((c,i)=>i===index?{...c,vatPercent:nullableNumber(e.target.value)}:c) })} /></Field>
          <Field><FieldLabel htmlFor={`charge-basis-${index}`}>Charge VAT basis</FieldLabel><select id={`charge-basis-${index}`} className={selectClass} value={charge.pricesIncludeVat==null?'':charge.pricesIncludeVat?'included':'added'} onChange={(e)=>onDocument({charges:document.charges!.map((c,i)=>i===index?{...c,pricesIncludeVat:e.target.value?e.target.value==='included':null}:c)})}><option value="">Document basis</option><option value="included">Included</option><option value="added">Added</option></select></Field>
          <Button type="button" variant="outline" onClick={()=>onDocument({charges:document.charges!.filter((_,i)=>i!==index)})}><Trash2 data-icon="inline-start" />Remove charge</Button>
        </FieldGroup>)}
        <div><Button type="button" variant="outline" onClick={()=>onDocument({charges:[...(document.charges??[]),{label:'Delivery',amount:null,vatPercent:null,pricesIncludeVat:null}]})}><Plus data-icon="inline-start" />Add a printed charge</Button></div>
        {(document.issues?.length || !document.legible) ? <Field>
          <FieldDescription>{document.issues?.join(' ')}{!document.legible && ' The original was not fully legible.'}</FieldDescription>
          <div><Button type="button" variant="outline" onClick={()=>onDocument({issues:[],legible:true})}>I checked the unclear document labels</Button></div>
        </Field> : null}
      </FieldGroup>
    </div>
  </details>
}

export function ReceiptLineEvidenceEditor({ line, onChange }: { line: ReceiptLine; onChange: (patch: Partial<ReceiptLine>) => void }) {
  return <details className="text-sm">
    <summary className="cursor-pointer py-2 text-muted-foreground">Printed row evidence{line.sourcePage ? ` · page ${line.sourcePage}` : ''}{line.sourceRow ? ` · row ${line.sourceRow}` : ''}</summary>
    <FieldGroup className="sm:grid sm:grid-cols-3">
      {([['lineTotal','Printed line amount'],['discountPercent','Line discount %'],['discountAmount','Line discount amount'],['vatPercent','Line VAT %'],['vatAmount','Printed line VAT']] as const).map(([key,label])=><Field key={key}><FieldLabel htmlFor={`${line.key}-${key}`}>{label}</FieldLabel><Input id={`${line.key}-${key}`} type="number" step="any" inputMode="decimal" placeholder="Not printed" value={line[key]??''} onChange={(e)=>onChange({[key]:nullableNumber(e.target.value)})}/></Field>)}
      <Field><FieldLabel htmlFor={`${line.key}-unit-stage`}>Unit-price label</FieldLabel><select id={`${line.key}-unit-stage`} className={selectClass} value={line.unitPriceStage??''} onChange={(e)=>onChange({unitPriceStage:e.target.value as ReceiptLine['unitPriceStage']||null})}><option value="">Not stated</option><option value="before_discount">Before discount</option><option value="after_discount">After discount</option></select></Field>
      <Field><FieldLabel htmlFor={`${line.key}-total-stage`}>Line-amount label</FieldLabel><select id={`${line.key}-total-stage`} className={selectClass} value={line.lineTotalStage??''} onChange={(e)=>onChange({lineTotalStage:e.target.value as ReceiptLine['lineTotalStage']||null})}><option value="">Not stated</option><option value="before_discount">Before discount</option><option value="after_discount">After discount</option><option value="payable">Payable (VAT included)</option></select></Field>
      <Field><FieldLabel htmlFor={`${line.key}-vat-cue`}>Line VAT basis</FieldLabel><select id={`${line.key}-vat-cue`} className={selectClass} value={line.pricesIncludeVat==null?'':line.pricesIncludeVat?'included':'added'} onChange={(e)=>onChange({pricesIncludeVat:e.target.value?e.target.value==='included':null})}><option value="">Document basis</option><option value="included">Included</option><option value="added">Added</option></select></Field>
      {!!line.issues?.length && <Field><FieldDescription>{line.issues.join(' ')}</FieldDescription><Button type="button" variant="outline" onClick={()=>onChange({issues:[]})}>I checked this row</Button></Field>}
    </FieldGroup>
  </details>
}
