'use client'

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import type { SkuLink } from '@/lib/purchase-orders/1688-sourcing-types'

export type InventoryVariantDraft = {
  id?: string; attribute_name: string; attribute_value: string; quantity: number | null
  price_override: number | null; sku: string | null; image_url?: string | null; is_active?: boolean | null
  isNew?: boolean; toDelete?: boolean
}
export function InventoryVariantFields({ variants, links, onChange, disabled, loading, error }: {
  variants: InventoryVariantDraft[]; links: SkuLink[]; onChange: (variants: InventoryVariantDraft[]) => void
  disabled: boolean; loading: boolean; error?: string | null
}) {
  const patch = (index: number, change: Partial<InventoryVariantDraft>) => onChange(variants.map((variant, position) => position === index ? { ...variant, ...change } : variant))
  const attributes = ['Model', 'Size', 'Color', 'Capacity', 'Material', 'Style', 'Weight', 'Length', 'Pack']
  return <section aria-label="Inventory product variants" className="rounded-lg border border-border bg-muted/50 p-3 text-foreground"><div className="flex min-w-0 flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Product Variants</h3><Button type="button" size="sm" variant="outline" disabled={disabled || loading || !!error} onClick={() => onChange([...variants, { attribute_name: '', attribute_value: '', quantity: 0, price_override: null, sku: null, image_url: null, isNew: true }])}><Plus data-icon="inline-start" />Add Variant</Button></div>
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading variant photographs and source links…</p> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <div className="max-h-96 overflow-y-auto"><div className="flex flex-col gap-3">{variants.map((variant, index) => {
      if (variant.toDelete) return null
      const sourceLinks = links.filter(link => link.target_kind === 'variant' && link.variant_id === variant.id)
      const label = `${variant.attribute_name}: ${variant.attribute_value}`
      return <div key={variant.id || `new-${index}`} className="rounded-lg border border-border bg-background p-3 text-foreground"><div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-start gap-3"><ImageLightbox src={variant.image_url ?? null} alt={label} className="size-16" /><div className="flex min-w-0 flex-1 flex-col gap-1"><p className="break-words text-sm font-medium">{label || 'New variant'}</p>{variant.is_active === false && <Badge variant="outline">Inactive · unchanged</Badge>}{sourceLinks.map(link => <a key={`${link.offer_id}:${link.sku_key}`} href={`https://detail.1688.com/offer/${link.offer_id}.html`} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary underline-offset-4 hover:underline">1688 {link.offer_id} · {link.sku_key}</a>)}<p className="text-sm text-muted-foreground">The saved photo stays unchanged when editing these fields.</p></div><Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove variant ${label}`} disabled={disabled || sourceLinks.length > 0} title={sourceLinks.length ? 'Confirmed supplier SKU links protect this variant from deletion' : undefined} onClick={() => variant.id && !variant.isNew ? patch(index, { toDelete: true }) : onChange(variants.filter((_, position) => position !== index))}><X data-icon="inline-start" /></Button></div>
        <FieldGroup className="grid grid-cols-2 gap-3"><Field><FieldLabel htmlFor={`variant-attribute-${index}`}>Attribute names</FieldLabel><select id={`variant-attribute-${index}`} className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={variant.attribute_name} disabled={disabled} onChange={event => patch(index, { attribute_name: event.target.value })}><option value="">Select…</option>{variant.attribute_name && !attributes.includes(variant.attribute_name) && <option value={variant.attribute_name}>{variant.attribute_name}</option>}{attributes.map(attribute => <option key={attribute} value={attribute}>{attribute}</option>)}</select></Field><Field><FieldLabel htmlFor={`variant-value-${index}`}>Complete combination</FieldLabel><Input id={`variant-value-${index}`} value={variant.attribute_value} disabled={disabled} onChange={event => patch(index, { attribute_value: event.target.value })} /></Field><Field><FieldLabel htmlFor={`variant-stock-${index}`}>Recorded stock</FieldLabel><Input id={`variant-stock-${index}`} type="number" step={1} value={variant.quantity ?? ''} disabled={disabled} onChange={event => patch(index, { quantity: event.target.value ? Number(event.target.value) : null })} /></Field><Field><FieldLabel htmlFor={`variant-price-${index}`}>Retail price override</FieldLabel><Input id={`variant-price-${index}`} type="number" min={0} value={variant.price_override ?? ''} placeholder="Use parent price" disabled={disabled} onChange={event => patch(index, { price_override: event.target.value ? Number(event.target.value) : null })} /></Field></FieldGroup>
      </div></div>
    })}{!variants.some(variant => !variant.toDelete) && <p className="text-sm text-muted-foreground">No variants yet. Add a complete combination to begin.</p>}</div></div>}
    <p className="text-sm text-muted-foreground">Leave the retail override empty to use the parent price. Total recorded stock: {variants.filter(variant => !variant.toDelete).reduce((sum, variant) => sum + (variant.quantity ?? 0), 0)}. Supplier costs never set retail prices.</p>
  </div></section>
}
