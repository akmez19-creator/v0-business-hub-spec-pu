import { PRODUCT_CATEGORIES } from '@/lib/products/categories'
import { normalizeName } from '@/lib/products/match'

export type PriceValue = number | string | null

export interface PricingSnapshot {
  price: PriceValue
  bundle_prices: Record<string, PriceValue> | null
  is_b1g1: boolean | null
  price_spx2: PriceValue
  price_spx3: PriceValue
  price_b1g1: PriceValue
  promo_price: PriceValue
  has_variants: boolean | null
  hasVariantPrice: boolean | null
  updated_at: string | null
}

export type VariantSource = 'manual' | 'supplier' | 'order'

export interface VariantSelection {
  variantId?: string | null
  variantSource?: VariantSource | null
  variantCleared?: boolean
}

export interface VariantSnapshot {
  id: string
  attributeName: string
  attributeValue: string
  provenance: VariantSource
  selectedBy: string | null
}

export interface PricingVariant {
  id: string
  productId: string
  attributeName: string
  attributeValue: string
  isActive: boolean
  stockOnHand: number | null
  imageUrl: string | null
  priceOverride: PriceValue
}

export interface PricingProduct {
  id: string
  name: string
  imageUrl: string | null
  category: string | null
  stockOnHand: number | null
  pricing: PricingSnapshot
  /** Undefined means not loaded, not an empty variant list. */
  variants?: PricingVariant[]
}

export const clearedVariant: Required<VariantSelection> = { variantId: null, variantSource: null, variantCleared: false }

export function recordedVariantId(line: { variantId?: string | null; variantSnapshot?: VariantSnapshot | null }): string | null {
  return line.variantId || line.variantSnapshot?.id || null
}

export function variantDescription(variant?: Pick<VariantSnapshot, 'attributeName' | 'attributeValue'> | null): string {
  return variant ? `${variant.attributeName}: ${variant.attributeValue}` : 'Variant not specified'
}

export function variantSellingPrice(product: PricingProduct, variant: PricingVariant): number | null {
  return positive(variant.priceOverride) ? Number(variant.priceOverride) : positive(product.pricing.price) ? Number(product.pricing.price) : null
}

export function variantSelectionError(product: PricingProduct | undefined, variantId?: string | null): string | null {
  if (!variantId) return null
  if (!product?.variants) return 'Variant details are unavailable. Refresh the catalogue before saving, or clear this selection.'
  const variant = product.variants.find((item) => item.id === variantId && item.productId === product.id)
  if (!variant || !variant.isActive) return 'This variant is no longer available for this product. Choose another or clear the selection.'
  return null
}

export interface PricingProductRow extends Omit<PricingSnapshot, 'hasVariantPrice'> {
  id: string
  name: string
  image_url: string | null
  category: string | null
  quantity: number | null
}

export const PRODUCT_PRICING_COLUMNS =
  'id,name,image_url,category,quantity,price,bundle_prices,is_b1g1,price_spx2,price_spx3,price_b1g1,promo_price,has_variants,updated_at'

export interface BundlePriceRow {
  id: string
  qty: string
  price: string
}

export interface PricingDraft {
  unitPrice: string
  soldInSets: boolean
  bundleRows: BundlePriceRow[]
  isB1g1: boolean
}

export interface PricingPayload {
  price: number
  bundle_prices: Record<string, number>
  is_b1g1: boolean
}

export interface PricingIssue {
  path: string
  message: string
}

export type PricingValidation =
  | { ok: true; value: PricingPayload }
  | { ok: false; issues: PricingIssue[] }

// The unit column is numeric(10,2). Apply the same currency precision to packs.
export const MAX_SELLING_PRICE = 99_999_999.99
// Order pricing builds a table up to the largest pack size; keep it bounded.
export const MAX_PACK_SIZE = 10_000
export const MAX_BUNDLE_ROWS = 100

function positive(value: unknown): boolean {
  return (typeof value === 'number' || typeof value === 'string') &&
    Number.isFinite(Number(value)) && Number(value) > 0
}

function pricedTiers(pricing: Pick<PricingSnapshot, 'bundle_prices'>) {
  return Object.entries(pricing.bundle_prices ?? {})
    .map(([qty, price]) => ({ qty: Number(qty), price: Number(price) }))
    .filter((tier) => Number.isSafeInteger(tier.qty) && tier.qty >= 1 && positive(tier.price))
    .sort((a, b) => a.qty - b.qty)
}

