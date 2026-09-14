'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ProductPricingFields } from '@/components/products/product-pricing-fields'
import { ProductPhotoField, NameSuggestions, type PhotoReading } from '@/components/products/product-photo-field'
import { SupplierUnitCost } from './supplier-unit-cost'
import { getProductPricingAction, savePurchasingProductAction, houseNameForNewProductAction } from '@/app/dashboard/purchasing/local/actions'
import { PRODUCT_CATEGORIES, UNCATEGORISED } from '@/lib/products/categories'
import { MATCH_CONFIDENCE_FLOOR } from '@/lib/product-match'
import type { HouseNameResult } from '@/lib/products/house-name'
import type { PurchaseUnitAmounts } from '@/lib/local-purchasing/vat'
import {
  createPricingDraft, createProductEditDraft, productEditRevision, pricingDraftChanged,
  pricingStatus, pricingSummary, validateProductEdit, variantSellingPrice, formatSellingPrice,
  type PricingProduct, type ProductEditDraft,
} from '@/lib/products/pricing'

export type ProductPricingRequest = { productId: string; name: string; lineKey: string }

export function ProductPricingStatus({
  product,
  productId,
  productName,
  lineKey,
  variantId,
  onRequest,
}: {
  product?: PricingProduct
  productId: string
  productName: string
  lineKey: string
  variantId?: string | null
  onRequest: (request: ProductPricingRequest) => void
}) {
  const status = pricingStatus(product?.pricing)
  const selected = product?.variants?.find((variant) => variant.id === variantId && variant.isActive)
  const selling = selected && product ? variantSellingPrice(product, selected) : null
  const variantProduct = Boolean(variantId || product?.pricing.has_variants || product?.variants?.length)
  return (
    <div className="border-t border-border/60 px-3 py-2" aria-label={`Selling prices for ${productName}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {variantProduct
            ? selected ? selling == null ? `${selected.attributeValue}: selling price not set` : `Selling: ${formatSellingPrice(selling)} / unit (${selected.attributeValue})`
              : variantId ? 'Selected variant unavailable — choose another or clear it' : 'Select a variant below to see its unit selling price'
            : status === 'priced' && product ? `Selling: ${pricingSummary(product.pricing)}`
              : status === 'unpriced' ? 'Selling price not set' : 'Product details not loaded'}
        </p>
        <Button
          type="button" variant="outline" size="sm"
          aria-label={`Edit product ${productName}`}
          onClick={() => onRequest({ productId, name: productName, lineKey })}
        >
          <Pencil data-icon="inline-start" />
          Edit product
        </Button>
      </div>
    </div>
  )
}

export function ProductPricingDialog({
  request,
  unitAmounts,
  costChecking,
  onClose,
  onProduct,
  onSaved,
}: {
  request: ProductPricingRequest
  unitAmounts: PurchaseUnitAmounts | null
  costChecking: boolean
  onClose: () => void
  onProduct: (product: PricingProduct) => void
  onSaved: (product: PricingProduct) => void
}) {
  const [product, setProduct] = useState<PricingProduct | null>(null)
  const [draft, setDraft] = useState<ProductEditDraft>(() => ({ name: request.name, category: '', imageUrl: '', pricing: createPricingDraft() }))
  const [attempted, setAttempted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reloadSuggested, setReloadSuggested] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState<PhotoReading | null>(null)
  const [readPhotoError, setReadPhotoError] = useState<string | null>(null)
  const [house, setHouse] = useState<HouseNameResult | null>(null)
  const [naming, setNaming] = useState(false)
  const [pending, startTransition] = useTransition()
  const submitting = useRef(false)
  const uploadInFlight = useRef(false)
  const acceptNextRead = useRef(true)
  const photoGeneration = useRef(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => { photoGeneration.current++ }, [])

  const { error: readError, isValidating, mutate: reload } = useSWR(
    ['purchasing-product-pricing', request.productId],
    ([, productId]) => getProductPricingAction(productId),
    {
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 0,
      shouldRetryOnError: false,
      onSuccess: (fresh) => {
        // Only opening or an explicit reload may replace an in-progress draft.
        if (!acceptNextRead.current) return
        acceptNextRead.current = false
        setProduct(fresh)
        setDraft(createProductEditDraft(fresh))
        setAttempted(false)
        setSaveError(null)
        setReloadSuggested(false)
        setReading(null)
        setReadPhotoError(null)
        setHouse(null)
        setNaming(false)
        photoGeneration.current++
        onProduct(fresh)
      },
    },
  )

  const editable = !!product && !readError && !isValidating
  const validation = product ? validateProductEdit(draft, product) : null
  const issues = attempted && validation && !validation.ok ? validation.issues : []
  const issue = (path: string) => issues.find((item) => item.path === path)?.message
  const changedPricing = !!product && pricingDraftChanged(draft.pricing, product.pricing)
  const visibleError = saveError ?? issues[0]?.message
  const hasLegacyCategory = !!product?.category && !PRODUCT_CATEGORIES.some((category) => category === product.category)
  const matches = (reading?.matches ?? []).filter((match) => match.product_id !== request.productId && match.confidence >= MATCH_CONFIDENCE_FLOOR)
  const busy = pending || uploading

  const changePhoto = (imageUrl: string) => {
    setDraft((current) => ({ ...current, imageUrl }))
    setReading(null)
    setReadPhotoError(null)
    setHouse(null)
    const generation = ++photoGeneration.current
    setNaming(false)
    if (!imageUrl || imageUrl === product?.imageUrl) return
    setNaming(true)
    void houseNameForNewProductAction({ imageUrl, currentName: draft.name })
      .then((result) => { if (photoGeneration.current === generation) setHouse(result) })
      .catch(() => { if (photoGeneration.current === generation) setReadPhotoError('Name suggestions are unavailable. Your own name and category are kept.') })
      .finally(() => { if (photoGeneration.current === generation) setNaming(false) })
  }

  const save = () => {
    if (!editable || !product || submitting.current || uploadInFlight.current) return
    setAttempted(true)
    setReloadSuggested(false)
    const result = validateProductEdit(draft, product)
    if (!result.ok) {
      setSaveError(null)
      requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setSaveError(null)
    submitting.current = true
    startTransition(async () => {
      try {
        const saved = await savePurchasingProductAction({
          productId: product.id,
          expectedRevision: productEditRevision(product),
          draft,
        })
        onSaved(saved)
        onClose()
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Could not save the product.')
        setReloadSuggested(true)
      } finally {
        submitting.current = false
      }
    })
  }
  const reloadProduct = () => {
    acceptNextRead.current = true
    void reload().catch(() => {})
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting.current && !uploadInFlight.current) onClose() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-xl" showCloseButton={!busy}>
        <div className="shrink-0 px-6 pt-6">
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
            <DialogDescription>Update {product?.name ?? request.name} in Inventory. This purchase receipt stays unsaved.</DialogDescription>
          </DialogHeader>
        </div>
        <div ref={bodyRef} className="min-h-0 min-w-0 overflow-y-auto px-6">
          <FieldGroup className="gap-5">
            {isValidating && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading current Inventory details…
              </p>
            )}
            {readError && (
              <Alert variant="destructive">
                <AlertTitle>Could not read the product</AlertTitle>
                <AlertDescription>No changes were saved. Your draft is kept; retry to load current Inventory details.</AlertDescription>
              </Alert>
            )}
            {product && (
              <>
                <ProductPhotoField
                  key={productEditRevision(product)}
                  imageUrl={draft.imageUrl}
                  onImageChange={changePhoto}
                  disabled={pending || isValidating}
                  onUploadStateChange={(active) => { uploadInFlight.current = active; setUploading(active) }}
                  hint="Upload, paste or drop a replacement photo. Suggestions never replace your name or category automatically."
                  onReading={(result, error) => { setReading(result); setReadPhotoError(error ?? null) }}
                />
                {issue('imageUrl') && <FieldError>{issue('imageUrl')}</FieldError>}
                {matches.length > 0 && (
                  <Alert>
                    <AlertTitle>Another catalogue product looks similar</AlertTitle>
                    <AlertDescription>
                      <p>{matches.slice(0, 3).map((match) => match.name).join(' · ')}</p>
                      <p>This edits the current product only; it does not merge products or change purchase links.</p>
                    </AlertDescription>
                  </Alert>
                )}
                <Field data-invalid={!!issue('name')}>
                  <FieldLabel htmlFor="edit-product-name">Product name</FieldLabel>
                  <Input
                    id="edit-product-name" value={draft.name} maxLength={200} disabled={!editable || pending}
                    aria-invalid={!!issue('name')} aria-describedby={issue('name') ? 'edit-product-name-error' : undefined}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
                      event.preventDefault()
                      save()
                    }}
                  />
                  {issue('name') && <FieldError id="edit-product-name-error">{issue('name')}</FieldError>}
                  {naming && <FieldDescription>Reading the replacement photo for name suggestions…</FieldDescription>}
                  {!pending && (house || reading) && (
                    <NameSuggestions names={[...(house ? [house.name] : []), ...(reading?.names ?? []).filter((name) => name !== house?.name)]} current={draft.name} onPick={(name) => setDraft((current) => ({ ...current, name }))} />
                  )}
                  {readPhotoError && <FieldDescription>{readPhotoError}</FieldDescription>}
                </Field>
                <Field data-invalid={!!issue('category')}>
                  <FieldLabel htmlFor="edit-product-category">Category</FieldLabel>
                  <Select value={draft.category || '__uncategorised'} onValueChange={(value) => setDraft((current) => ({ ...current, category: value === '__uncategorised' ? '' : value }))} disabled={!editable || pending}>
                    <SelectTrigger id="edit-product-category" className="w-full" aria-invalid={!!issue('category')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__uncategorised">{UNCATEGORISED}</SelectItem>
                        {hasLegacyCategory && <SelectItem value={product.category!}>{product.category} (current)</SelectItem>}
                        {PRODUCT_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {issue('category') && <FieldError>{issue('category')}</FieldError>}
                  {house?.category && house.category !== draft.category && (
                    <Button type="button" variant="outline" size="sm" className="self-start" disabled={pending} onClick={() => setDraft((current) => ({ ...current, category: house.category! }))}>
                      Use suggested category: {house.category}
                    </Button>
                  )}
                </Field>
                <Separator />
                <SupplierUnitCost amounts={unitAmounts} checking={costChecking} />
                <FieldDescription>These are this receipt&apos;s supplier costs, not selling prices. Editing this product does not change its saved cost, stock or the receipt.</FieldDescription>
                <Separator />
                <ProductPricingFields
                  value={draft.pricing}
                  onChange={(update) => setDraft((current) => ({ ...current, pricing: typeof update === 'function' ? update(current.pricing) : update }))}
                  disabled={!editable || pending}
                  requirePricing={changedPricing}
                  showErrors={attempted && changedPricing}
                />
                <FieldDescription>
                  Keep prices untouched to change only the product details. Changed selling prices require a positive unit price or fully priced sets.
                </FieldDescription>
                <FieldDescription>
                  Variant, promotion and legacy special prices stay unchanged. Manage those in{' '}
                  <Link href="/dashboard/deliveries/inventory" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Inventory</Link>.
                </FieldDescription>
              </>
            )}
          </FieldGroup>
        </div>
        <div className="shrink-0 border-t border-border px-6 py-4">
          <FieldGroup className="gap-3">
            {visibleError && (
              <div className="flex flex-col items-start gap-2">
                <p role="alert" className="text-sm text-destructive">{visibleError}</p>
                {reloadSuggested && (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={reloadProduct} disabled={busy || isValidating}>Reload current product</Button>
                    <p className="text-sm text-muted-foreground">Reload replaces your draft with the current Inventory details.</p>
                  </>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              {readError ? (
                <Button type="button" onClick={reloadProduct} disabled={isValidating || busy}>Try again</Button>
              ) : (
                <Button type="button" onClick={save} disabled={!editable || busy}>
                  {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
                  {uploading ? 'Uploading photo…' : 'Save changes'}
                </Button>
              )}
            </DialogFooter>
          </FieldGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
