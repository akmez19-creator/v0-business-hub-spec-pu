'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import { ArrowLeft, Check, Download, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProductPicker } from '@/components/local-purchasing/product-picker'
import {
  changeImportReorderAction,
  exportImportReorderAction,
  getImportReorderAction,
  saveReorderItemAction,
} from '@/app/dashboard/purchasing/reorders/actions'
import {
  emptyReorderTerms,
  newReorderLine,
  purchasingToday,
  REORDER_LABELS,
  type ImportPurchaseEvent,
  type ImportReorder,
  type ReorderSnapshot,
} from '@/lib/purchase-orders/workflow'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { clearSupplierReference, copyImportReference } from '@/lib/purchase-orders/reorder-reference'
import { PurchaseError, ReorderTermsFields, ReorderTotals, usePurchaseRequestKey } from './reorder-fields'
import { ReorderLineEditor } from './reorder-line-editor'
import { ReorderFlow } from './reorder-flow'
import { PurchaseAudit, ReorderComparison } from './reorder-review'

const editableSnapshot = (reorder: ImportReorder): ReorderSnapshot =>
  reorder.status === 'awaiting_supplier'
    ? (reorder.supplierSnapshot ?? {
        ...reorder.requestedSnapshot!,
        orderDate: purchasingToday(),
        terms: { ...reorder.requestedSnapshot!.terms, landedReviewed: false },
      })
    : (reorder.confirmedSnapshot ?? reorder.draft)
