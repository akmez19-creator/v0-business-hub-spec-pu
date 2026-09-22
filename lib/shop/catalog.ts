import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import {
  offerLabel,
  priceFor,
  setSize,
  unitPrice,
  type QuickOrderProduct,
} from '@/lib/orders/quick-order'

/**
 * Storefront read model.
 *
 * Pricing is NEVER recomputed here - it delegates to lib/orders/quick-order so
 * the website charges exactly what the internal order desk charges. That module
 * already encodes two things this file must not re-derive:
 *  - set-only products (`price` 0 + a bundle tier, e.g. Mirror Film {"4":475})
 *    must be priced as whole SETS. Treating `price` as the unit price prints
 *    "Rs 0" and would let a customer order a set for nothing - a bug that has
 *    already reached live orders once.
 *  - bundle tiers are a knapsack, not "biggest bundle first".
 */

export type ShopProduct = {
  id: string
  name: string
  category: string
  /** Price of the smallest purchasable quantity (1 unit, or 1 whole set). */
  fromPrice: number
  /** Units the customer gets for `fromPrice` - a set of 4 sells 4 at a time. */
  minQty: number
  /** "B1G1", "Set of 4", "2 for Rs850" - '' when the product has no offer. */
  offer: string
  isB1g1: boolean
  soldOut: boolean
  /** Real counted stock. Availability is driven by this, per the owner's rule. */
  quantity: number
  image: string
  /** Extra gallery photos, primary first. */
  images: string[]
  /** First product clip, when one exists. */
  video: string | null
  hasVariants: boolean
  /**
   * True when there is no price ANYWHERE for this product - no price, no bundle
   * tier, no promo. 403 of 583 in-stock products are in this state (never priced
   * and never sold), so they are shown but cannot be added to a basket: the card
   * reads "Price on request" and offers a WhatsApp enquiry instead. Derived once
   * here so the card, the buy panel and the order route cannot disagree about
   * what is buyable.
   */
  needsEnquiry: boolean
}

export type ShopCategory = {
  name: string
  slug: string
  count: number
  /** Photos borrowed from the category's own products, for the cover collage. */
  covers: string[]
}

export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

type Row = {
  id: string
  name: string
  category: string | null
  price: number | string | null
  bundle_prices: Record<string, number | string> | null
  is_b1g1: boolean | null
  promo_price: number | string | null
  quantity: number | null
  sold_out: boolean | null
  image_url: string | null
  has_variants: boolean | null
}

function toShopProduct(r: Row, extraImages: string[], video: string | null): ShopProduct {
  // Shaped as a real QuickOrderProduct so pricing goes through the SAME code
  // path as an internal order - no parallel storefront pricing to drift.
  const p: QuickOrderProduct = {
    id: r.id,
    name: r.name,
    price: r.price,
    bundle_prices: r.bundle_prices,
    is_b1g1: r.is_b1g1,
    has_variants: r.has_variants,
    sold_out: r.sold_out,
  }
  const set = setSize(p)
  const minQty = set > 0 ? set : 1
  // priceFor() answers "cheapest way to buy N", which for a set-only product
  // means one whole set. Falls back to promo_price only when there is genuinely
  // no other price to show.
  const computed = priceFor(p, minQty)
  const fromPrice = computed > 0 ? computed : Number.parseFloat(String(r.promo_price ?? 0)) || 0

  const primary = r.image_url || extraImages[0] || ''
  return {
    id: r.id,
    name: r.name,
    category: r.category || 'Other',
    fromPrice,
    minQty,
    offer: offerLabel(p),
    isB1g1: Boolean(r.is_b1g1),
    // Trust the flag, but never advertise something with nothing on the shelf:
    // the owner's rule is that counted stock is what makes a product available.
    soldOut: Boolean(r.sold_out) || Number(r.quantity ?? 0) <= 0,
    quantity: Number(r.quantity ?? 0),
    image: primary,
    images: [primary, ...extraImages.filter((u) => u && u !== primary)].filter(Boolean),
    video,
    hasVariants: Boolean(r.has_variants),
    needsEnquiry: fromPrice <= 0,
  }
}

const SELECT =
  'id,name,category,price,bundle_prices,is_b1g1,promo_price,quantity,sold_out,image_url,has_variants'

/**
 * Every active product, with gallery photos and clips attached.
 *
 * One pass over three tables rather than a per-product query: the grid shows
 * hundreds of cards, so N+1 here would be hundreds of round trips.
 */
const getCachedProducts = unstable_cache(async function getAllProducts(): Promise<ShopProduct[]> {
  const db = createAdminClient()

  const [{ data: products, error }, { data: images }, { data: clips }] = await Promise.all([
    db.from('products').select(SELECT).eq('is_active', true).order('name'),
    db.from('product_images').select('product_id,image_url,is_primary,position').limit(5000),
    db.from('product_clips').select('product_id,file_url,created_at').limit(2000),
  ])

  // A failed read must never render as an empty catalog - that looks like
  // "you have no products" instead of "the query broke".
  if (error) throw new Error(`Catalog query failed: ${error.message}`)

  const imagesBy = new Map<string, string[]>()
  for (const r of [...(images ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.position ?? 0) - (b.position ?? 0),
  )) {
    if (!r.product_id || !r.image_url) continue
    const list = imagesBy.get(r.product_id) ?? []
    if (list.length < 8) list.push(r.image_url)
    imagesBy.set(r.product_id, list)
  }

  const videoBy = new Map<string, string>()
  for (const r of clips ?? []) {
    if (!r.product_id || !r.file_url) continue
    if (!videoBy.has(r.product_id)) videoBy.set(r.product_id, r.file_url)
  }

  return (products ?? []).map((r) =>
    toShopProduct(r as Row, imagesBy.get(r.id) ?? [], videoBy.get(r.id) ?? null),
  )
}, ['shop-catalogue'], { revalidate: 300 })

