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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ProductPicker } from '@/components/local-purchasing/product-picker'
import { saveReorderSettingsAction } from '@/app/dashboard/purchasing/reorders/actions'
import type { ReorderSettings } from '@/lib/purchase-orders/workflow'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { PurchaseError, PurchaseNumberField, PurchaseSelect, usePurchaseRequestKey } from './reorder-fields'

const blank = (productId: string | null = null, supplierName: string | null = null): ReorderSettings => ({
  id: crypto.randomUUID(),
  productId,
  supplierName,
  leadDays: null,
  coverDays: null,
  bufferDays: null,
  dailyUnits: null,
  quantityMultiple: null,
  revision: 0,
})
export function ReorderSettingsDialog({
  open,
  onOpenChange,
  catalogue,
  settings,
  productId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  catalogue: ReorderCatalogue
  settings: ReorderSettings[]
  productId?: string | null
  onSaved: () => void
}) {
  const [scope, setScope] = useState('global')
  const [form, setForm] = useState<ReorderSettings | null>(null)
  const [supplier, setSupplier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyFor = usePurchaseRequestKey()
  const choose = (p: string | null, s: string | null) => {
    setForm(settings.find((row) => row.productId === p && row.supplierName === s) ?? blank(p, s))
    setError(null)
  }
  useEffect(() => {
    if (!open) return
    setScope(productId ? 'product' : 'global')
    setSupplier('')
    choose(productId || null, null)
  }, [open])
  async function save() {
    if (!form) return
    setBusy(true)
    setError(null)
    try {
      if (scope === 'product' && !form.productId) throw new Error('Choose a product for these assumptions.')
      if (scope === 'supplier' && !form.supplierName) throw new Error('Enter the supplier name.')
      await saveReorderSettingsAction({ ...form, requestKey: keyFor(form) })
      toast.success('Planning assumptions saved. Your manual quantities are unchanged.')
      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save planning settings.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Planning assumptions</DialogTitle>
          <DialogDescription>
            Optional guidance only. Nothing is read from client orders or deliveries. Dates from old spreadsheet uploads
            are not used to guess lead time.
          </DialogDescription>
        </DialogHeader>
        {form && (
          <FieldGroup>
            <PurchaseSelect
              id="planning-scope"
              label="Apply to"
              value={scope}
              disabled={busy}
              onChange={(value) => {
                setScope(value)
                setSupplier('')
                choose(null, null)
                if (value !== 'global') setForm(blank())
              }}
              options={[
                { value: 'global', label: 'Default import lead time and coverage' },
                { value: 'supplier', label: 'One China supplier' },
                { value: 'product', label: 'One catalogue product' },
              ]}
            />
            {scope === 'product' && (
              <div className="flex flex-col gap-2">
                <ProductPicker
                  products={catalogue.products}
                  disabled={busy}
                  onPick={(product) => choose(product.id, null)}
                />
                {form.productId && (
                  <p className="font-medium">
                    {catalogue.products.find((product) => product.id === form.productId)?.name}
                  </p>
                )}
              </div>
            )}
            {scope === 'supplier' && (
              <Field>
                <FieldLabel htmlFor="planning-supplier">China supplier</FieldLabel>
                <Input
                  id="planning-supplier"
                  list="planning-suppliers"
                  value={supplier}
                  disabled={busy}
                  onChange={(e) => {
                    setSupplier(e.target.value)
                    choose(null, e.target.value.trim() || null)
                  }}
                />
                <datalist id="planning-suppliers">
                  {catalogue.suppliers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
            )}
            <FieldGroup className="grid sm:grid-cols-3">
              <PurchaseNumberField
                id="planning-lead"
                label="Order-to-arrival · days"
                value={form.leadDays}
                whole
                disabled={busy}
                onChange={(value) => setForm({ ...form, leadDays: value })}
              />
              <PurchaseNumberField
                id="planning-cover"
                label="Cover after arrival · days"
                value={form.coverDays}
                whole
                disabled={busy}
                onChange={(value) => setForm({ ...form, coverDays: value })}
              />
              <PurchaseNumberField
                id="planning-buffer"
                label="Safety buffer · days"
                value={form.bufferDays}
                whole
                disabled={busy}
                onChange={(value) => setForm({ ...form, bufferDays: value })}
              />
            </FieldGroup>
            {scope === 'product' && (
              <FieldGroup className="grid sm:grid-cols-2">
                <PurchaseNumberField
                  id="planning-daily"
                  label="Your planning rate · units per day"
                  value={form.dailyUnits}
                  disabled={busy}
                  onChange={(value) => setForm({ ...form, dailyUnits: value })}
                  hint="Manually entered, not calculated from customer deliveries."
                />
                <PurchaseNumberField
                  id="planning-multiple"
                  label="Verified carton/MOQ multiple · units"
                  value={form.quantityMultiple}
                  whole
                  disabled={busy}
                  onChange={(value) => setForm({ ...form, quantityMultiple: value })}
                  hint="Optional. Only use an actual supplier requirement."
                />
              </FieldGroup>
            )}
            <FieldDescription>
              Blank overrides inherit the defaults. A quantity suggestion requires all day settings, your product
              planning rate and a known recorded stock quantity. It never replaces a quantity you entered.
            </FieldDescription>
            <PurchaseError error={error} />
          </FieldGroup>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !form}>
            {busy && <Loader2 className="animate-spin" />}Save assumptions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
