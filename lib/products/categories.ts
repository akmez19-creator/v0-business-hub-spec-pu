/**
 * The single canonical category list.
 *
 * Before this existed, 135 of 847 products carried a hand-typed category and
 * the 21 distinct values overlapped: "Automotive" vs "Car Accessories",
 * "Pet Supplies" vs "Pet / Outdoor", and three separate "Home / ..." variants.
 * Overlapping names are worse than none - an agent filtering "Car Accessories"
 * silently misses everything filed under "Automotive".
 *
 * These strings are stored verbatim in products.category, so renaming one means
 * migrating the column. LEGACY_CATEGORY_MAP below folds the old values in.
 */
export const PRODUCT_CATEGORIES = [
  'Kitchen & Dining',
  'Home Appliances',
  'Cleaning & Laundry',
  'Home & Living',
  'Storage & Organisation',
  'Lighting',
  'Home Improvement',
  'Beauty & Personal Care',
  'Health & Wellness',
  'Electronics & Gadgets',
  'Phone Accessories',
  'Car & Motorbike',
  'Tools & Hardware',
  'Toys & Games',
  'Baby & Kids',
  'Pet Supplies',
  'Sports & Outdoors',
  'Bags & Travel',
] as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

/** Shown when nothing fits - never guessed into a real category. */
export const UNCATEGORISED = 'Uncategorised'

/**
 * Most rows one catalogue query returns. Lives here rather than in
 * agent-catalogue.ts because that file is 'use server' and may only export
 * async functions - the UI needs the same number to warn about truncation.
 */
export const RESULT_CAP = 300

/**
 * Hand-typed values found in the live column, mapped to the canonical list.
 * Keyed lowercase because the same category was typed with different casing.
 */
const LEGACY_CATEGORY_MAP: Record<string, ProductCategory> = {
  'kitchen & food tools': 'Kitchen & Dining',
  'kitchen': 'Kitchen & Dining',
  'cleaning & household': 'Cleaning & Laundry',
  'home / laundry': 'Cleaning & Laundry',
  'home & pest control': 'Home Improvement',
  'tiles & flooring': 'Home Improvement',
  'home / furniture': 'Home & Living',
  'home / bedding': 'Home & Living',
  'home': 'Home & Living',
  'sewing & crafts': 'Home & Living',
  'bathroom / personal care': 'Beauty & Personal Care',
  'personal care': 'Beauty & Personal Care',
  'beauty': 'Beauty & Personal Care',
  'health & wellness': 'Health & Wellness',
  'electronics': 'Electronics & Gadgets',
  'phone accessories': 'Phone Accessories',
  'car accessories': 'Car & Motorbike',
  'automotive': 'Car & Motorbike',
  'pet / outdoor': 'Pet Supplies',
  'pet supplies': 'Pet Supplies',
  'toys & games': 'Toys & Games',
  'storage & organization': 'Storage & Organisation',
  'storage & organisation': 'Storage & Organisation',
  'home appliances': 'Home Appliances',
  'sports & fitness': 'Sports & Outdoors',
  'bags & travel': 'Bags & Travel',
}

/**
 * Resolves any stored value to a canonical category, or null when it is blank
 * or unrecognised. Never invents a category from a near-miss.
 */
export function normaliseCategory(raw: string | null | undefined): ProductCategory | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  const exact = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === v.toLowerCase())
  if (exact) return exact
  return LEGACY_CATEGORY_MAP[v.toLowerCase()] ?? null
}