export const getAllProducts = cache(getCachedProducts)

/** Categories that actually have something in them, biggest first. */
export function buildCategories(products: ShopProduct[]): ShopCategory[] {
  const by = new Map<string, ShopProduct[]>()
  for (const p of products) {
    const list = by.get(p.category) ?? []
    list.push(p)
    by.set(p.category, list)
  }
  return [...by.entries()]
    .map(([name, list]) => ({
      name,
      slug: categorySlug(name),
      count: list.length,
      // In-stock products with a photo make a far better cover than a
      // sold-out one, so the collage is drawn from those first.
      covers: [...list]
        .sort((a, b) => Number(a.soldOut) - Number(b.soldOut))
        .filter((p) => p.image)
        .slice(0, 4)
        .map((p) => p.image),
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Sort for display: available first, then the ones with real media, then by
 * offer. Sold-out products stay in the list (the owner wants them visible,
 * greyed out) but always sink to the bottom.
 */
export function displayOrder(products: ShopProduct[]): ShopProduct[] {
  return [...products].sort(
    (a, b) =>
      Number(a.soldOut) - Number(b.soldOut) ||
      Number(Boolean(b.video)) - Number(Boolean(a.video)) ||
      Number(Boolean(b.image)) - Number(Boolean(a.image)) ||
      a.name.localeCompare(b.name),
  )
}

/**
 * The real offers in this catalog.
 *
 * Deliberately NOT based on promo_price: exactly one active product has one
 * set, so a "promotions" rail built on it would render a single lonely card.
 * B1G1 (27 products) and bundle tiers (68) are where the actual deals live.
 */
export function promoProducts(products: ShopProduct[]): ShopProduct[] {
  return displayOrder(products.filter((p) => !p.soldOut && p.offer))
}

export function getProductById(products: ShopProduct[], id: string): ShopProduct | undefined {
  return products.find((p) => p.id === id)
}

// priceLabel/perUnitLabel live in ./format because client components need them
// and this module imports server-only code. Re-exported for server callers.
export { priceLabel, perUnitLabel } from './format'

/** Unit economics for a line, so the cart and the server agree exactly. */
export function linePrice(p: ShopProduct, qty: number): number {
  return p.minQty > 1 ? p.fromPrice * Math.max(1, Math.round(qty / p.minQty)) : p.fromPrice * qty
}

/*
   Page-level read models.

   getAllProducts() is ONE query set for the whole catalog, so every page below
   derives from that single fetch rather than issuing its own. React's cache
   deduplicates within a render; the explicit five-minute data cache shares the
   result across requests without requiring any build-time database reads.
 */

/** Everything the storefront home page needs, in one pass. */
export async function getShopHome(): Promise<{
  deals: ShopProduct[]
  lanes: { category: string; slug: string; count: number; products: ShopProduct[] }[]
  categories: ShopCategory[]
  total: number
}> {
  const products = await getAllProducts()
  const categories = buildCategories(products)

  return {
    deals: promoProducts(products).slice(0, 12),
    // One lane per category, biggest category first (buildCategories sorts).
    lanes: categories.map((c) => ({
      category: c.name,
      slug: c.slug,
      count: c.count,
      products: displayOrder(products.filter((p) => p.category === c.name)).slice(0, 10),
    })),
    categories,
    // Only what a customer can actually buy, so the headline never overstates.
    total: products.filter((p) => !p.soldOut).length,
  }
}

/** Resolve a category by SLUG (urls are slugs, not raw names). */
export async function getCategoryPage(
  slug: string,
): Promise<{ name: string; products: ShopProduct[] } | null> {
  const products = await getAllProducts()
  const match = buildCategories(products).find((c) => c.slug === slug)
  if (!match) return null
  return {
    name: match.name,
    products: displayOrder(products.filter((p) => p.category === match.name)),
  }
}

export async function getDeals(): Promise<ShopProduct[]> {
  return promoProducts(await getAllProducts())
}

export async function getCategoryList(): Promise<ShopCategory[]> {
  return buildCategories(await getAllProducts())
}

/** One product plus its category siblings, for the detail page. */
export async function getProductPage(
  id: string,
): Promise<{ product: ShopProduct; siblings: ShopProduct[] } | null> {
  const products = await getAllProducts()
  const product = getProductById(products, id)
  if (!product) return null
  return {
    product,
    siblings: displayOrder(
      products.filter((p) => p.category === product.category && p.id !== product.id),
    ).slice(0, 10),
  }
}

/**
 * Substring search over name + category. Every term must match somewhere, so
 * "rope hook" narrows instead of widening - and a term is never allowed to
 * decide membership on its own.
 */
export async function searchProducts(query: string): Promise<ShopProduct[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const products = await getAllProducts()
  return displayOrder(
    products.filter((p) => {
      const hay = `${p.name} ${p.category}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    }),
  )
}

export { unitPrice }
