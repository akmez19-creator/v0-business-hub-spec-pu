'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ProductThumb } from '@/components/ui/product-thumb'
import { Badge } from '@/components/ui/badge'
import { ProductPicker } from '@/components/local-purchasing/product-picker'
import { ImportReferencePicker } from './import-reference-picker'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createImportReordersAction, getReorderCatalogueAction } from '@/app/dashboard/purchasing/reorders/actions'
import type { ImportReference, SavedReorderItem } from '@/lib/purchase-orders/workflow'
import type { ReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { PurchaseError, PurchaseNumberField, usePurchaseRequestKey } from './reorder-fields'

type Selection = {
  key: string
  productId: string
  variantId: string | null
  sourceImportId: string | null
  savedItemId: string | null
  qty: number | null
}
export function POEntryDialog({
  open,
  onOpenChange,
  source,
  sources,
  savedItems,
  catalogue: initialCatalogue,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source?: ImportReference | null
  sources?: ImportReference[]
  savedItems?: SavedReorderItem[]
  catalogue?: ReorderCatalogue
  onCreated?: () => void
}) {
  const router = useRouter()
  const {
    data: catalogue,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR(open ? 'import-reorder-catalogue' : null, getReorderCatalogueAction, {
    fallbackData: initialCatalogue,
    revalidateOnFocus: false,
  })
  const [selections, setSelections] = useState<Selection[]>([])
  const [supplierName, setSupplierName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyFor = usePurchaseRequestKey()
  useEffect(() => {
    if (!open) return
    const history = sources ?? (source ? [source] : [])
    setSelections(
      history
        .map<Selection>((row) => ({
          key: crypto.randomUUID(),
          productId: row.product_id || '',
          variantId: row.variant_id || null,
          sourceImportId: row.id,
          savedItemId: null,
          qty: null,
        }))
        .concat(
          (savedItems ?? []).map((item) => ({
            key: crypto.randomUUID(),
            productId: item.item.productId || '',
            variantId: item.item.variantId,
            sourceImportId: item.item.sourceImportId,
            savedItemId: item.id,
            qty: item.item.qty,
          })),
        ),
    )
    setSupplierName('')
    setError(null)
    // Reinitialize only on opening; background catalogue refreshes must not reset manual quantities.
  }, [open])
  const supplierGroups = useMemo(
    () =>
      new Set(
        selections.map((line) => {
          const ref = catalogue?.references.find((row) => row.id === line.sourceImportId)
          // Only an own-product reference fixes the supplier. A cross-product
          // reference is a cost estimate, so it falls back to the typed supplier.
          const ownSupplier = ref && line.productId && ref.product_id === line.productId ? ref.supplier_name?.trim() : ''
          return (
            ownSupplier ||
            savedItems?.find((item) => item.id === line.savedItemId)?.supplierName ||
            supplierName ||
            'Supplier not set'
          )
        }),
      ),
    [selections, catalogue, supplierName, savedItems],
  )
  const setLine = (key: string, patch: Partial<Selection>) =>
    setSelections((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  async function create() {
    setError(null)
    const payload = { supplierName, selections: selections.map(({ key, ...line }) => line) }
    if (selections.some((line) => !line.productId)) {
      setError('Link each selected import to a catalogue product before creating a reorder.')
      return
    }
    setBusy(true)
    try {
      const result = await createImportReordersAction({ ...payload, requestKey: keyFor(payload) })
      toast.success(
        result.requests.length === 1
          ? 'Reorder draft saved'
          : `${result.requests.length} separate supplier drafts saved`,
      )
      onOpenChange(false)
      onCreated?.()
      router.push(
        result.requests.length === 1
          ? `/dashboard/purchasing/reorders/${result.requests[0].id}`
          : '/dashboard/purchasing/reorders',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the draft. Retry without changing the form.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New import reorder</DialogTitle>
          <DialogDescription>
            Choose products and quantities yourself. A draft does not create an import, change stock or link to customer
            deliveries.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5">
            {loadError ? (
              <>
                <PurchaseError error="Could not load the catalogue and import references." />
                <Button variant="outline" onClick={() => mutate()}>
                  Retry loading
                </Button>
              </>
            ) : isLoading && !catalogue ? (
              <p className="text-sm text-muted-foreground">Loading your catalogue…</p>
            ) : (
              catalogue && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <ProductPicker
                      products={catalogue.products}
                      disabled={busy}
                      onPick={(product) =>
                        setSelections((rows) => [
                          ...rows,
                          {
                            key: crypto.randomUUID(),
                            productId: product.id,
                            variantId: null,
                            sourceImportId: null,
                            savedItemId: null,
                            qty: null,
                          },
                        ])
                      }
                    />
                    <Badge variant="secondary">
                      {selections.length} products · {supplierGroups.size || 1} supplier request
                      {supplierGroups.size > 1 ? 's' : ''}
                    </Badge>
                  </div>
                  {selections.length === 0 && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Pick products now, or create an empty draft and add them there. All catalogue products are
                      available, including out-of-stock items.
                    </p>
                  )}
                  {selections.map((line) => {
                    const product = catalogue.products.find((item) => item.id === line.productId)
                    const reference = catalogue.references.find((row) => row.id === line.sourceImportId)
                    const referenceIsEstimate = Boolean(
                      reference && line.productId && reference.product_id !== line.productId,
                    )
                    const variant = product?.variants?.find((item) => item.id === line.variantId)
                    return (
                      <section key={line.key} className="rounded-lg border border-border">
                        <div className="p-4">
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <ProductThumb
                                  src={variant?.imageUrl || product?.imageUrl || reference?.image_url}
                                  className="size-12 shrink-0 rounded-lg"
                                />
                                <div>
                                  <h3 className="font-medium">
                                    {product?.name || reference?.product_name || 'Link this import to a product'}
                                  </h3>
                                  <p className="text-sm text-muted-foreground">
                                    {reference
                                      ? referenceIsEstimate
                                        ? `Estimate from ${reference.product_name || 'another import'}`
                                        : `${reference.supplier_name || 'No supplier on file'} · Previously ${reference.qty ?? 'unknown'} units`
                                      : 'Enter supplier below'}
                                  </p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                onClick={() => setSelections((rows) => rows.filter((row) => row.key !== line.key))}
                                aria-label={`Remove ${product?.name || 'product'}`}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                            {!product && (
                              <ProductPicker
                                products={catalogue.products}
                                onPick={(item) =>
                                  setLine(line.key, { productId: item.id, sourceImportId: null, variantId: null })
                                }
                              />
                            )}
                            <FieldGroup className="grid sm:grid-cols-2">
                              <PurchaseNumberField
                                id={`create-qty-${line.key}`}
                                label="Quantity you want · physical units"
                                value={line.qty}
                                whole
                                onChange={(qty) => setLine(line.key, { qty })}
                                disabled={busy}
                              />
                              <Field>
                                <FieldLabel htmlFor={`create-source-${line.key}`}>Previous China import</FieldLabel>
                                <ImportReferencePicker
                                  id={`create-source-${line.key}`}
                                  references={catalogue.references}
                                  productId={line.productId}
                                  value={line.sourceImportId}
                                  disabled={busy || Boolean(line.savedItemId)}
                                  onSelect={(row) => setLine(line.key, { sourceImportId: row?.id ?? null })}
                                />
                              </Field>
                              {Boolean(product?.variants?.length) && (
                                <Field>
                                  <FieldLabel htmlFor={`create-variant-${line.key}`}>Variant</FieldLabel>
                                  <Select
                                    value={line.variantId || 'none'}
                                    disabled={busy}
                                    onValueChange={(id) => setLine(line.key, { variantId: id === 'none' ? null : id })}
                                  >
                                    <SelectTrigger id={`create-variant-${line.key}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectGroup>
                                        <SelectItem value="none">Not specified</SelectItem>
                                        {product?.variants
                                          ?.filter((item) => item.isActive)
                                          .map((item) => (
                                            <SelectItem key={item.id} value={item.id}>
                                              {item.attributeName}: {item.attributeValue}
                                            </SelectItem>
                                          ))}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                  {line.savedItemId &&
                                    savedItems?.find((item) => item.id === line.savedItemId)?.item.variantId !== line.variantId && (
                                      <FieldDescription>
                                        Changing the saved variant clears its old price, freight and packaging. Your quantity is kept.
                                      </FieldDescription>
                                    )}
                                </Field>
                              )}
                            </FieldGroup>
                          </div>
                        </div>
                      </section>
                    )
                  })}
                  <Field>
                    <FieldLabel htmlFor="new-reorder-supplier">
                      Supplier for products without a historical reference
                    </FieldLabel>
                    <Input
                      id="new-reorder-supplier"
                      list="import-supplier-names"
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      disabled={busy}
                      placeholder="Choose or type a supplier name"
                    />
                    <datalist id="import-supplier-names">
                      {catalogue.suppliers.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <FieldDescription>
                      Can be left blank in a draft. Products from different existing suppliers become separate requests.
                    </FieldDescription>
                  </Field>
                </>
              )
            )}
            <PurchaseError error={error} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !catalogue || Boolean(loadError)}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}Save draft{supplierGroups.size > 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