export function createPricingDraft(
  pricing?: Pick<PricingSnapshot, 'price' | 'bundle_prices' | 'is_b1g1'> | null,
): PricingDraft {
  return {
    unitPrice: pricing?.price == null || Number(pricing.price) === 0 ? '' : String(pricing.price),
    // Set-only selling is the existing price=0 + priced-tier convention, not a new column.
    soldInSets: !!pricing && !positive(pricing.price) && pricedTiers(pricing).length > 0,
    // Rows keep their identity while pack sizes are edited, so typing never remounts an input.
    bundleRows: Object.entries(pricing?.bundle_prices ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([qty, price], index) => ({ id: `saved-${index}`, qty, price: price == null ? '' : String(price) })),
    isB1g1: pricing?.is_b1g1 === true,
  }
}

export function newBundlePriceRow(): BundlePriceRow {
  return { id: crypto.randomUUID(), qty: '', price: '' }
}

/** Accept unknown at the action boundary; TypeScript types do not validate a POST. */
export function validateProductPricing(
  input: unknown,
  { requirePricing = true }: { requirePricing?: boolean } = {},
): PricingValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [{ path: 'draft', message: 'Enter a selling price, or add a price for a whole set.' }] }
  }
  const draft = input as Record<string, unknown>
  if (typeof draft.unitPrice !== 'string' || typeof draft.soldInSets !== 'boolean' ||
      typeof draft.isB1g1 !== 'boolean' || !Array.isArray(draft.bundleRows)) {
    return { ok: false, issues: [{ path: 'draft', message: 'The selling-price form is invalid. Reopen it and try again.' }] }
  }
  if (draft.bundleRows.length > MAX_BUNDLE_ROWS) {
    return { ok: false, issues: [{ path: 'bundleRows', message: `Use at most ${MAX_BUNDLE_ROWS} set prices.` }] }
  }

  const issues: PricingIssue[] = []
  const money = (raw: string, path: string, label: string, allowZero = false): number => {
    const text = raw.trim()
    if (!text && allowZero) return 0
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text) || !Number.isFinite(Number(text))) {
      issues.push({ path, message: `${label}: enter an amount with no more than 2 decimal places.` })
      return 0
    }
    const value = Number(text)
    if (value > MAX_SELLING_PRICE || (allowZero ? value < 0 : value <= 0)) {
      issues.push({ path, message: `${label}: enter ${allowZero ? '0 or a positive amount' : 'a positive amount'} below Rs 100,000,000.` })
      return 0
    }
    return value
  }

  let price = 0
  if (!draft.soldInSets) {
    if (requirePricing && (!draft.unitPrice.trim() || Number(draft.unitPrice) === 0)) {
      issues.push({ path: 'unitPrice', message: 'Enter a selling price above Rs 0, or choose “Sold only in sets” and add a set price.' })
    } else {
      price = money(draft.unitPrice, 'unitPrice', 'Unit price', !requirePricing)
    }
  }

  const bundlePrices: Record<string, number> = {}
  const sizes = new Set<number>()
  let filledRows = 0
  for (let index = 0; index < draft.bundleRows.length; index++) {
    const row = draft.bundleRows[index]
    if (!row || typeof row !== 'object' || typeof row.qty !== 'string' || typeof row.price !== 'string') {
      issues.push({ path: 'bundleRows', message: `Set ${index + 1} is invalid. Remove it and add it again.` })
      continue
    }
    const qtyText = row.qty.trim()
    const priceText = row.price.trim()
    if (!qtyText && !priceText) continue
    filledRows++
    const qty = Number(qtyText)
    const validQty = /^\d+$/.test(qtyText) && Number.isSafeInteger(qty) && qty >= 2 && qty <= MAX_PACK_SIZE
    if (!validQty) {
      issues.push({ path: `bundleRows.${index}.qty`, message: `Use a whole pack size from 2 to ${MAX_PACK_SIZE.toLocaleString('en-US')}.` })
    } else if (sizes.has(qty)) {
      issues.push({ path: `bundleRows.${index}.qty`, message: `There are two ${qty}-pack rows. Remove one before saving.` })
    }
    sizes.add(qty)
    const total = money(priceText, `bundleRows.${index}.price`, 'Whole-set price')
    if (validQty) bundlePrices[String(qty)] = total
  }

  if (draft.soldInSets && filledRows === 0) {
    issues.push({ path: 'bundleRows', message: 'Sold only in sets needs at least one set price, e.g. 5 pcs for Rs 375.' })
  }
  if (issues.length) return { ok: false, issues }
  return { ok: true, value: { price, bundle_prices: bundlePrices, is_b1g1: draft.isB1g1 } }
}

