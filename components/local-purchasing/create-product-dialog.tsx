'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Plus, Link2, AlertTriangle, Sparkles } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { ProductThumb } from '@/components/ui/product-thumb'
import { ProductPhotoField, NameSuggestions, type PhotoReading } from '@/components/products/product-photo-field'
import { createProductForLineAction, houseNameForNewProductAction } from '@/app/dashboard/purchasing/local/actions'
import { MATCH_CONFIDENCE_FLOOR } from '@/lib/product-match'
import { PRODUCT_CATEGORIES, UNCATEGORISED } from '@/lib/products/categories'
import type { HouseNameResult } from '@/lib/products/house-name'
import { ProductPricingFields } from '@/components/products/product-pricing-fields'
import { NewProductVariantsFields } from '@/components/products/new-product-variants-fields'
import { FieldDescription, FieldGroup } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { createPricingDraft, createVariantsDraft, validateNewProductPricing, type PricingProduct } from '@/lib/products/pricing'
import type { PurchaseUnitAmounts } from '@/lib/local-purchasing/vat'
import { SupplierUnitCost } from './supplier-unit-cost'

export type CreateProductRequest = {
  /** The purchase line this product is for - handed back on completion. */
  lineKey: string
  /** The supplier's wording, used as the starting name. */
  supplierLabel: string
  supplierCode: string | null
}

export type CreateProductOutcome =
  | { kind: 'created'; productId: string; name: string; product: PricingProduct }
  | { kind: 'reused'; productId: string; name: string; product: PricingProduct; reason: string }
  | { kind: 'linked'; productId: string; name: string }

/**
 * "Create X in inventory" with a picture and a second opinion.
 *
 * The one-click version of this button is exactly how the catalogue grew its
 * duplicate rows: it took the supplier's wording ("tile glue") as the product
 * name, with no photo and no check beyond spelling. This dialog does what the
 * inventory Add Product dialog does (take a picture) and what Stock Count does
 * (read it) in one place:
 *
 *  - the photo proposes names - the supplier's label is the STARTING name, not
 *    the final one, because "tile glue" on an invoice is often "Caulking Glue"
 *    on the shelf;
 *  - the photo is compared against catalogue PHOTOS, which is the only
 *    duplicate check available to a name the catalogue has never seen. A
 *    confident visual match is offered as "link to this instead" - the same
 *    outcome as picking it from the catalogue, learned as an alias.
 *
 * Nothing is created until Create is pressed, and a match is an offer, never
 * an automatic link: the reader is right often, not always, and a wrong link
 * here mis-prices a real comparison.
 */
