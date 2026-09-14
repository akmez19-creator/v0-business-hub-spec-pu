'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ProductPicker } from '@/components/local-purchasing/product-picker'
import { saveReorderItemAction } from '@/app/dashboard/purchasing/reorders/actions'
import { newReorderLine, type SavedReorderItem, type ReorderLine } from '@/lib/purchase-orders/workflow'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { clearSupplierReference } from '@/lib/purchase-orders/reorder-reference'
import { ReorderLineEditor } from './reorder-line-editor'
import { PurchaseError, PurchaseSelect, usePurchaseRequestKey } from './reorder-fields'

export function ReorderLaterDialog({
  open,
  onOpenChange,
  catalogue,
  initial,
  productId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  catalogue: ReorderCatalogue
  initial?: SavedReorderItem | null
  productId?: string | null
  onSaved: () => void
}) {
  const [id, setId] = useState('')
  const [line, setLine] = useState<ReorderLine | null>(null)
  const [supplier, setSupplier] = useState('')
  const [priority, setPriority] = useState(2)
  const [status, setStatus] = useState<SavedReorderItem['status']>('active')
  const [reviewDate, setReviewDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyFor = usePurchaseRequestKey()
  useEffect(() => {
    if (!open) return
    const product = catalogue.products.find((item) => item.id === productId)
    setId(initial?.id || crypto.randomUUID())
    setLine(initial?.item ?? (product ? newReorderLine(product) : null))
    setSupplier(initial?.supplierName || '')
    setPriority(initial?.priority || 2)
    setStatus(initial?.status || 'active')
    setReviewDate(initial?.reviewDate || null)
    setError(null)
  }, [open])
  async function save() {
    if (!line) {
      setError('Choose a catalogue product.')
      return
    }
    const input = {
      id,
      revision: initial?.revision || 0,
      item: line,
      supplierName: supplier,
      status,
      priority,
      reviewDate,
    }
    setBusy(true)
    setError(null)
    try {
      await saveReorderItemAction({ ...input, requestKey: keyFor(input) })
      toast.success('Saved to your reorder list')
      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this item.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit saved product' : 'Reorder later'}</DialogTitle>
          <DialogDescription>
            A persistent buying list, independent of customer orders and delivery schedules.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5">
            <ProductPicker
              products={catalogue.products}
              disabled={busy}
              onPick={(product) => {
                setLine(newReorderLine(product))
                setSupplier('')
              }}
            />
            <FieldGroup className="grid sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="later-supplier">Preferred China supplier</FieldLabel>
                <Input
                  id="later-supplier"
                  list="later-supplier-list"
                  value={supplier}
                  onChange={(e) => {
                    setSupplier(e.target.value)
                    if (line) setLine(clearSupplierReference(line))
                  }}
                  disabled={busy}
                />
                <datalist id="later-supplier-list">
                  {catalogue.suppliers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <FieldDescription>
                  Optional. Choose an existing supplier to copy a historical reference below.
                </FieldDescription>
              </Field>
              <PurchaseSelect
                id="later-priority"
                label="Priority"
                value={String(priority)}
                onChange={(value) => setPriority(Number(value))}
                disabled={busy}
                options={[
                  { value: '1', label: 'High' },
                  { value: '2', label: 'Normal' },
                  { value: '3', label: 'Low' },
                ]}
              />
              <PurchaseSelect
                id="later-status"
                label="List status"
                value={status}
                onChange={(value) => setStatus(value as SavedReorderItem['status'])}
                disabled={busy}
                options={[
                  { value: 'active', label: 'Ready to consider' },
                  { value: 'deferred', label: 'Remind me later' },
                  { value: 'excluded', label: 'Excluded from suggestions' },
                ]}
              />
              <Field>
                <FieldLabel htmlFor="later-review">Review date · optional</FieldLabel>
                <Input
                  id="later-review"
                  type="date"
                  value={reviewDate || ''}
                  onChange={(e) => setReviewDate(e.target.value || null)}
                  disabled={busy}
                />
              </Field>
            </FieldGroup>
            {line && (
              <ReorderLineEditor
                line={line}
                product={catalogue.products.find((product) => product.id === line.productId)}
                references={catalogue.references}
                supplierName={supplier}
                onChange={setLine}
                disabled={busy}
              />
            )}
            <PurchaseError error={error} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !line}>
            {busy && <Loader2 className="animate-spin" />}Save for later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
