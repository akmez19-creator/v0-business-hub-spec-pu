'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProductPicker, ExistingVariantPicker } from '@/components/local-purchasing/product-picker'
import { correctImportAction, getImportCorrectionAction } from '@/app/dashboard/purchasing/imports/actions'
import {
  IMPORT_CORRECTION_FIELDS,
  importCorrectionPatch,
  correctionImpact,
  type ImportRecord,
} from '@/lib/purchase-orders/import-correction-fields'
import { PO_STATUSES, numericInput, type ImportPurchaseEvent } from '@/lib/purchase-orders/workflow'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { PurchaseError, PurchaseSelect, usePurchaseRequestKey } from './reorder-fields'
import { PurchaseAudit } from './reorder-review'

const show = (value: unknown) =>
  value == null || value === '' ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value)
export function ImportCorrectionEditor({
  initial,
  catalogue,
}: {
  initial: { record: ImportRecord; events: ImportPurchaseEvent[] }
  catalogue: ReorderCatalogue
}) {
  const { data = initial, mutate } = useSWR(
    `import-correction:${initial.record.id}`,
    () => getImportCorrectionAction(initial.record.id),
    { fallbackData: initial, revalidateOnFocus: false, revalidateOnMount: false },
  )
  const [form, setForm] = useState<ImportRecord>(initial.record)
  const [reason, setReason] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyFor = usePurchaseRequestKey()
  const patch = useMemo(() => importCorrectionPatch(data.record, form), [data.record, form])
  const impact = correctionImpact(data.record, form)
  const product = catalogue.products.find((product) => product.id === form.product_id)
  const set = (key: string, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }))
    setAccepted(false)
    setError(null)
  }
  const label = (key: string) =>
    IMPORT_CORRECTION_FIELDS.find((field) => field.key === key)?.label ||
    (key === 'product_id' ? 'Inventory product link' : key === 'variant_id' ? 'Variant link' : key)
  async function reload() {
    if (Object.keys(patch).length && !window.confirm('Discard unsaved corrections and reload the original record?'))
      return
    try {
      const fresh = await getImportCorrectionAction(form.id)
      await mutate(fresh, false)
      setForm(fresh.record)
      setAccepted(false)
      setReason('')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reload the import.')
    }
  }
  async function save() {
    const input = { id: form.id, expected: data.record, patch, reason, acknowledged: accepted }
    setBusy(true)
    setError(null)
    try {
      await correctImportAction({ ...input, requestKey: keyFor(input) })
      const fresh = await getImportCorrectionAction(form.id)
      await mutate(fresh, false)
      setForm(fresh.record)
      setReason('')
      setAccepted(false)
      toast.success('Original import corrected. Audit history saved. No physical stock was changed.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The correction could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  const fields = (group: 'details' | 'pricing' | 'logistics') => (
    <FieldGroup className="grid sm:grid-cols-2 xl:grid-cols-3">
      {IMPORT_CORRECTION_FIELDS.filter((field) => field.group === group).map((field) =>
        field.kind === 'status' ? (
          <PurchaseSelect
            key={field.key}
            id={`correct-${field.key}`}
            label={field.label}
            value={String(form.status || 'pending')}
            disabled={busy}
            onChange={(value) => set(field.key, value)}
            options={[
              ...new Set(['pending', ...PO_STATUSES, 'Cancelled', String(data.record.status || 'pending')]),
            ].map((value) => ({ value, label: value }))}
          />
        ) : (
          <Field key={field.key}>
            <FieldLabel htmlFor={`correct-${field.key}`}>{field.label}</FieldLabel>
            <Input
              id={`correct-${field.key}`}
              type={field.kind}
              step={field.kind === 'number' ? 'any' : undefined}
              min={field.kind === 'number' && field.key !== 'discounted_percentage' ? 0 : undefined}
              value={form[field.key] == null ? '' : String(form[field.key])}
              disabled={busy}
              onChange={(event) =>
                set(field.key, field.kind === 'number' ? numericInput(event.target.value) : event.target.value || null)
              }
            />
          </Field>
        ),
      )}
    </FieldGroup>
  )
  return (
    <div className="flex min-w-0 flex-col gap-6 font-sans">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            href="/dashboard/purchasing"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Imports
          </Link>
          <h2 className="text-2xl font-bold text-balance">Review & correct import {data.record.index_no || ''}</h2>
          <p className="text-sm text-muted-foreground">
            {data.record.product_name} · {data.record.supplier_name || 'Supplier not recorded'}
          </p>
        </div>
        <Button variant="outline" onClick={reload} disabled={busy}>
          Reload original
        </Button>
      </div>
      <Alert>
        <AlertTitle>This edits an existing China import</AlertTitle>
        <AlertDescription>
          It does not create a new reorder. IDs, index numbers, original upload dates and unrelated values are
          preserved. Physical inventory, selling prices, client orders and deliveries are never updated here.
        </AlertDescription>
      </Alert>
      <PurchaseError error={error} />
      <Card>
        <CardHeader>
          <CardTitle>Product & import details</CardTitle>
          <CardDescription>
            Actual order dates are separate from spreadsheet upload dates. Blank values remain unknown, not zero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary">Inventory: {product?.name || 'Unlinked or inactive product'}</Badge>
              <ProductPicker
                products={catalogue.products}
                disabled={busy}
                onPick={(chosen) => {
                  setForm((current) => ({ ...current, product_id: chosen.id, variant_id: null }))
                  setAccepted(false)
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setForm((current) => ({ ...current, product_id: null, variant_id: null }))
                  setAccepted(false)
                }}
              >
                Clear inventory link
              </Button>
            </div>
            {product && (
              <ExistingVariantPicker
                id="correct-variant"
                product={product}
                value={form.variant_id}
                disabled={busy}
                onChange={(value) => set('variant_id', value)}
              />
            )}
            <FieldDescription>
              The supplier’s original product wording is independent of the inventory link.
            </FieldDescription>
            {fields('details')}
          </div>
        </CardContent>
      </Card>
      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer px-6 py-4 font-medium">Recorded prices & costs</summary>
        <div className="px-6 pb-6">
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Correct the actual amounts from the source document. Totals are not silently recalculated: a details-only
              correction leaves every monetary value exactly as recorded. Keep final landed amounts blank while freight
              is still an estimate.
            </p>
            {fields('pricing')}
          </div>
        </div>
      </details>
      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer px-6 py-4 font-medium">Logistics & source references</summary>
        <div className="px-6 pb-6">{fields('logistics')}</div>
      </details>
      <Card>
        <CardHeader>
          <CardTitle>Review changes before saving</CardTitle>
          <CardDescription>
            {Object.keys(patch).length} changed field(s). Only these values will be corrected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-5">
            {Object.keys(patch).length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Before</TableHead>
                    <TableHead>After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(patch).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell>{label(key)}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal break-words">{show(data.record[key])}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal break-words">{show(value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {impact.length > 0 && (
              <Alert>
                <AlertTitle>Downstream effects to review</AlertTitle>
                <AlertDescription>
                  {impact.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="correction-reason">Why is this import being corrected?</FieldLabel>
              <Textarea
                id="correction-reason"
                value={reason}
                disabled={busy}
                onChange={(e) => {
                  setReason(e.target.value)
                  setAccepted(false)
                }}
                placeholder="Describe the source document or mistake being corrected."
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="accept-correction"
                checked={accepted}
                disabled={busy || !Object.keys(patch).length}
                onCheckedChange={(value) => setAccepted(value === true)}
              />
              <FieldLabel htmlFor="accept-correction">
                I reviewed the before/after values and any cost or incoming-stock effects.
              </FieldLabel>
            </Field>
            <div>
              <Button
                onClick={save}
                disabled={busy || !accepted || reason.trim().length < 5 || !Object.keys(patch).length}
              >
                {busy && <Loader2 className="animate-spin" />}Save audited correction
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <PurchaseAudit events={data.events} />
      {data.events
        .filter((event) => event.eventType === 'correction')
        .map((event) => (
          <details key={event.id} className="rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm">
              Changed values · {new Date(event.createdAt).toLocaleString('en-GB', { timeZone: 'Indian/Mauritius' })}
            </summary>
            <div className="px-4 pb-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Before</TableHead>
                    <TableHead>After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(
                    importCorrectionPatch(event.beforeSnapshot as ImportRecord, event.afterSnapshot as ImportRecord),
                  ).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell>{label(key)}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal break-words">
                        {show((event.beforeSnapshot as ImportRecord)[key])}
                      </TableCell>
                      <TableCell className="max-w-80 whitespace-normal break-words">{show(value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        ))}
    </div>
  )
}