export function CreateProductDialog({
  request,
  unitAmounts,
  costChecking,
  requiresCurrentCost,
  onRecheck,
  onOpenChange,
  onDone,
}: {
  request: CreateProductRequest | null
  unitAmounts: PurchaseUnitAmounts | null
  costChecking: boolean
  requiresCurrentCost: boolean
  onRecheck: () => void
  onOpenChange: (open: boolean) => void
  onDone: (lineKey: string, outcome: CreateProductOutcome) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [reading, setReading] = useState<PhotoReading | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  /** The house name: two words in the shop's own vocabulary, plus a category. */
  const [house, setHouse] = useState<HouseNameResult | null>(null)
  const [naming, setNaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pricing, setPricing] = useState(createPricingDraft)
  const [variants, setVariants] = useState(createVariantsDraft)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [pricingAttempted, setPricingAttempted] = useState(false)
  const [pending, startTransition] = useTransition()
  const submitting = useRef(false)
  const uploadInFlight = useRef(false)
  const [uploading, setUploading] = useState(false)
  const pricingRef = useRef<HTMLDivElement>(null)
  // Which photo the running naming call is for, so a slow answer for a
  // replaced photo cannot land on the new one.
  const namingFor = useRef<string | null>(null)

  // Fresh form per line. Keyed on the request so reopening for a different
  // line never shows the previous line's photo or suggestions.
  useEffect(() => {
    setName(request?.supplierLabel ?? '')
    setCategory('')
    setImageUrl('')
    setReading(null)
    setReadError(null)
    setHouse(null)
    setNaming(false)
    namingFor.current = null
    setError(null)
    setPricing(createPricingDraft())
    setVariants(createVariantsDraft())
    setRequestId(crypto.randomUUID())
    setPricingAttempted(false)
  }, [request?.lineKey, request?.supplierLabel])

  /**
   * Asks for the house name as soon as there is a photo to name.
   *
   * The owner's rule: the name should come from the same logic that renamed
   * the whole catalogue - the AI looks at the picture AND at every product
   * name the shop already uses, and answers in two words. The category comes
   * back from the same look. This runs when the photo LANDS, like the reader
   * does - never on open, and never behind a button, because a suggestion
   * that waits for a click is a suggestion nobody sees.
   *
   * The name field is only filled when it still holds the supplier's wording
   * (or nothing). A name the buyer has typed is theirs; the suggestion sits
   * beside it as a chip they can take.
   */
  const supplierLabel = request?.supplierLabel ?? ''
  useEffect(() => () => { namingFor.current = null }, [])
  const changePhoto = (url: string) => {
    setImageUrl(url)
    setReading(null)
    setReadError(null)
    setHouse(null)
    namingFor.current = url || null
    setNaming(!!url)
    if (!url) return
    void houseNameForNewProductAction({ imageUrl: url, currentName: supplierLabel })
      .then((result) => {
        if (namingFor.current !== url) return
        setHouse(result)
        if (result) {
          setName((current) => {
            const c = current.trim()
            return !c || c === supplierLabel.trim() ? result.name : current
          })
          if (result.category) setCategory((current) => current || result.category!)
        }
      })
      .catch(() => { if (namingFor.current === url) setReadError('Name suggestions are unavailable. You can enter a name yourself.') })
      .finally(() => {
        if (namingFor.current === url) setNaming(false)
      })
  }

  const open = request !== null
  const matches = (reading?.matches ?? []).filter((m) => m.confidence >= MATCH_CONFIDENCE_FLOOR)
  // What the identifier called the object, minus the house name - so the chips
  // never show the same words twice, and the house name is visibly first.
  const otherNames = (reading?.names ?? []).filter((n) => n.trim().toLowerCase() !== house?.name.toLowerCase())
  const pricingValidation = validateNewProductPricing(pricing, variants)
  const visibleError = error ?? (pricingAttempted && !pricingValidation.ok ? pricingValidation.issues[0].message : null)

  const create = () => {
    if (!request || submitting.current || uploadInFlight.current || costChecking) return
    if (requiresCurrentCost && !unitAmounts) {
      setError('Recheck the supplier purchase price before creating this product.')
      return
    }
    const trimmed = name.trim()
    if (!trimmed) {
      setError('A product name is required')
      return
    }
    setPricingAttempted(true)
    const checkedPricing = validateNewProductPricing(pricing, variants)
    if (!checkedPricing.ok) {
      setError(null)
      requestAnimationFrame(() => {
        const invalid = pricingRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
        if (invalid) invalid.focus()
        else pricingRef.current?.scrollIntoView({ block: 'nearest' })
      })
      return
    }
    setError(null)
    submitting.current = true
    startTransition(async () => {
      try {
        const res = await createProductForLineAction({
          name: trimmed,
          category: category || null,
          supplierCode: request.supplierCode,
          unitCostNet: unitAmounts?.unitPriceNet ?? null,
          imageUrl: imageUrl || null,
          pricing,
          variants,
          requestId,
        })
        onDone(
          request.lineKey,
          res.created
            ? { kind: 'created', productId: res.productId, name: res.name, product: res.product }
            : { kind: 'reused', productId: res.productId, name: res.name, product: res.product, reason: res.reusedReason ?? `Linked to the existing "${res.name}" without changing its prices` },
        )
        onOpenChange(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create the product')
      } finally {
        submitting.current = false
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting.current && !uploadInFlight.current) onOpenChange(next) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-xl" showCloseButton={!pending && !uploading}>
        <div className="shrink-0 px-6 pt-6">
        <DialogHeader>
          <DialogTitle>Create in inventory</DialogTitle>
          <DialogDescription className="text-pretty">
            The supplier wrote &ldquo;{request?.supplierLabel}&rdquo;. Add a photo so the
            catalogue can recognise this product next time, and check it is not already there
            under another name.
          </DialogDescription>
        </DialogHeader>
        </div>

        {/* min-w-0 keeps long supplier names from widening the dialog. */}
        <div className="min-h-0 min-w-0 overflow-y-auto px-6">
        <FieldGroup className="gap-5">
          <ProductPhotoField
            imageUrl={imageUrl}
            onImageChange={changePhoto}
            onUploadStateChange={(active) => { uploadInFlight.current = active; setUploading(active) }}
            disabled={pending}
            onReading={(r, err) => {
              setReading(r)
              setReadError(err ?? null)
              // The identifier's label ("air fryer silicone pot") is what the
              // object IS; the house name ("Silicone Pot") is what the shop
              // CALLS it, and that is the one that fills the field. The label
              // only steps in when the house name has not arrived and the
              // field still holds the supplier's wording - and never over a
              // name the buyer typed.
              if (r?.names[0] && !house && !naming) {
                setName((current) => {
                  const c = current.trim()
                  return !c || c === request?.supplierLabel.trim() ? r.names[0] : current
                })
              }
            }}
          />

          {matches.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                This photo looks like something already in the catalogue
              </p>
              <ul className="flex flex-col gap-1.5">
                {matches.slice(0, 3).map((m) => (
                  <li key={m.product_id} className="flex items-center gap-3 rounded-md border border-border bg-background p-2">
                    <ProductThumb src={m.image_url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {Math.round(m.confidence * 100)}%{m.visually_compared ? ' visual match' : ' by name only'} &middot; {m.reason}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 shrink-0 text-xs"
                      disabled={pending || uploading}
                      onClick={() => {
                        if (!request || uploadInFlight.current) return
                        onDone(request.lineKey, { kind: 'linked', productId: m.product_id, name: m.name })
                        onOpenChange(false)
                      }}
                    >
                      <Link2 className="mr-1 h-3 w-3" />
                      Link to this instead
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-product-name">Product name</Label>
            <Input
              id="create-product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              placeholder="e.g. Caulking Glue"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault()
                  create()
                }
              }}
            />
            {/* The house name: the shop's own two words for this thing, named
                against every product already in the system. Shown as the first
                chip with its reason, so the buyer can see WHY before taking it. */}
            {naming && (
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Naming it the way the catalogue does...
              </p>
            )}
            {house && !naming && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" /> House name:
                </span>
                <button
                  type="button"
                  onClick={() => setName(house.name)}
                  className={
                    name.trim().toLowerCase() === house.name.toLowerCase()
                      ? 'inline-flex items-center rounded-md border border-primary bg-primary/10 px-2 py-0.5 text-xs font-medium text-foreground'
                      : 'inline-flex items-center rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent'
                  }
                >
                  {house.name}
                </button>
                {house.reason && <span className="text-xs text-muted-foreground">&mdash; {house.reason}</span>}
              </div>
            )}
            {reading && otherNames.length > 0 && (
              <NameSuggestions names={otherNames} current={name} onPick={setName} />
            )}
            {readError && (
              <p className="text-xs text-muted-foreground">
                The photo was saved but could not be read ({readError}). You can still create with the name above.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="create-product-category">Category</Label>
            <select
              id="create-product-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={pending}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">{UNCATEGORISED}</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {house && !naming && (
              <p className="text-xs text-muted-foreground">
                {house.category
                  ? category === house.category
                    ? `Filed under ${house.category}, like the similar products already in the catalogue.`
                    : `The photo suggested ${house.category}.`
                  : 'Nothing in the category list fits this photo - choose one or leave it uncategorised.'}
              </p>
            )}
            {request?.supplierCode && (
              <p className="text-xs text-muted-foreground">
                Supplier code {request.supplierCode} will be kept as the SKU.
              </p>
            )}
          </div>

          <Separator />
          <div ref={pricingRef} className="flex min-w-0 flex-col gap-3">
            <SupplierUnitCost amounts={unitAmounts} checking={costChecking} />
            {!unitAmounts && !costChecking && requiresCurrentCost && (
              <Button type="button" size="sm" variant="outline" className="self-start" onClick={onRecheck}>Recheck purchase price</Button>
            )}
            <FieldDescription>
              {variants.enabled
                ? 'The supplier cost stays on this receipt, not on the parent product for every size. Enter customer selling prices separately below.'
                : 'The new product’s cost uses the net amount, excluding VAT. Customer selling prices are separate and do not change the receipt or its VAT.'}
            </FieldDescription>
            <NewProductVariantsFields
              value={variants}
              onChange={setVariants}
              pricing={pricing}
              disabled={pending}
              requirePricing
              showErrors={pricingAttempted}
            />
            {variants.enabled && <FieldDescription>After creating, choose the purchased variant on each receipt row. Other rows will not inherit a size automatically.</FieldDescription>}
            <Separator />
            <ProductPricingFields
              value={pricing}
              onChange={setPricing}
              disabled={pending}
              requirePricing={!variants.enabled}
              showErrors={pricingAttempted}
              variantDefaults={variants.enabled}
            />
          </div>
        </FieldGroup>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4">
        <FieldGroup className="gap-3">
        {visibleError && <p role="alert" className="text-sm text-destructive">{visibleError}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending || uploading}>
            Cancel
          </Button>
          <Button type="button" className="min-w-0" onClick={create} disabled={pending || uploading || costChecking || (requiresCurrentCost && !unitAmounts) || !name.trim()}>
            {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}
            <span className="truncate">Create &ldquo;{name.trim() || 'product'}&rdquo;</span>
          </Button>
        </DialogFooter>
        </FieldGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