export function pricingProductFromRow(row: PricingProductRow, hasVariantPrice: boolean | null, variants?: PricingVariant[]): PricingProduct {
  return {
    variants,
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    category: row.category,
    stockOnHand: row.quantity == null ? null : Number(row.quantity),
    pricing: {
      price: row.price,
      bundle_prices: row.bundle_prices,
      is_b1g1: row.is_b1g1,
      price_spx2: row.price_spx2,
      price_spx3: row.price_spx3,
      price_b1g1: row.price_b1g1,
      promo_price: row.promo_price,
      has_variants: row.has_variants,
      hasVariantPrice,
      updated_at: row.updated_at,
    },
  }
}

export function pricingStatus(pricing?: PricingSnapshot | null): 'priced' | 'unpriced' | 'unknown' {
  if (!pricing) return 'unknown'
  if ([pricing.price, pricing.price_spx2, pricing.price_spx3, pricing.price_b1g1, pricing.promo_price].some(positive) ||
      pricedTiers(pricing).length > 0 || pricing.hasVariantPrice === true) return 'priced'
  return pricing.hasVariantPrice === false ? 'unpriced' : 'unknown'
}

export function formatSellingPrice(value: PriceValue): string {
  return `Rs ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function pricingSummary(pricing: PricingSnapshot): string {
  const parts: string[] = []
  if (positive(pricing.price)) parts.push(`${formatSellingPrice(pricing.price)} / unit`)
  const tiers = pricedTiers(pricing)
  for (const tier of tiers.slice(0, 2)) parts.push(`${tier.qty} pcs for ${formatSellingPrice(tier.price)}`)
  if (tiers.length > 2) parts.push(`+${tiers.length - 2} set prices`)
  if (positive(pricing.price_spx2) && !tiers.some((t) => t.qty === 2)) parts.push(`2 pcs for ${formatSellingPrice(pricing.price_spx2)}`)
  if (positive(pricing.price_spx3) && !tiers.some((t) => t.qty === 3)) parts.push(`3 pcs for ${formatSellingPrice(pricing.price_spx3)}`)
  if (positive(pricing.price_b1g1)) parts.push(`B1G1 ${formatSellingPrice(pricing.price_b1g1)}`)
  else if (pricing.is_b1g1) parts.push('B1G1')
  if (positive(pricing.promo_price)) parts.push(`Promo ${formatSellingPrice(pricing.promo_price)}`)
  if (pricing.hasVariantPrice) parts.push('Variant prices in Inventory')
  return parts.join(' · ')
}

/** Includes raw JSON values: a changed snapshot must be re-read, never silently overwritten. */
export function pricingRevision(pricing: PricingSnapshot): string {
  return JSON.stringify([
    pricing.price,
    pricing.bundle_prices == null ? null : Object.entries(pricing.bundle_prices).sort(([a], [b]) => a.localeCompare(b)),
    pricing.is_b1g1, pricing.price_spx2, pricing.price_spx3, pricing.price_b1g1,
    pricing.promo_price, pricing.has_variants, pricing.hasVariantPrice, pricing.updated_at,
  ])
}

export interface ProductEditDraft {
  name: string
  imageUrl: string
  category: string
  pricing: PricingDraft
}

export type ProductEditPatch = Partial<PricingPayload & {
  name: string
  image_url: string | null
  category: string | null
}>

export function createProductEditDraft(product: PricingProduct): ProductEditDraft {
  return {
    name: product.name,
    imageUrl: product.imageUrl ?? '',
    category: product.category ?? '',
    pricing: createPricingDraft(product.pricing),
  }
}

export function productEditRevision(product: PricingProduct): string {
  return JSON.stringify([product.name, product.imageUrl, product.category, pricingRevision(product.pricing)])
}

export function pricingDraftChanged(draft: unknown, pricing: PricingSnapshot): boolean {
  const key = (value: unknown): string | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const d = value as PricingDraft
    if (typeof d.unitPrice !== 'string' || typeof d.soldInSets !== 'boolean' ||
        typeof d.isB1g1 !== 'boolean' || !Array.isArray(d.bundleRows) ||
        d.bundleRows.some((row) => !row || typeof row.qty !== 'string' || typeof row.price !== 'string')) return null
    return JSON.stringify([
      d.unitPrice.trim(), d.soldInSets, d.isB1g1,
      d.bundleRows.filter((row) => row.qty.trim() || row.price.trim())
        .map((row) => [row.qty.trim(), row.price.trim()]).sort(([a], [b]) => a.localeCompare(b)),
    ])
  }
  return key(draft) !== key(createPricingDraft(pricing))
}

export function validateProductEdit(
  input: unknown,
  current: PricingProduct,
): { ok: true; patch: ProductEditPatch } | { ok: false; issues: PricingIssue[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [{ path: 'draft', message: 'Reopen the product editor and try again.' }] }
  }
  const draft = input as ProductEditDraft
  const issues: PricingIssue[] = []
  const patch: ProductEditPatch = {}
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name || !normalizeName(name) || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    issues.push({ path: 'name', message: 'Enter a product name with 1–200 characters, without control characters.' })
  } else if (name !== current.name.trim()) {
    patch.name = name
  }

  if (typeof draft.category !== 'string') {
    issues.push({ path: 'category', message: 'Choose a category from the list.' })
  } else if (draft.category !== (current.category ?? '')) {
    if (draft.category && !PRODUCT_CATEGORIES.some((category) => category === draft.category)) {
      issues.push({ path: 'category', message: 'Choose a category from the list, or leave it uncategorised.' })
    } else patch.category = draft.category || null
  }

  if (typeof draft.imageUrl !== 'string') {
    issues.push({ path: 'imageUrl', message: 'Upload a product photo, or remove it.' })
  } else if (draft.imageUrl !== (current.imageUrl ?? '')) {
    const photo = draft.imageUrl.trim()
    if (!photo) patch.image_url = null
    else {
      try {
        const url = new URL(photo)
        if (photo.length > 2048 || url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid photo')
        patch.image_url = photo
      } catch {
        issues.push({ path: 'imageUrl', message: 'Use a securely uploaded product photo (HTTPS).' })
      }
    }
  }

  // A details-only edit must not clear legacy, promo or variant-only prices.
  if (pricingDraftChanged(draft.pricing, current.pricing)) {
    const checked = validateProductPricing(draft.pricing)
    if (!checked.ok) issues.push(...checked.issues)
    else {
      if (Number(current.pricing.price ?? 0) !== checked.value.price) patch.price = checked.value.price
      if ((current.pricing.is_b1g1 === true) !== checked.value.is_b1g1) patch.is_b1g1 = checked.value.is_b1g1
      const tierKey = (tiers: Record<string, PriceValue> | null) => JSON.stringify(
        Object.entries(tiers ?? {}).map(([qty, price]) => [qty, Number(price)]).sort(([a], [b]) => String(a).localeCompare(String(b))),
      )
      if (tierKey(current.pricing.bundle_prices) !== tierKey(checked.value.bundle_prices)) {
        patch.bundle_prices = checked.value.bundle_prices
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, patch }
}

export function mergePricingProducts(current: PricingProduct[], updates: PricingProduct[]): PricingProduct[] {
  const byId = new Map(current.map((product) => [product.id, product]))
  for (const product of updates) byId.set(product.id, product)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export const MAX_PRODUCT_VARIANTS = 100
export const VARIANT_ATTRIBUTES = ['Model', 'Size', 'Color', 'Capacity', 'Material', 'Style', 'Weight', 'Length', 'Pack'] as const

export interface NewVariantRow {
  key: string
  attributeName: string
  attributeValue: string
  priceOverride: string
  quantity: string
  sku: string
}

export interface NewVariantsDraft {
  enabled: boolean
  rows: NewVariantRow[]
}

export interface NewVariantPayload {
  attribute_name: string
  attribute_value: string
  price_override: number | null
  quantity: number
  sku: string | null
}

export interface NewInventoryProductInput {
  requestId: string
  name: string
  pricing: PricingDraft
  variants?: NewVariantsDraft
  sku?: string | null
  category?: string | null
  imageUrl?: string | null
  description?: string | null
  remarks?: string | null
  isActive?: boolean
  quantity?: number
  unitCostNet?: number | null
}

export function createVariantsDraft(): NewVariantsDraft {
  return { enabled: false, rows: [] }
}

export function newVariantRow(): NewVariantRow {
  return { key: crypto.randomUUID(), attributeName: '', attributeValue: '', priceOverride: '', quantity: '0', sku: '' }
}

export function validateNewProductPricing(
  pricingInput: unknown,
  variantsInput: unknown = createVariantsDraft(),
  { requirePricing = true }: { requirePricing?: boolean } = {},
): { ok: true; pricing: PricingPayload; hasVariants: boolean; variants: NewVariantPayload[] } | { ok: false; issues: PricingIssue[] } {
  if (!variantsInput || typeof variantsInput !== 'object' || Array.isArray(variantsInput)) {
    return { ok: false, issues: [{ path: 'variants', message: 'Reopen the variant form and try again.' }] }
  }
  const draft = variantsInput as NewVariantsDraft
  if (typeof draft.enabled !== 'boolean' || !Array.isArray(draft.rows)) {
    return { ok: false, issues: [{ path: 'variants', message: 'Invalid variant options.' }] }
  }
  const parent = validateProductPricing(pricingInput, { requirePricing: requirePricing && !draft.enabled })
  const issues: PricingIssue[] = parent.ok ? [] : [...parent.issues]
  const variants: NewVariantPayload[] = []
  if (draft.enabled) {
    if (draft.rows.length < 1 || draft.rows.length > MAX_PRODUCT_VARIANTS) {
      issues.push({ path: 'variants', message: `Add between 1 and ${MAX_PRODUCT_VARIANTS} variants, or turn off “Has variants”.` })
    }
    const identities = new Set<string>()
    const keys = new Set<string>()
    const hasParentPrice = parent.ok && (parent.value.price > 0 || Object.values(parent.value.bundle_prices).some((price) => price > 0))
    for (let index = 0; index < Math.min(draft.rows.length, MAX_PRODUCT_VARIANTS); index++) {
      const row = draft.rows[index]
      const path = `variants.rows.${index}`
      if (!row || typeof row !== 'object' || ['key', 'attributeName', 'attributeValue', 'priceOverride', 'quantity', 'sku'].some((key) => typeof row[key as keyof NewVariantRow] !== 'string')) {
        issues.push({ path: 'variants', message: `Variant ${index + 1} is invalid. Remove it and add it again.` })
        continue
      }
      if (!row.key || keys.has(row.key)) issues.push({ path: 'variants', message: 'Variant rows must have distinct identities. Remove the repeated row.' })
      keys.add(row.key)
      const attributeName = row.attributeName.trim()
      const attributeValue = row.attributeValue.trim()
      if (!attributeName || attributeName.length > 80 || /[\u0000-\u001f\u007f]/.test(attributeName)) {
        issues.push({ path: `${path}.attributeName`, message: 'Choose a variant type, such as Capacity.' })
      }
      if (!attributeValue || attributeValue.length > 120 || /[\u0000-\u001f\u007f]/.test(attributeValue)) {
        issues.push({ path: `${path}.attributeValue`, message: 'Enter a variant value, such as 2Kg (maximum 120 characters).' })
      }
      const identity = JSON.stringify([attributeName, attributeValue].map((text) => text.toLowerCase().replace(/\s+/g, ' ')))
      if (attributeName && attributeValue && identities.has(identity)) {
        issues.push({ path: `${path}.attributeValue`, message: 'This variant is already listed. Each type and value must be unique.' })
      }
      identities.add(identity)
      const amount = row.priceOverride.trim()
      let price: number | null = null
      if (amount) {
        if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Number(amount) > MAX_SELLING_PRICE) {
          issues.push({ path: `${path}.priceOverride`, message: 'Enter a positive selling price with no more than 2 decimal places, or leave it blank to use the default.' })
        } else price = Number(amount)
      } else if (requirePricing && !hasParentPrice) {
        issues.push({ path: `${path}.priceOverride`, message: 'Enter this variant’s selling price, or set a default product selling price.' })
      }
      const quantity = row.quantity.trim() || '0'
      if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) > 2_147_483_647) {
        issues.push({ path: `${path}.quantity`, message: 'Recorded stock must be a non-negative whole number.' })
      }
      const sku = row.sku.trim()
      if (sku.length > 200 || /[\u0000-\u001f\u007f]/.test(sku)) issues.push({ path: `${path}.sku`, message: 'Use a variant SKU of at most 200 characters.' })
      variants.push({ attribute_name: attributeName, attribute_value: attributeValue, price_override: price, quantity: Number(quantity), sku: sku || null })
    }
  }
  if (!parent.ok || issues.length) return { ok: false, issues }
  return { ok: true, pricing: parent.value, hasVariants: draft.enabled, variants }
}