export function ReorderEditor({
  initial,
  catalogue,
}: {
  initial: { reorder: ImportReorder; events: ImportPurchaseEvent[] }
  catalogue: ReorderCatalogue
}) {
  const { data = initial, mutate } = useSWR(
    `import-reorder:${initial.reorder.id}`,
    () => getImportReorderAction(initial.reorder.id),
    { fallbackData: initial, revalidateOnFocus: false, revalidateOnMount: false },
  )
  const [form, setForm] = useState<ReorderSnapshot>(() => editableSnapshot(initial.reorder))
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [savedLater, setSavedLater] = useState<string[]>([])
  const [supplierChanged, setSupplierChanged] = useState(false)
  const keyFor = usePurchaseRequestKey()
  const reorder = data.reorder
  const response = reorder.status === 'awaiting_supplier'
  const closed = ['confirmed', 'cancelled'].includes(reorder.status)
  const dirty = JSON.stringify(form) !== JSON.stringify(editableSnapshot(reorder))
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const update = (snapshot: ReorderSnapshot) => {
    setForm(snapshot)
    setAccepted(false)
    setError(null)
  }
  async function act(operation: 'save' | 'approve' | 'response' | 'confirm' | 'reopen' | 'cancel') {
    if (busyRef.current) return
    if (['approve', 'confirm'].includes(operation) && dirty) {
      setError('Save and review your current changes before continuing.')
      return
    }
    if (operation === 'confirm' && !accepted) {
      setError('Accept the supplier response before confirming.')
      return
    }
    const input = {
      id: reorder.id,
      revision: reorder.revision,
      ...(['save', 'response'].includes(operation) ? { snapshot: form } : {}),
      ...(operation === 'confirm' ? { accepted: true } : {}),
      ...(operation === 'cancel' ? { reason: cancelReason } : {}),
    }
    const requestKey = keyFor({ operation, input })
    busyRef.current = true
    setBusy(operation)
    setError(null)
    try {
      await changeImportReorderAction(operation, { ...input, requestKey })
      const fresh = await getImportReorderAction(reorder.id)
      await mutate(fresh, false)
      setForm(editableSnapshot(fresh.reorder))
      setAccepted(false)
      setConfirmOpen(false)
      setCancelOpen(false)
      setSupplierChanged(false)
      toast.success(
        operation === 'confirm'
          ? 'Confirmed once. The new records are now in Imports.'
          : operation === 'approve'
            ? 'Buyer request approved. Record the supplier response next.'
            : operation === 'response'
              ? 'Supplier response saved. Review the changes before accepting.'
              : 'Purchasing changes saved',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save. Retry without changing the inputs.')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }
  async function reload() {
    if (dirty && !window.confirm('Discard unsaved edits and reload the saved request?')) return
    try {
      const fresh = await getImportReorderAction(reorder.id)
      await mutate(fresh, false)
      setForm(editableSnapshot(fresh.reorder))
      setAccepted(false)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reload.')
    }
  }
  async function exportRequest() {
    setBusy('export')
    try {
      const result = await exportImportReorderAction(reorder.id)
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(result.rows), 'Supplier request')
      XLSX.writeFile(book, result.name)
      toast.success('Buyer request downloaded. No message has been sent.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the request.')
    } finally {
      setBusy(null)
    }
  }
  async function keepUnavailable(line: ReorderSnapshot['lines'][number]) {
    const input = {
      id: line.id,
      revision: 0,
      item: { ...line, unavailable: false },
      supplierName: form.supplierName,
      status: 'active' as const,
      priority: 2,
      reviewDate: null,
    }
    setBusy(`later:${line.id}`)
    try {
      await saveReorderItemAction({ ...input, requestKey: keyFor(input) })
      setSavedLater((ids) => [...ids, line.id])
      toast.success('Unavailable product kept in Reorder later')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save for later.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 font-sans">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Link
            href="/dashboard/purchasing/reorders"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Reorders
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">{reorder.number}</h2>
            <Badge variant={reorder.status === 'confirmed' ? 'default' : 'secondary'}>
              {REORDER_LABELS[reorder.status]}
            </Badge>
            {dirty && <Badge variant="outline">Unsaved changes</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Manual China purchasing · revision {reorder.revision} · no client orders or delivery reservations
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={Boolean(busy)} onClick={reload}>
            Reload saved
          </Button>
          {reorder.requestedSnapshot && (
            <Button variant="outline" disabled={Boolean(busy)} onClick={exportRequest}>
              <Download />
              Buyer request
            </Button>
          )}
          {!closed && (
            <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={Boolean(busy)}>
              Cancel draft
            </Button>
          )}
        </div>
      </div>
      <ol className="flex flex-wrap items-center gap-3 text-sm" aria-label="Reorder stages">
        {['Draft', 'Buyer approved', 'Supplier review', 'Imports'].map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <Badge variant={reorder.status === 'confirmed' || (response && index < 2) ? 'default' : 'outline'}>
              {index + 1}
            </Badge>
            <span>{label}</span>
            {index < 3 && (
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      {reorder.status === 'confirmed' && (
        <Alert>
          <Check />
          <AlertTitle>Added to Imports</AlertTitle>
          <AlertDescription>
            <p>
              These are supplier-confirmed imports, not physical stock receipts or payments. Manage further status and
              cost corrections on the import records.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {reorder.confirmedSnapshot?.imports.map((item) => (
                <Link
                  key={item.id}
                  className="text-primary underline"
                  href={`/dashboard/purchasing/imports/${item.id}`}
                >
                  Import {item.index}
                </Link>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {response && (
        <Alert>
          <AlertTitle>Record what the supplier returned</AlertTitle>
          <AlertDescription>
            Your buyer-approved request remains unchanged. Update the supplier’s quantities, prices and freight, mark
            unavailable products, then save and compare before accepting. Nothing is sent automatically.
          </AlertDescription>
        </Alert>
      )}
      {supplierChanged && (
        <Alert>
          <AlertTitle>Supplier changed</AlertTitle>
          <AlertDescription>
            Previous supplier prices, links and shipping assumptions were cleared. Your product selections and manual
            quantities are unchanged.
          </AlertDescription>
        </Alert>
      )}
      <PurchaseError error={error} />
      <FieldGroup className="grid sm:grid-cols-2 xl:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="reorder-supplier">China supplier</FieldLabel>
          <Input
            id="reorder-supplier"
            list="reorder-suppliers"
            value={form.supplierName}
            disabled={closed || response || Boolean(busy)}
            onChange={(e) => {
              update({
                ...form,
                supplierName: e.target.value,
                lines: form.lines.map(clearSupplierReference),
                terms: emptyReorderTerms(),
              })
              setSupplierChanged(true)
            }}
          />
          <datalist id="reorder-suppliers">
            {catalogue.suppliers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <FieldDescription>One supplier per request. Reopen approval before changing the supplier.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="reorder-order-date">
            {response || closed ? 'Actual import order date' : 'Intended order date · optional'}
          </FieldLabel>
          <Input
            id="reorder-order-date"
            type="date"
            value={form.orderDate || ''}
            onChange={(e) => update({ ...form, orderDate: e.target.value || null })}
            disabled={closed || Boolean(busy)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="reorder-expected-date">Expected arrival · optional</FieldLabel>
          <Input
            id="reorder-expected-date"
            type="date"
            value={form.expectedDate || ''}
            onChange={(e) => update({ ...form, expectedDate: e.target.value || null })}
            disabled={closed || Boolean(busy)}
          />
        </Field>
      </FieldGroup>
      {!closed && !response && (
        <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">Build this reorder</h3>
            <p className="text-sm text-muted-foreground">
              Paste your list with quantities, let AI match each line to the catalogue or pick from its suggestions,
              then review the list of interest with expected quantity and cost from your import history before it
              goes into the draft.
            </p>
          </div>
          <ReorderFlow
            products={catalogue.products}
            references={catalogue.references}
            fxRate={form.terms.fxRate}
            disabled={Boolean(busy)}
            existingProductIds={
              new Set(form.lines.map((line) => line.productId).filter((id): id is string => Boolean(id)))
            }
            onAddMany={(items) =>
              update({
                ...form,
                terms: { ...form.terms, landedReviewed: false },
                lines: [
                  ...form.lines,
                  ...items.map((item) => {
                    const line = { ...newReorderLine(item.product), qty: item.qty }
                    // Seed price/freight from the latest own import as an estimate
                    // the supplier confirms; the reference is kept for the audit.
                    return item.reference ? copyImportReference(line, item.reference) : line
                  }),
                ],
              })
            }
          />
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">Or pick a single product from the catalogue</p>
            <ProductPicker
              products={catalogue.products}
              disabled={Boolean(busy)}
              onPick={(product) => update({ ...form, lines: [...form.lines, newReorderLine(product)] })}
            />
          </div>
        </section>
      )}
      {form.lines.length === 0 && (
        <Alert>
          <AlertTitle>No products in this draft yet</AlertTitle>
          <AlertDescription>
            Paste your list above and walk through matching and the list of interest, or pick products one by one.
            You can save incomplete work without creating an import.
          </AlertDescription>
        </Alert>
      )}
      {form.lines.map((line) => (
        <div key={line.id} className="flex flex-col gap-2">
          <ReorderLineEditor
            line={line}
            product={catalogue.products.find((product) => product.id === line.productId)}
            supplierName={form.supplierName}
            references={catalogue.references}
            response={response || closed}
            disabled={closed || Boolean(busy)}
            onChange={(next) =>
              update({
                ...form,
                terms: { ...form.terms, landedReviewed: false },
                lines: form.lines.map((item) => (item.id === line.id ? next : item)),
              })
            }
            onRemove={() =>
              update({
                ...form,
                terms: { ...form.terms, landedReviewed: false },
                lines: form.lines.filter((item) => item.id !== line.id),
              })
            }
          />
          {line.unavailable && (
            <div>
              <Button
                variant="outline"
                disabled={Boolean(busy) || savedLater.includes(line.id)}
                onClick={() => keepUnavailable(line)}
              >
                {savedLater.includes(line.id) ? 'Kept in reorder later' : 'Keep unavailable product for later'}
              </Button>
            </div>
          )}
        </div>
      ))}
      <ReorderTermsFields
        terms={form.terms}
        onChange={(terms) => update({ ...form, terms })}
        response={response || reorder.status === 'confirmed'}
        disabled={closed || Boolean(busy)}
      />
      <Field>
        <FieldLabel htmlFor="reorder-notes">Notes to supplier</FieldLabel>
        <Textarea
          id="reorder-notes"
          value={form.notes}
          onChange={(e) => update({ ...form, notes: e.target.value })}
          disabled={closed || Boolean(busy)}
        />
      </Field>
      <ReorderTotals snapshot={form} />
      {reorder.requestedSnapshot && response && (
        <ReorderComparison requested={reorder.requestedSnapshot} response={form} />
      )}
      {!closed && (
        <div className="sticky bottom-0 rounded-lg border border-border bg-background text-foreground shadow-sm">
          <div className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {response
                    ? 'Save the supplier response before accepting it'
                    : 'Save your draft before buyer approval'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {response
                    ? 'Confirmation creates incoming import records only.'
                    : 'Saving does not purchase, pay, reserve or receive stock.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {response && (
                  <Button
                    variant="ghost"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Reopen this request? The existing approved terms stay in history, but a new buyer approval will be required.',
                        )
                      )
                        void act('reopen')
                    }}
                  >
                    Reopen buyer request
                  </Button>
                )}
                <Button variant="outline" disabled={Boolean(busy)} onClick={() => act(response ? 'response' : 'save')}>
                  {busy === (response ? 'response' : 'save') ? <Loader2 className="animate-spin" /> : <Save />}
                  {response ? 'Save supplier response' : 'Save draft'}
                </Button>
                {response ? (
                  <Button
                    disabled={Boolean(busy) || dirty || !reorder.supplierSnapshot}
                    onClick={() => {
                      setAccepted(false)
                      setConfirmOpen(true)
                    }}
                  >
                    <Check />
                    Review & confirm imports
                  </Button>
                ) : (
                  <Button disabled={Boolean(busy) || dirty || !form.lines.length} onClick={() => act('approve')}>
                    {busy === 'approve' && <Loader2 className="animate-spin" />}Approve buyer request
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <PurchaseAudit events={data.events} />
      <Dialog open={confirmOpen} onOpenChange={busy ? undefined : setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept supplier response & confirm?</DialogTitle>
            <DialogDescription>
              This creates {form.lines.filter((line) => !line.unavailable).length} new import record(s) in Ordered
              status. Incoming/China totals will reflect them. Physical stock, selling prices, payments and customer
              deliveries stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <Field orientation="horizontal">
            <Checkbox
              id="accept-supplier-response"
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
              disabled={Boolean(busy)}
            />
            <FieldLabel htmlFor="accept-supplier-response">
              I reviewed and accept the supplier’s current quantities, prices and shipping terms.
            </FieldLabel>
          </Field>
          <PurchaseError error={error} />
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => setConfirmOpen(false)}>
              Back to review
            </Button>
            <Button disabled={!accepted || Boolean(busy) || dirty} onClick={() => act('confirm')}>
              {busy === 'confirm' && <Loader2 className="animate-spin" />}Confirm imports once
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cancelOpen} onOpenChange={busy ? undefined : setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this reorder draft?</DialogTitle>
            <DialogDescription>
              The request and its approval history are retained. This does not cancel an existing confirmed import.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="cancel-reorder-reason">Reason</FieldLabel>
            <Textarea
              id="cancel-reorder-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              disabled={Boolean(busy)}
            />
          </Field>
          <PurchaseError error={error} />
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => setCancelOpen(false)}>
              Keep draft
            </Button>
            <Button
              variant="destructive"
              disabled={Boolean(busy) || cancelReason.trim().length < 3}
              onClick={() => act('cancel')}
            >
              Cancel draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
