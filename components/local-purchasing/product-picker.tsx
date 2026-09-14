'use client'

/**
 * The whole catalogue, searchable, for one purchase line.
 *
 * This is the list the PO import has always had ("Select product..." beside
 * every unmatched name) and this screen did not. Without it a line whose right
 * product is not among the ranked guesses had exactly two options - create a
 * duplicate product, or save unlinked - and neither is what the buyer wants
 * when the product plainly exists.
 *
 * Same Popover + Command shape as `reconcile-mapping.tsx`, so it behaves like
 * every other picker in the app. Filtering matches every typed word anywhere in
 * the name, so "robot sweep" finds "Sweeping Robot" - inventory names and
 * supplier wording rarely share word order.
 */

import { useMemo, useState } from 'react'
import { ChevronsUpDown, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { ProductThumb } from '@/components/ui/product-thumb'
import { cn } from '@/lib/utils'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatSellingPrice, variantDescription, variantSelectionError, variantSellingPrice, type PricingProduct, type VariantSource } from '@/lib/products/pricing'

export type PickableProduct = PricingProduct

export function ExistingVariantPicker({ product, value, source, id, disabled, onChange, onRefresh, loading = false, loadError = false }: {
  product?: PricingProduct
  value?: string | null
  source?: VariantSource | null
  id: string
  disabled?: boolean
  onChange: (variantId: string | null) => void
  onRefresh?: () => void
  loading?: boolean
  loadError?: boolean
}) {
  if (product?.variants?.length === 0 && !product.pricing.has_variants && !value) return null
  const variants = product?.variants?.filter((variant) => variant.isActive) ?? []
  const selected = variants.find((variant) => variant.id === value)
  const error = variantSelectionError(product, value)
  const unavailable = !product?.variants || loadError
  const price = selected && product ? variantSellingPrice(product, selected) : null
  const label = variants.length && new Set(variants.map((variant) => variant.attributeName)).size === 1 ? variants[0].attributeName : 'Variant'
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value || 'unspecified'} onValueChange={(next) => onChange(next === 'unspecified' ? null : next)} disabled={disabled}>
        <SelectTrigger id={id} aria-label={`${label} for ${product?.name ?? 'linked product'}`} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint`} className="w-full sm:max-w-sm">
          <SelectValue placeholder="Variant not specified" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            <SelectItem value="unspecified">Variant not specified</SelectItem>
            {value && !selected && <SelectItem value={value} disabled>Selected variant unavailable</SelectItem>}
            {variants.map((variant) => {
              const selling = product ? variantSellingPrice(product, variant) : null
              return <SelectItem key={variant.id} value={variant.id} disabled={loadError}>
                {`${label === 'Variant' ? variantDescription(variant) : variant.attributeValue} — ${selling == null ? 'Selling price not set' : formatSellingPrice(selling)}`}
              </SelectItem>
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription id={`${id}-hint`}>
        {unavailable ? 'Variant details could not be loaded. Refresh to choose from Inventory.' : selected
          ? `${price == null ? 'Selling price not set' : `Selling price: ${formatSellingPrice(price)} / unit`}. Recorded stock: ${selected.stockOnHand ?? 'unknown'}.${source === 'supplier' ? ' Restored from this supplier’s saved item.' : source === 'order' ? ' From the issued order.' : ''}`
          : variants.length ? 'Optional: choose the purchased variant, or record it as unspecified.' : 'No active variants. This purchase can remain unspecified.'}
        {' Manage this product’s variants in Inventory. Supplier figures are unchanged.'}
      </FieldDescription>
      {error && <FieldError>{error}</FieldError>}
      {onRefresh && <div><Button type="button" variant="ghost" size="sm" disabled={disabled || loading} onClick={onRefresh}>{loading ? 'Refreshing variants…' : 'Refresh variants'}</Button></div>}
    </Field>
  )
}

export function ProductPicker({
  products,
  onPick,
  disabled,
  className,
}: {
  products: PickableProduct[]
  onPick: (product: PickableProduct) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)

  // Lower-cased once, not on every keystroke for every one of ~580 rows.
  const searchable = useMemo(
    () => new Map(products.map((p) => [p.id, p.name.toLowerCase()])),
    [products],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || products.length === 0}
          className={cn('h-7 px-2.5 text-xs font-normal', className)}
        >
          <List className="mr-1.5 h-3 w-3" />
          Pick from catalogue
          <span className="ml-1.5 text-muted-foreground">({products.length})</span>
          <ChevronsUpDown className="ml-1.5 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command
          filter={(value, search) => {
            const name = searchable.get(value)
            if (!name) return 0
            const words = search.toLowerCase().split(/\s+/).filter(Boolean)
            return words.every((w) => name.includes(w)) ? 1 : 0
          }}
        >
          <CommandInput placeholder="Type any part of the product name…" className="h-9" />
          <CommandList className="max-h-80">
            <CommandEmpty>No product with those words. Try fewer, or create it.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.id}
                  onSelect={() => {
                    onPick(p)
                    setOpen(false)
                  }}
                  className="gap-3 text-xs"
                >
                  <ProductThumb
                    src={p.imageUrl}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded"
                    fallback={
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    stock {p.stockOnHand ?? '-'}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
