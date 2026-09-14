import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { normalizeName } from '@/lib/products/match'
import { normaliseCategory } from '@/lib/products/categories'
import {
  MAX_SELLING_PRICE, PRODUCT_PRICING_COLUMNS, pricingProductFromRow, validateNewProductPricing,
  type NewInventoryProductInput, type PricingProduct, type PricingProductRow, type PricingVariant, type VariantSelection, type VariantSnapshot,
} from '@/lib/products/pricing'

const newInventoryProductSchema = z.object({
  requestId: z.string().uuid('Reopen Add Product to start a new creation request.'),
  name: z.string().trim().min(1, 'A product name is required').max(200).refine((name) => !!normalizeName(name) && !/[\u0000-\u001f\u007f]/.test(name), 'Enter a valid product name.'),
  sku: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  remarks: z.string().trim().max(4000).nullable().optional(),
  isActive: z.boolean().default(true),
  quantity: z.number().int().min(0).max(2_147_483_647).default(0),
  unitCostNet: z.number().finite().min(0).max(MAX_SELLING_PRICE).nullable().optional(),
  imageUrl: z.string().trim().max(2048).nullable().optional().refine((image) => {
    if (!image) return true
    try { const url = new URL(image); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
  }, 'Use a securely uploaded product photo (HTTPS).'),
  pricing: z.unknown(),
  variants: z.unknown().optional(),
})

export function parseNewInventoryProductInput(input: NewInventoryProductInput) {
  const parsed = newInventoryProductSchema.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0].message)
  return parsed.data
}

export async function createInventoryProductRecord(
  db: SupabaseClient,
  input: NewInventoryProductInput,
  { requirePricing = false, allowOpeningStock = true }: { requirePricing?: boolean; allowOpeningStock?: boolean } = {},
): Promise<{ productId: string; created: boolean; replayed: boolean }> {
  const product = parseNewInventoryProductInput(input)
  const checked = validateNewProductPricing(product.pricing, product.variants, { requirePricing })
  if (!checked.ok) throw new Error(checked.issues[0].message)
  const { data, error } = await db.rpc('inventory_create_product', {
    p_product: {
      id: product.requestId, name: product.name, sku: product.sku || null,
      ...checked.pricing, has_variants: checked.hasVariants,
      category: normaliseCategory(product.category), description: product.description || null,
      remarks: product.remarks || null, image_url: product.imageUrl || null, is_active: product.isActive,
      quantity: allowOpeningStock && !checked.hasVariants ? product.quantity : 0,
      // One size's supplier cost cannot stand in for every variant's cost.
      cost_price: !checked.hasVariants && product.unitCostNet ? product.unitCostNet : null,
    },
    p_variants: checked.variants.map((variant) => ({ ...variant, quantity: allowOpeningStock ? variant.quantity : 0 })),
    p_require_pricing: requirePricing,
  })
  if (error?.code === '23505') {
    const found = await db.from('products').select('id').eq('name', product.name).maybeSingle()
    if (!found.error && found.data) return { productId: found.data.id, created: false, replayed: false }
  }
  if (error) throw new Error(`Could not create the product: ${error.message}`)
  if (!data?.productId) throw new Error('Inventory did not return the saved product. Retry without changing the form.')
  return data
}

type VariantRow = {
  id: string; product_id: string; attribute_name: string; attribute_value: string; is_active: boolean | null;
  quantity: number | null; price_override: number | string | null; image_url: string | null;
}
const VARIANT_COLUMNS = 'id,product_id,attribute_name,attribute_value,is_active,quantity,price_override,image_url'

export async function loadPurchasingVariants(db: SupabaseClient, productIds?: string[]): Promise<Map<string, PricingVariant[]>> {
  const groups = new Map<string, PricingVariant[]>()
  const ids = productIds ? [...new Set(productIds)] : undefined
  const batches = ids ? Array.from({ length: Math.ceil(ids.length / 150) }, (_, index) => ids.slice(index * 150, (index + 1) * 150)) : [undefined]
  for (const batch of batches) {
    const rows = await fetchAll<VariantRow>((from, to) => {
      const query = db.from('product_variants').select(VARIANT_COLUMNS)
      return (batch ? query.in('product_id', batch) : query).order('id').range(from, to)
    })
    for (const row of rows) {
      const variants = groups.get(row.product_id) ?? []
      variants.push({ id: row.id, productId: row.product_id, attributeName: row.attribute_name, attributeValue: row.attribute_value,
        isActive: row.is_active === true, stockOnHand: row.quantity == null ? null : Number(row.quantity),
        priceOverride: row.price_override, imageUrl: row.image_url })
      groups.set(row.product_id, variants)
    }
  }
  for (const variants of groups.values()) variants.sort((a, b) => a.attributeName.localeCompare(b.attributeName) || a.attributeValue.localeCompare(b.attributeValue, undefined, { numeric: true }) || a.id.localeCompare(b.id))
  return groups
}

export async function validatePurchasingVariants(db: SupabaseClient, lines: Array<VariantSelection & { key?: string; productId?: string | null }>): Promise<Map<string, VariantSnapshot>> {
  const selected = lines.filter((line) => line.variantId)
  const variants = await loadPurchasingVariants(db, selected.flatMap((line) => line.productId ? [line.productId] : []))
  const snapshots = new Map<string, VariantSnapshot>()
  for (const line of selected) {
    const variant = line.productId ? variants.get(line.productId)?.find((item) => item.id === line.variantId && item.isActive) : null
    if (!variant || line.variantCleared) throw new Error('A selected variant is missing, inactive or belongs to another product. Choose an active variant or explicitly clear it before saving.')
    snapshots.set(variant.id, { id: variant.id, attributeName: variant.attributeName, attributeValue: variant.attributeValue,
      provenance: line.variantSource ?? 'manual', selectedBy: null })
  }
  return snapshots
}

export async function loadPricingCatalogue(db: SupabaseClient): Promise<PricingProduct[]> {
  const [rows, variantsByProduct] = await Promise.all([
    fetchAll<PricingProductRow>((from, to) =>
      db.from('products').select(PRODUCT_PRICING_COLUMNS).order('name').order('id').range(from, to),
    ),
    loadPurchasingVariants(db),
  ])
  // A failed variant query throws, rather than falsely marking products unpriced.
  return rows.map((row) => {
    const variants = variantsByProduct.get(row.id) ?? []
    return pricingProductFromRow(row, variants.some((variant) => Number(variant.priceOverride) > 0), variants)
  })
}

export async function loadPricingProduct(db: SupabaseClient, productId: string): Promise<PricingProduct> {
  const [productResult, variantsByProduct] = await Promise.all([
    db.from('products').select(PRODUCT_PRICING_COLUMNS).eq('id', productId).maybeSingle(),
    loadPurchasingVariants(db, [productId]),
  ]).catch(() => { throw new Error('Could not read the current Inventory product and variants. Try again before editing it.') })
  if (productResult.error) throw new Error('Could not read the current Inventory product. Try again before editing it.')
  if (!productResult.data) throw new Error('This product is no longer in Inventory. Choose another product.')
  const variants = variantsByProduct.get(productId) ?? []
  return pricingProductFromRow(productResult.data as PricingProductRow, variants.some((variant) => Number(variant.priceOverride) > 0), variants)
}
